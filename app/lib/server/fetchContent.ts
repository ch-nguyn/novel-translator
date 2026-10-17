import * as cheerio from "cheerio";

interface SiteConfig {
  content: string;
  lang?: "vi" | "zh";
  removeSelectors?: string[];
  novelNameSelector?: string;
  chapterNameSelector?: string;
  // Custom title parser when underscore-split heuristic does not fit (e.g. biquuge h1: "chapter-《novel》")
  extractTitles?: (fullTitle: string, h1: string) => { chapterName: string; novelName: string };
}

const SITE_SELECTORS: Record<string, SiteConfig> = {
  "quanben.io": {
    content: "#content",
    lang: "zh",
  },
  "www.22biqu.com": {
    content: "#content",
    lang: "zh",
  },
  "m.22biqu.com": {
    content: "#chaptercontent",
    lang: "zh",
  },
  "shuhaige.net": {
    content: "#content",
    lang: "zh",
  },
  "biquuge.com": {
    content: "article",
    lang: "zh",
    extractTitles: (_fullTitle, h1) => {
      const m = h1.match(/^(.+?)-《(.+?)》$/);
      if (m) return { chapterName: m[1].trim(), novelName: m[2].trim() };
      return { chapterName: h1, novelName: "" };
    },
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
  },
  "truyenfull.vision": {
    content: "#chapter-c",
    lang: "vi",
    removeSelectors: ["#ads-chapter-top", "[id^='ads-']", "script", "style"],
    novelNameSelector: ".truyen-title",
    chapterNameSelector: ".chapter-title",
  },
};

function rewriteUrl(url: string): string {
  if (url.includes("69shuba.tw")) {
    throw new Error(
      "69shuba.tw is blocked by CAPTCHA. Use 69shuba.com instead (same novels, e.g. https://www.69shuba.com/book/NOVEL_ID.htm)"
    );
  }
  return url;
}

function getSiteConfig(url: string) {
  for (const [domain, config] of Object.entries(SITE_SELECTORS)) {
    if (url.includes(domain)) return config;
  }
  return null;
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
    if (!nav.prevChapter && (text === "Chương trước" || text === "上一章")) nav.prevChapter = href;
    if (!nav.nextChapter && (text === "Tiếp theo" || text === "Chương sau" || text === "Chương tiếp" || text === "下一章")) nav.nextChapter = href;
    // Sub-page navigation (within same chapter)
    if (!nav.nextPage && text === "下一页") nav.nextPage = href;
    if (!nav.prevPage && text === "上一页") nav.prevPage = href;
  });

  // truyenfull.vision: explicit ids
  if (!nav.prevChapter) {
    const h = $("#prev_chap").attr("href");
    if (isRealUrl(h)) nav.prevChapter = h;
  }
  if (!nav.nextChapter) {
    const h = $("#next_chap").attr("href");
    if (isRealUrl(h)) nav.nextChapter = h;
  }

  if (!nav.prevChapter) {
    const h = $("a.truoc").attr("href");
    if (isRealUrl(h)) nav.prevChapter = h;
  }
  if (!nav.nextChapter) {
    const h = $("a.sau").attr("href");
    if (isRealUrl(h)) nav.nextChapter = h;
  }

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

  if (siteConfig.removeSelectors) {
    for (const sel of siteConfig.removeSelectors) {
      $(siteConfig.content).find(sel).remove();
    }
  }

  const contentEl = $(siteConfig.content);
  if (!contentEl.length) {
    return null;
  }

  // Preserve paragraph breaks: turn <br> into newlines before extracting text
  contentEl.find("br").replaceWith("\n");

  const text = contentEl.text();
  const { fullTitle, h1 } = extractTitles($);
  const nav = extractNav($, baseUrl);

  const origin = new URL(baseUrl).origin;
  const abs = (u: string | null) => u && !u.startsWith("http") ? origin + u : u;

  let customNovelName = siteConfig.novelNameSelector
    ? $(siteConfig.novelNameSelector).first().text().trim()
    : "";
  let customChapterName = siteConfig.chapterNameSelector
    ? $(siteConfig.chapterNameSelector).first().text().trim().replace(/\s+/g, " ")
    : "";

  if (siteConfig.extractTitles) {
    const parsed = siteConfig.extractTitles(fullTitle, h1);
    if (!customChapterName && parsed.chapterName) customChapterName = parsed.chapterName;
    if (!customNovelName && parsed.novelName) customNovelName = parsed.novelName;
  }

  return {
    text,
    fullTitle,
    h1,
    prevUrl: abs(nav.prevChapter),
    nextUrl: abs(nav.nextChapter),
    nextPageUrl: abs(nav.nextPage),
    customNovelName,
    customChapterName,
  };
}

async function fetchWithCheerio(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,vi;q=0.6",
      Referer: new URL(url).origin + "/",
    },
  });

  if (!res.ok) return null;

  const html = await res.text();
  // Detect Cloudflare challenge page
  if (html.includes("Just a moment") || html.includes("challenge-platform")) {
    return null;
  }
  return html;
}

async function fetchWithPuppeteer(url: string, contentSelector: string): Promise<string> {
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
      "https://github.com/nichochar/chromium-brotli/releases/download/v143.0.0/chromium-v143.0.0-pack.tar"
    );
    args = chromium.default.args;
  }

  const browser = await puppeteer.default.launch({
    args,
    executablePath,
    headless: true,
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

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Wait for content to appear (Cloudflare challenge may take a few seconds)
    await page.waitForSelector(contentSelector, { timeout: 15000 });

    return await page.content();
  } finally {
    await browser.close();
  }
}

export class FetchContentError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
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

export async function fetchContent(url: string, providedHtml?: string): Promise<ChapterContent> {
  const siteConfig = getSiteConfig(url);
  if (!siteConfig) {
    const supported = Object.keys(SITE_SELECTORS).join(", ");
    throw new FetchContentError(`Unsupported site. Supported: ${supported}`, 400);
  }

  const fetchUrl = rewriteUrl(url);

  // 1. Use provided HTML if available
  // 2. Try simple fetch
  // 3. Fallback to Puppeteer for Cloudflare-protected sites
  let pageHtml = providedHtml || (await fetchWithCheerio(fetchUrl));

  if (!pageHtml) {
    pageHtml = await fetchWithPuppeteer(fetchUrl, siteConfig.content);
  }

  const result = parseHtml(pageHtml, siteConfig, fetchUrl);

  if (!result || !result.text.trim()) {
    throw new FetchContentError("Could not find chapter content on this page", 422);
  }

  // Follow sub-pages (e.g. 22biqu splits chapters into _2.html, _3.html)
  let fullText = result.text;
  let nextPageUrl = result.nextPageUrl;
  let finalNextUrl = result.nextUrl;
  const maxSubPages = 20;
  let subPage = 0;

  while (nextPageUrl && subPage < maxSubPages) {
    const subHtml = await fetchWithCheerio(nextPageUrl);
    if (!subHtml) break;
    const subResult = parseHtml(subHtml, siteConfig, nextPageUrl);
    if (!subResult || !subResult.text.trim()) break;
    fullText += "\n" + subResult.text;
    // The last sub-page has the real "next chapter" link
    if (subResult.nextUrl) finalNextUrl = subResult.nextUrl;
    nextPageUrl = subResult.nextPageUrl;
    subPage++;
  }

  // Use the first page's prevUrl, and the last sub-page's nextUrl (next chapter)
  if (finalNextUrl) result.nextUrl = finalNextUrl;

  const cleaned = fullText
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let novelName = result.customNovelName || "";
  let chapterName = result.customChapterName || "";
  const titleStr = chapterName || result.fullTitle || result.h1 || "";

  if (siteConfig.lang === "zh" && !chapterName) {
    // Try splitting title by common separators: "_" or " - "
    // 22biqu:   "第2章 飞剑_叩问仙道_笔趣阁"  → chapter_novel_site
    // quanben:  "第1章 山边小村 凡人修仙传 - 全本小说网" → h1 + novel - site
    const underscoreParts = result.fullTitle.split("_");
    if (underscoreParts.length >= 3) {
      // Format: chapterName_novelName_siteName
      chapterName = underscoreParts[0].trim();
      novelName = underscoreParts[1].trim();
    } else {
      // H1 is the chapter title (quanben style)
      chapterName = result.h1 || "";

      // Derive novel name: remove h1 and site name from full title
      if (result.fullTitle && chapterName) {
        let remaining = result.fullTitle;
        remaining = remaining.replace(chapterName, "").trim();
        remaining = remaining.split(" - ")[0].trim();
        if (remaining) novelName = remaining;
      }

      // Fallback: if title has " - " pattern like "Novel - Chapter - Site"
      if (!novelName && !chapterName) {
        const parts = titleStr.split(" - ");
        if (parts.length >= 2) {
          novelName = parts[0].trim();
          chapterName = parts[1].trim();
        } else {
          chapterName = titleStr;
        }
      }
    }
  }

  return {
    text: cleaned,
    prevUrl: result.prevUrl,
    nextUrl: result.nextUrl,
    title: titleStr,
    novelName,
    chapterName,
    lang: siteConfig.lang || "vi",
  };
}
