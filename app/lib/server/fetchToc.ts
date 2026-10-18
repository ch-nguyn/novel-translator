import * as cheerio from "cheerio";
import { canonicalUrl, findSite, mirrorUrls } from "../sites";
import { FetchContentError, FetchedPage, fetchWithCheerio } from "./fetchContent";

// A novel's table of contents: every chapter its site lists, in reading order
// (see app/api/toc). Announcements and afterwords listed among the chapters
// are kept: they are where the site puts them.

export interface TocChapter {
  title: string;
  url: string;
}

export interface Toc {
  bookUrl: string;
  novelTitle: string;
  chapters: TocChapter[];
}

// Only how many chapters there are and the newest one: what checking for
// new chapters needs, in one or two requests even for a long novel
export interface TocSummary {
  total: number;
  latestTitle: string;
}

// Pages of a paginated list fetched at once (biquuge.com refuses quick bursts)
const CONCURRENCY = 3;
const MAX_PAGES = 1000;
// twkan.cc lists 500 chapters per page
const TWKAN_PAGE_SIZE = 500;
// A list page that has not come by then is asked for again
const PAGE_TIMEOUT_MS = 10_000;
// Pages are not asked for any more after this long, well within the
// function's time limit (app/api/toc: 60s)
const DEADLINE_MS = 40_000;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

interface Located {
  site: "biquuge.com" | "ixdzs.tw" | "twkan.cc" | "quanben.io";
  // The novel's page, on the host of the URL asked for (quanben.io's big5.
  // edition is a different text), the main site for a mirror
  book: URL;
  id: string;
  // A chapter of this novel, by path
  chapterPath: RegExp;
}

function locate(raw: string): Located {
  let url: URL;
  try {
    url = new URL(canonicalUrl(raw));
  } catch {
    throw new FetchContentError("Invalid URL", 400);
  }
  url.search = "";
  url.hash = "";
  const site = findSite(url.href)?.domain;
  let match: RegExpMatchArray | null;
  if (site === "biquuge.com" && (match = url.pathname.match(/^\/(\d+\/\d+)(?:\/(?:\d+(?:_\d+)?\.html|index_\d+\.html)?)?$/))) {
    url.pathname = `/${match[1]}/`;
    return { site, book: url, id: match[1], chapterPath: new RegExp(`^/${match[1]}/\\d+\\.html$`) };
  }
  if (site === "ixdzs.tw" && (match = url.pathname.match(/^\/read\/(\d+)(?:\/(?:p\d+(?:_\d+)?\.html)?)?$/))) {
    url.pathname = `/read/${match[1]}/`;
    return { site, book: url, id: match[1], chapterPath: new RegExp(`^/read/${match[1]}/p\\d+\\.html$`) };
  }
  if (site === "twkan.cc" && (match = url.pathname.match(/^\/(?:book\/([A-Za-z0-9]+)\.html|chapter\/([A-Za-z0-9]+)(?:\/[A-Za-z0-9]+)?\.html)$/))) {
    const id = match[1] || match[2];
    url.pathname = `/book/${id}.html`;
    // Chapter ids have letters; numeric names are pages of the list
    return { site, book: url, id, chapterPath: new RegExp(`^/chapter/${id}/(?=\\d*[A-Za-z])[A-Za-z0-9]+\\.html$`) };
  }
  if (site === "quanben.io" && (match = url.pathname.match(/^\/(?:amp\/)?n\/([a-z0-9_-]+)(?:\/(?:(?:\d+|list)\.html)?)?$/))) {
    url.pathname = `/n/${match[1]}/`;
    return { site, book: url, id: match[1], chapterPath: new RegExp(`^/n/${match[1]}/\\d+\\.html$`) };
  }
  throw new FetchContentError("This link is not a novel or chapter of a supported site", 400);
}

// A page that has `selector`, from the site or its mirror, whichever has it
// first (biquuge.com often fails its list pages that biquge520.net serves)
async function fetchList(url: string, selector: string): Promise<FetchedPage> {
  const fetchOne = async (from: string) => {
    const page = await fetchWithCheerio(from, PAGE_TIMEOUT_MS);
    // Redirected elsewhere (e.g. a missing page to the first one): not the page asked for
    if (!page || new URL(page.url).pathname !== new URL(from).pathname) throw new Error(`Not the page at ${from}`);
    if (cheerio.load(page.html)(selector).length === 0) throw new Error(`No chapter list at ${from}`);
    return page;
  };
  // Sites drop a request now and then under a burst of them: once more
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await Promise.any([url, ...mirrorUrls(url)].map(fetchOne));
    } catch {
      // all failed
    }
  }
  throw new FetchContentError("Could not load the novel's chapter list. Please try again.", 502);
}

// Fetches `urls` a few at a time, in order, giving up at `deadline`
async function fetchAll<T>(urls: string[], fetchOne: (url: string) => Promise<T>, deadline: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    if (Date.now() > deadline) throw new FetchContentError("The novel's site is too slow to list its chapters right now. Please try again.", 504);
    results.push(...(await Promise.all(urls.slice(i, i + CONCURRENCY).map(fetchOne))));
  }
  return results;
}

function chapterLinks(page: FetchedPage, selector: string, novel: Located): TocChapter[] {
  const $ = cheerio.load(page.html);
  const found: TocChapter[] = [];
  $(selector).each((_, element) => {
    const href = $(element).attr("href");
    const title = clean($(element).text());
    if (!href || !title) return;
    let link: URL;
    try {
      link = new URL(href, page.url);
    } catch {
      return;
    }
    // quanben.io's full list is on its AMP pages, which link to AMP chapters
    if (novel.site === "quanben.io") link.pathname = link.pathname.replace(/^\/amp\//, "/");
    if (!novel.chapterPath.test(link.pathname) || findSite(link.href)?.domain !== novel.site) return;
    // On the host asked for (not a mirror's), so chapters match the saved ones
    found.push({ title, url: new URL(link.pathname, novel.book).href });
  });
  return found;
}

function twkanPages(page: FetchedPage, novel: Located): number {
  const $ = cheerio.load(page.html);
  let pages = 1;
  $("#linkIndex option[value]").each((_, option) => {
    const path = new URL($(option).attr("value") || "", page.url).pathname;
    const number = Number(path.match(new RegExp(`^/chapter/${novel.id}/(\\d+)\\.html$`))?.[1]);
    if (number > pages && number <= MAX_PAGES) pages = number;
  });
  return pages;
}

function biquugePages($: cheerio.CheerioAPI, page: FetchedPage, novel: Located): number {
  let pages = Number(clean($(".pagination .disabled").text()).match(/\d+\s*\/\s*(\d+)/)?.[1] ?? 1);
  $(".pagination a[href]").each((_, a) => {
    const path = new URL($(a).attr("href") || "", page.url).pathname;
    const number = Number(path.match(new RegExp(`^/${novel.id}/index_(\\d+)\\.html$`))?.[1]);
    if (number > pages) pages = number;
  });
  return Math.min(pages, MAX_PAGES);
}

// "共2525章" in biquuge.com's list heading
const biquugeCount = ($: cheerio.CheerioAPI) => Number(clean($("h2").text()).match(/共\s*(\d+)\s*章/)?.[1] ?? NaN);

const SELECTORS = {
  "biquuge.com": ".book_list2 li a[href]",
  "ixdzs.tw": ".u-chapter:not(.cfirst) li a[href]",
  "twkan.cc": "#allchapter dd a[href]",
  "quanben.io": ".list3 li a[href]",
};

// The first page of the list, and where it is
function firstListUrl(novel: Located): string {
  // twkan.cc's novel page shows only the latest chapters under the same id
  if (novel.site === "twkan.cc") return new URL(`/chapter/${novel.id}.html`, novel.book).href;
  // quanben.io's own list hides its middle behind a script; its AMP copy has it all
  if (novel.site === "quanben.io") return new URL(`/amp/n/${novel.id}/list.html`, novel.book).href;
  return novel.book.href;
}

function novelTitleOf($: cheerio.CheerioAPI): string {
  const title = clean($('meta[property="og:novel:book_name"]').attr("content") || "") || clean($("h1").first().text());
  // twkan.cc's list page: 我不是戲神章節列表
  return title.replace(/\s*(?:章[节節])?(?:列表|目[录錄])$/, "");
}

export async function fetchToc(url: string): Promise<Toc> {
  const deadline = Date.now() + DEADLINE_MS;
  const novel = locate(url);
  const selector = SELECTORS[novel.site];
  const first = await fetchList(firstListUrl(novel), selector);
  const $ = cheerio.load(first.html);

  const pages = [first];
  if (novel.site === "biquuge.com" || novel.site === "twkan.cc") {
    const count = novel.site === "biquuge.com" ? biquugePages($, first, novel) : twkanPages(first, novel);
    const more = Array.from({ length: count - 1 }, (_, i) =>
      new URL(novel.site === "biquuge.com" ? `index_${i + 2}.html` : `/chapter/${novel.id}/${i + 2}.html`, novel.book).href
    );
    pages.push(...(await fetchAll(more, (pageUrl) => fetchList(pageUrl, selector), deadline)));
  }

  const chapters: TocChapter[] = [];
  const seen = new Set<string>();
  let listed = 0;
  for (const page of pages) {
    for (const chapter of chapterLinks(page, selector, novel)) {
      listed++;
      if (seen.has(chapter.url)) continue;
      seen.add(chapter.url);
      chapters.push(chapter);
    }
  }
  if (chapters.length === 0) throw new FetchContentError("This novel's site lists no chapters", 502);
  // The site says how many there are: a page that came back short is not passed off as the whole list
  const expected = novel.site === "biquuge.com" ? biquugeCount($) : NaN;
  if (!isNaN(expected) && listed < expected) {
    throw new FetchContentError("Could not load the whole chapter list. Please try again.", 502);
  }
  return { bookUrl: novel.book.href, novelTitle: novelTitleOf($), chapters };
}

export async function fetchTocSummary(url: string): Promise<TocSummary> {
  const novel = locate(url);
  const selector = SELECTORS[novel.site];
  if (novel.site === "biquuge.com") {
    const first = await fetchList(novel.book.href, selector);
    const $ = cheerio.load(first.html);
    const total = biquugeCount($);
    const latestTitle = clean($('meta[property="og:novel:latest_chapter_name"]').attr("content") || "");
    if (!isNaN(total) && latestTitle) return { total, latestTitle };
  } else if (novel.site === "twkan.cc") {
    // The last page of the list, after the full ones before it
    const first = await fetchList(firstListUrl(novel), selector);
    const pages = twkanPages(first, novel);
    const last = pages > 1 ? await fetchList(new URL(`/chapter/${novel.id}/${pages}.html`, novel.book).href, selector) : first;
    const chapters = chapterLinks(last, selector, novel);
    if (chapters.length > 0) {
      return { total: (pages - 1) * TWKAN_PAGE_SIZE + chapters.length, latestTitle: chapters[chapters.length - 1].title };
    }
  }
  // The whole list is one page anyway
  const { chapters } = await fetchToc(url);
  return { total: chapters.length, latestTitle: chapters[chapters.length - 1].title };
}
