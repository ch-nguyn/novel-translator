// The novel sites the app can read and the shapes of their URLs. Shared by
// the server scraper and the browser, so it must not import server-only code.

export interface NovelSite {
  // Matches this domain and its subdomains (www., m.)
  domain: string;
  homepage: string;
  label: string;
  // A chapter to try from the settings panel
  sample: string;
  // A book's page, which lists its chapters
  bookPath: RegExp;
  // A chapter page, including its sub-pages (_2.html)
  chapterPath: RegExp;
  // Groups chapters by novel: a key unique to the book, from the URL path
  novelSlug: (path: string) => string | null;
}

export const NOVEL_SITES: NovelSite[] = [
  {
    domain: "biquuge.com",
    homepage: "https://www.biquuge.com",
    label: "ZH",
    sample: "https://www.biquuge.com/0/229/245181.html",
    // Book: /{category}/{bookId}/   Chapter: /{category}/{bookId}/{chapterId}.html
    bookPath: /^\/\d+\/\d+\/?$/,
    chapterPath: /^\/\d+\/\d+\/\d+(?:_\d+)?\.html$/,
    // Book ids are numeric and could collide with another site's, so namespace them
    novelSlug: (path) => {
      const bookId = path.match(/^\/\d+\/(\d+)\//)?.[1];
      return bookId ? `biquuge-${bookId}` : null;
    },
  },
  {
    domain: "ixdzs.tw",
    homepage: "https://ixdzs.tw",
    label: "ZH-TW",
    sample: "https://ixdzs.tw/read/46710/p1.html",
    // Book: /read/{bookId}/   Chapter: /read/{bookId}/p{n}.html
    bookPath: /^\/read\/\d+\/?$/,
    chapterPath: /^\/read\/\d+\/p\d+(?:_\d+)?\.html$/,
    novelSlug: (path) => {
      const bookId = path.match(/^\/read\/(\d+)\//)?.[1];
      return bookId ? `ixdzs-${bookId}` : null;
    },
  },
];

function parseWebUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

// Matches on the URL's real hostname (exact domain or a subdomain of it), so
// arbitrary URLs that merely contain a supported domain are rejected
export function findSite(url: string): NovelSite | null {
  const parsed = parseWebUrl(url);
  if (!parsed) return null;
  const hostname = parsed.hostname.replace(/\.+$/, "").toLowerCase();
  return NOVEL_SITES.find((s) => hostname === s.domain || hostname.endsWith("." + s.domain)) ?? null;
}

// A link pasted without its scheme ("www.biquuge.com/9/9685") still works
export function normalizeEnteredUrl(raw: string): string {
  const url = raw.trim();
  return /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

// The book page `url` points to, normalized with the trailing slash the
// sites require, or null when it is not a book page of a supported site
export function bookPageUrl(url: string): string | null {
  const parsed = parseWebUrl(url);
  const site = findSite(url);
  if (!parsed || !site || !site.bookPath.test(parsed.pathname)) return null;
  if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

// Whether `url` is a chapter page of a supported site (not its book page,
// nor e.g. the "end of the book" page some sites link after the last chapter)
export function isChapterUrl(url: string): boolean {
  const parsed = parseWebUrl(url);
  const site = findSite(url);
  return !!parsed && !!site && site.chapterPath.test(parsed.pathname);
}
