import * as cheerio from "cheerio";
import { lookup } from "dns/promises";
import { bookPageUrl, canonicalUrl, findSite, isChapterUrl, mirrorUrls } from "../sites";
import { BrowserBusyError, BrowserLimitError, withBrowserSlot } from "./rateLimit";
import { ApiError } from "./apiError";
import type { ErrorCode } from "../errors";

interface SiteConfig {
  content: string;
  lang?: "vi" | "zh";
  chapterNameSelector?: string;
  // Custom title parser when underscore-split heuristic does not fit (e.g. biquuge h1: "chapter-《novel》")
  extractTitles?: (fullTitle: string, h1: string) => { chapterName: string; novelName: string };
  // The first chapter's link on the book's page, tried in order: selectors of
  // links, or functions reading it from the page (relative to the book's URL)
  firstChapter: (string | (($: cheerio.CheerioAPI) => string | undefined))[];
  // A "下一页" (next page) link here leads to the next chapter, not to a part of this one
  noSubPages?: boolean;
  // Non-story elements inside `content` (scripts and the like are always removed)
  removeSelectors?: string;
  // Non-story lines in the chapter text
  junkLine?: RegExp;
}

// Keyed by NovelSite.domain (see ../sites)
const SITE_SELECTORS: Record<string, SiteConfig> = {
  "biquuge.com": {
    content: "article",
    lang: "zh",
    extractTitles: (_fullTitle, h1) => {
      const m = h1.match(/^(.+?)-《(.+?)》$/);
      if (m) return { chapterName: m[1].trim(), novelName: m[2].trim() };
      return { chapterName: h1, novelName: "" };
    },
    // The full chapter list; the list above it holds the latest chapters
    firstChapter: [".book_list2 li a"],
    // Each sub-page starts and ends with its page number: 第(1/3)页
    junkLine: /^第\(\d+\/\d+\)页$/,
  },
  "ixdzs.tw": {
    content: "article.page-content",
    lang: "zh",
    chapterNameSelector: ".page-d-name",
    extractTitles: (fullTitle) => {
      // Title format: "chapterName_novelName-siteName"
      const parts = fullTitle.split("_");
      const chapterName = parts[0]?.trim() || "";
      const novelName = parts[1]?.split("-")[0]?.trim() || "";
      return { chapterName, novelName };
    },
    // The "read now" button, then the full chapter list (".cfirst" holds the latest chapters)
    firstChapter: ["#readbtn a", ".u-chapter:not(.cfirst) li a"],
    // The chapter title (repeated from the page header) and ad slots
    removeSelectors: "h3, .abg",
  },
  "twkan.cc": {
    content: "#content",
    lang: "zh",
    // Title: "第1章 戲鬼回家-我不是戲神-三九音域-全文免費閱讀-台灣小說網"
    extractTitles: (fullTitle, h1) => {
      const rest = h1 && fullTitle.startsWith(h1 + "-") ? fullTitle.slice(h1.length + 1) : "";
      return { chapterName: h1, novelName: rest.split("-")[0]?.trim() ?? "" };
    },
    // The "start reading" button names the first chapter: data-book-id, data-chapter-id
    firstChapter: [
      ($) => {
        const button = $("[data-book-id][data-chapter-id]").first();
        const [book, chapter] = [button.attr("data-book-id"), button.attr("data-chapter-id")];
        return book && chapter ? `/chapter/${book}/${chapter}.html` : undefined;
      },
    ],
    // Every chapter ends with an empty "()"
    junkLine: /^\(\)$/,
  },
  "quanben.io": {
    content: "#content",
    lang: "zh",
    // Title: "第1章 山边小村 凡人修仙传 - 全本小说网" (big5.: 全本小說網)
    extractTitles: (fullTitle, h1) => {
      const title = fullTitle.replace(/\s*-\s*全本小[说說][网網]\s*$/, "");
      return { chapterName: h1, novelName: h1 && title.startsWith(h1) ? title.slice(h1.length).trim() : "" };
    },
    // Chapters are numbered from 1 (the book's page only links the chapter list)
    firstChapter: [() => "1.html"],
    // "上一页" / "下一页" (previous / next page) are the chapters around
    noSubPages: true,
  },
};

function getSiteConfig(url: string): SiteConfig | null {
  const site = findSite(url);
  return site ? SITE_SELECTORS[site.domain] : null;
}

interface NavResult {
  prevChapter: string | null;
  nextChapter: string | null;
  nextPage: string | null; // sub-page within same chapter (e.g. _2.html)
  prevPage: string | null;
}

function extractNav($: cheerio.CheerioAPI, currentUrl: string): NavResult {
  const nav: NavResult = { prevChapter: null, nextChapter: null, nextPage: null, prevPage: null };

  const isRealUrl = (h: string | undefined): h is string =>
    !!h && !h.startsWith("javascript:") && h !== "#";

  const relPrev = $('a[rel="prev"]').attr("href");
  const relNext = $('a[rel="next"]').attr("href");
  if (isRealUrl(relPrev)) nav.prevChapter = relPrev;
  if (isRealUrl(relNext)) nav.nextChapter = relNext;

  $("a").each((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href");
    if (!isRealUrl(href)) return;
    // Chapter-level navigation
    if (!nav.prevChapter && text === "上一章") nav.prevChapter = href;
    if (!nav.nextChapter && text === "下一章") nav.nextChapter = href;
    // Sub-page navigation (within same chapter), in either script
    if (!nav.nextPage && (text === "下一页" || text === "下一頁")) nav.nextPage = href;
    if (!nav.prevPage && (text === "上一页" || text === "上一頁")) nav.prevPage = href;
  });

  // ixdzs.tw: explicit classes
  if (!nav.prevChapter) {
    const h = $("a.chapter-pre").attr("href");
    if (isRealUrl(h)) nav.prevChapter = h;
  }
  if (!nav.nextChapter) {
    const h = $("a.chapter-next").attr("href");
    if (isRealUrl(h)) nav.nextChapter = h;
  }

  // Some sites (e.g. biquuge) label sub-page links as "下一章" too. Demote any
  // detected chapter-nav whose URL is actually a sub-page of the current chapter
  // (filename normalizes to the same base after stripping `_N.html`).
  const chapterRoot = (u: string): string => {
    try {
      return new URL(u, currentUrl).href.replace(/\.html?$/i, "").replace(/_\d+$/, "");
    } catch {
      return u;
    }
  };
  const currentRoot = chapterRoot(currentUrl);
  const isSubPage = (candidate: string): boolean => {
    const candRoot = chapterRoot(candidate);
    return candRoot === currentRoot && new URL(candidate, currentUrl).href !== currentUrl;
  };
  if (nav.nextChapter && isSubPage(nav.nextChapter)) {
    if (!nav.nextPage) nav.nextPage = nav.nextChapter;
    nav.nextChapter = null;
  }
  if (nav.prevChapter && isSubPage(nav.prevChapter)) {
    if (!nav.prevPage) nav.prevPage = nav.prevChapter;
    nav.prevChapter = null;
  }

  return nav;
}

function extractTitles($: cheerio.CheerioAPI): { fullTitle: string; h1: string } {
  return {
    fullTitle: $("title").text().trim() || "",
    h1: $("h1").first().text().trim() || "",
  };
}

function parseHtml(html: string, siteConfig: SiteConfig, baseUrl: string) {
  const $ = cheerio.load(html);

  const contentEl = $(siteConfig.content);
  if (!contentEl.length) {
    return null;
  }

  contentEl.find("script, style, noscript, iframe, ins").remove();
  if (siteConfig.removeSelectors) contentEl.find(siteConfig.removeSelectors).remove();
  // Preserve paragraph breaks: turn <br> and <p> into newlines before extracting text
  contentEl.find("br").replaceWith("\n");
  contentEl.find("p").after("\n\n");

  const text = contentEl.text();
  const { fullTitle, h1 } = extractTitles($);
  const nav = extractNav($, baseUrl);

  const abs = (u: string | null) => {
    if (!u) return null;
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return null;
    }
  };

  let customNovelName = "";
  let customChapterName = siteConfig.chapterNameSelector
    ? $(siteConfig.chapterNameSelector).first().text().trim().replace(/\s+/g, " ")
    : "";

  if (siteConfig.extractTitles) {
    const parsed = siteConfig.extractTitles(fullTitle, h1);
    if (!customChapterName && parsed.chapterName) customChapterName = parsed.chapterName;
    if (!customNovelName && parsed.novelName) customNovelName = parsed.novelName;
  }

  // On the first and last chapters the sites point "previous/next chapter"
  // at the book's page or an "end of book" page
  const chapterLink = (u: string | null) => {
    const href = abs(u);
    return href && isChapterUrl(href) ? href : null;
  };

  // Where "下一页" (next page) means the next chapter
  const [prev, next] = siteConfig.noSubPages
    ? [nav.prevChapter ?? nav.prevPage, nav.nextChapter ?? nav.nextPage]
    : [nav.prevChapter, nav.nextChapter];

  return {
    text,
    fullTitle,
    h1,
    prevUrl: chapterLink(prev),
    nextUrl: chapterLink(next),
    nextPageUrl: siteConfig.noSubPages ? null : abs(nav.nextPage),
    customNovelName,
    customChapterName,
  };
}

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 20_000;
// How long a site with mirrors is waited for before they are asked too
const MIRROR_AFTER_MS = 4000;

// A fetched page and the URL it ended up at after redirects, which relative links resolve against
export interface FetchedPage {
  html: string;
  url: string;
}

// Loopback, private, link-local and other reserved destinations. URL parsing
// already normalizes numeric forms like http://2130706433 to dotted quads.
function isPrivateHost(hostname: string): boolean {
  // "localhost." (trailing dot) is the same host as "localhost"
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal)$/.test(host)) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (host.includes(":")) {
    return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
  }
  return false;
}

// Requests a scraped page may make in the headless browser (scripts, images,
// iframes, Cloudflare challenge resources): public http(s), data: and blob: only
function isAllowedBrowserRequest(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "data:" || parsed.protocol === "blob:") return true;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return !isPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

// Whether every address the host resolves to is public. Catches public names
// pointing at private IPs; a DNS-rebinding attacker can still race the
// browser's own lookup, which only a network-level restriction would stop.
async function resolvesToPublic(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (isPrivateHost(host)) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":")) return true; // IP literal, already checked
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateHost(a.address));
  } catch {
    return false;
  }
}

export async function fetchWithCheerio(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchedPage | null> {
  // Follow redirects by hand so every hop is checked against the supported sites
  let res: Response;
  for (let hop = 0; ; hop++) {
    res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,vi;q=0.6",
        Referer: new URL(url).origin + "/",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    if (hop >= MAX_REDIRECTS) throw new FetchContentError("Too many redirects", 422);
    url = new URL(location, url).href;
    if (!getSiteConfig(url)) throw new FetchContentError("The page redirected to an unsupported site", 422, "unsupportedSite");
  }

  if (!res.ok || res.headers.get("cf-mitigated") === "challenge") return null;

  const html = await res.text();
  // A Cloudflare challenge served as a page. (Challenges are usually a 403;
  // pages that passed can still carry Cloudflare's "challenge-platform" script.)
  if (/<title>\s*Just a moment/i.test(html)) {
    return null;
  }
  return { html, url };
}

async function fetchWithPuppeteer(url: string): Promise<FetchedPage> {
  const puppeteer = await import("puppeteer-core");
  const isDev = process.env.NODE_ENV === "development";

  let executablePath: string;
  let args: string[];

  if (isDev) {
    // Local: use installed Chrome
    const possiblePaths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    ];
    executablePath = possiblePaths.find((p) => {
      try { require("fs").accessSync(p); return true; } catch { return false; }
    }) || possiblePaths[0];
    args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"];
  } else {
    // Production (Vercel): use @sparticuz/chromium-min with remote binary
    const chromium = await import("@sparticuz/chromium-min");
    executablePath = await chromium.default.executablePath(
      "https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar"
    );
    args = chromium.default.args;
  }

  // Every step is bounded, so a run ends well within its slot (see withBrowserSlot)
  const browser = await puppeteer.default.launch({
    args,
    executablePath,
    headless: true,
    timeout: 30_000,
    protocolTimeout: 30_000,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Hide webdriver
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    // Never let the page (redirects, scripts) navigate the browser off the
    // supported sites, nor reach private-network addresses with any request
    await page.setRequestInterception(true);
    const hostChecks = new Map<string, Promise<boolean>>();
    page.on("request", async (request) => {
      const requestUrl = request.url();
      const offSite = request.isNavigationRequest() && request.frame() === page.mainFrame() && !getSiteConfig(requestUrl);
      let allowed = !offSite && isAllowedBrowserRequest(requestUrl);
      if (allowed && /^https?:/.test(requestUrl)) {
        // isAllowedBrowserRequest already parsed it successfully
        const { hostname } = new URL(requestUrl);
        if (!hostChecks.has(hostname)) hostChecks.set(hostname, resolvesToPublic(hostname));
        allowed = await hostChecks.get(hostname)!;
      }
      (allowed ? request.continue() : request.abort("blockedbyclient")).catch(() => {});
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    // Selectors come from where the page ended up (e.g. a desktop → mobile redirect)
    const finalConfig = getSiteConfig(page.url());
    if (!finalConfig) throw new FetchContentError("The page redirected to an unsupported site", 422, "unsupportedSite");
    const contentSelector = finalConfig.content;

    // Wait for content to appear (Cloudflare challenge may take a few seconds)
    await page.waitForSelector(contentSelector, { timeout: 15000 });

    return { html: await page.content(), url: page.url() };
  } finally {
    await browser.close();
  }
}

// The code a status means for the reader, unless the error gives its own
const STATUS_CODES: Record<number, ErrorCode> = {
  400: "unsupportedSite",
  422: "noContent",
  429: "rateLimited",
  502: "siteFailed",
  503: "busy",
  504: "slow",
};

export class FetchContentError extends ApiError {
  constructor(message: string, status: number, code?: ErrorCode) {
    super(code ?? STATUS_CODES[status] ?? "siteFailed", message, status);
  }
}

// `url`'s page by a plain fetch, from a mirror of its site if the site fails
// or serves a page that is not `usable` (an error page sent as a success).
// A site that has not answered after a few seconds (biquuge.com stalls for a
// minute at times) is not waited for: its mirrors are asked too, and the
// first usable page wins.
async function fetchFromSiteOrMirror(url: string, usable?: (page: FetchedPage) => boolean): Promise<FetchedPage | null> {
  const mirrors = mirrorUrls(url);
  if (mirrors.length === 0) return fetchWithCheerio(url);
  let failure: unknown = null;
  let unusable: FetchedPage | null = null;
  const own = fetchWithCheerio(url).then(
    (page) => {
      if (page && (!usable || usable(page))) return page;
      unusable = page;
      throw new Error("unusable");
    },
    (e) => {
      failure = e;
      throw e;
    }
  );
  const answered = await Promise.race([own.catch(() => null), new Promise<undefined>((r) => setTimeout(r, MIRROR_AFTER_MS))]);
  if (answered) return answered;
  const mirrored = mirrors.map((mirror) =>
    fetchWithCheerio(mirror).then((page) => {
      if (page && (!usable || usable(page))) return page;
      throw new Error("unusable");
    })
  );
  try {
    return await Promise.any([own, ...mirrored]);
  } catch {
    // The site's own failure tells more than the mirrors'
    if (failure) throw failure;
    return unusable;
  }
}

// Whether a fetched page holds a chapter's text
function hasChapter(page: FetchedPage): boolean {
  const config = getSiteConfig(page.url);
  return !!config && !!parseHtml(page.html, config, page.url)?.text.trim();
}

export interface ChapterContent {
  text: string;
  prevUrl: string | null;
  nextUrl: string | null;
  title: string;
  novelName: string;
  chapterName: string;
  lang: "vi" | "zh";
}

// `ip`: the reader's address when they asked for the chapter themselves (see withBrowserSlot)
export async function fetchContent(url: string, providedHtml?: string, ip?: string): Promise<ChapterContent> {
  const siteConfig = getSiteConfig(url);
  if (!siteConfig) {
    const supported = Object.keys(SITE_SELECTORS).join(", ");
    throw new FetchContentError(`Unsupported site. Supported: ${supported}`, 400);
  }

  // 1. Use provided HTML if available
  // 2. Try simple fetch
  // 3. Fallback to Puppeteer for Cloudflare-protected sites
  let page = providedHtml ? { html: providedHtml, url } : await fetchFromSiteOrMirror(url, hasChapter);

  if (!page) {
    try {
      page = await withBrowserSlot(ip, () => fetchWithPuppeteer(url));
    } catch (e) {
      if (e instanceof BrowserLimitError) throw new FetchContentError("Too many requests from your network. Please wait a few minutes and try again.", 429);
      if (e instanceof BrowserBusyError) throw new FetchContentError("Many readers are loading chapters right now. Please try again in a moment.", 503);
      if (e instanceof ApiError) throw e;
      throw new FetchContentError(`Could not load the page: ${e instanceof Error ? e.message : e}`, 502);
    }
  }

  // Parse with the selectors of the site the page ended up on after redirects
  const result = parseHtml(page.html, getSiteConfig(page.url) ?? siteConfig, page.url);

  if (!result || !result.text.trim()) {
    throw new FetchContentError("Could not find chapter content on this page", 422);
  }

  // Follow sub-pages (e.g. biquuge splits chapters into _2.html, _3.html)
  let fullText = result.text;
  let nextPageUrl = result.nextPageUrl;
  let finalNextUrl = result.nextUrl;
  const maxSubPages = 20;
  let subPage = 0;
  const visited = new Set([canonicalUrl(page.url)]);

  // Sub-page links come from the scraped page; only follow them to supported sites
  while (nextPageUrl && getSiteConfig(nextPageUrl) && !visited.has(canonicalUrl(nextPageUrl))) {
    visited.add(canonicalUrl(nextPageUrl));
    // Never return part of a chapter as if it were the whole chapter
    const partMissing = () =>
      new FetchContentError(`Could not load part ${subPage + 2} of this chapter. Please try again.`, 502);
    if (subPage >= maxSubPages) throw partMissing();
    const subPageResult = await fetchFromSiteOrMirror(nextPageUrl, hasChapter);
    if (!subPageResult) throw partMissing();
    const subResult = parseHtml(subPageResult.html, getSiteConfig(subPageResult.url)!, subPageResult.url);
    if (!subResult || !subResult.text.trim()) throw partMissing();
    fullText += "\n" + subResult.text;
    // The last sub-page has the real "next chapter" link
    if (subResult.nextUrl) finalNextUrl = subResult.nextUrl;
    nextPageUrl = subResult.nextPageUrl;
    subPage++;
  }

  // Use the first page's prevUrl, and the last sub-page's nextUrl (next chapter)
  if (finalNextUrl) result.nextUrl = finalNextUrl;

  const cleaned = fullText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    // Also strips the &nbsp; / full-width space indentation the sites use
    .map((line) => line.trim())
    .filter((line) => !siteConfig.junkLine?.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const novelName = result.customNovelName || "";
  const chapterName = result.customChapterName || result.h1 || result.fullTitle;
  const titleStr = result.customChapterName || result.fullTitle || result.h1 || "";

  return {
    text: cleaned,
    // On the site's own domain when a mirror served the page
    prevUrl: result.prevUrl && canonicalUrl(result.prevUrl),
    nextUrl: result.nextUrl && canonicalUrl(result.nextUrl),
    title: titleStr,
    novelName,
    chapterName,
    lang: siteConfig.lang || "vi",
  };
}

// A chapter URL for `url`: the book's first chapter when `url` is a book's
// page, otherwise `url` itself (chapters are checked when they are fetched)
export async function resolveChapterUrl(url: string): Promise<string> {
  const bookUrl = bookPageUrl(url);
  if (!bookUrl) return canonicalUrl(url);
  const siteConfig = getSiteConfig(bookUrl)!;

  const page = await fetchFromSiteOrMirror(bookUrl);
  if (!page) throw new FetchContentError("Could not load the novel's page. Please try again.", 502);

  const $ = cheerio.load(page.html);
  for (const find of siteConfig.firstChapter) {
    const href = typeof find === "string" ? $(find).first().attr("href") : find($);
    if (!href) continue;
    try {
      const chapter = new URL(href, page.url);
      // Keep https when the site redirected to plain http
      if (new URL(bookUrl).protocol === "https:") chapter.protocol = "https:";
      if (isChapterUrl(chapter.href)) return canonicalUrl(chapter.href);
    } catch {
      // not a usable link; try the next selector
    }
  }
  throw new FetchContentError("Could not find the first chapter on the novel's page", 422);
}
