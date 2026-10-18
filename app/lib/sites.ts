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
  // Other domains serving the same pages at the same paths: their links are
  // read as this site's, and they are tried when this site fails
  mirrors?: string[];
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
    mirrors: ["biquge520.net"],
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
  {
    domain: "twkan.cc",
    homepage: "https://www.twkan.cc",
    label: "ZH-TW",
    sample: "https://www.twkan.cc/chapter/6xWidisB72Uwxqaddk1PxZ/3NbW6jms2oFnYcmaLKFhe4.html",
    // Book: /book/{bookId}.html   Chapter: /chapter/{bookId}/{chapterId}.html
    // (ids are letters and digits; /chapter/{bookId}/2.html is a page of the chapter list)
    bookPath: /^\/book\/[A-Za-z0-9]+\.html$/,
    chapterPath: /^\/chapter\/[A-Za-z0-9]+\/(?=\d*[A-Za-z])[A-Za-z0-9]+\.html$/,
    novelSlug: (path) => {
      const bookId = path.match(/^\/(?:book|chapter)\/([A-Za-z0-9]+)[/.]/)?.[1];
      return bookId ? `twkan-${bookId}` : null;
    },
  },
  {
    domain: "quanben.io",
    homepage: "https://www.quanben.io",
    label: "ZH",
    sample: "https://www.quanben.io/n/fanrenxiuxianzhuan/1.html",
    // Book: /n/{pinyin name}/   Chapter: /n/{pinyin name}/{n}.html (big5. serves the same in traditional)
    bookPath: /^\/n\/[a-z0-9_-]+\/?$/,
    chapterPath: /^\/n\/[a-z0-9_-]+\/\d+\.html$/,
    novelSlug: (path) => {
      const name = path.match(/^\/n\/([a-z0-9_-]+)\//)?.[1];
      return name ? `quanben-${name}` : null;
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

function onDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith("." + domain);
}

function hostnameOf(parsed: URL): string {
  return parsed.hostname.replace(/\.+$/, "").toLowerCase();
}

// Matches on the URL's real hostname (exact domain or a subdomain of it, or of
// a mirror), so arbitrary URLs that merely contain a supported domain are rejected
export function findSite(url: string): NovelSite | null {
  const parsed = parseWebUrl(url);
  if (!parsed) return null;
  const hostname = hostnameOf(parsed);
  return NOVEL_SITES.find((s) => [s.domain, ...(s.mirrors ?? [])].some((domain) => onDomain(hostname, domain))) ?? null;
}

// `url` on the site's own domain when it is on a mirror (the same page), so a
// chapter is saved once whichever domain served it; otherwise `url` itself
export function canonicalUrl(url: string): string {
  const parsed = parseWebUrl(url);
  const site = findSite(url);
  if (!parsed || !site?.mirrors || onDomain(hostnameOf(parsed), site.domain)) return url;
  parsed.host = new URL(site.homepage).host;
  parsed.protocol = "https:";
  return parsed.href;
}

// `url` on the site's other domains (its mirrors, or the site itself for a
// mirror's page), to try when the domain it is on fails
export function mirrorUrls(url: string): string[] {
  const parsed = parseWebUrl(url);
  const site = findSite(url);
  if (!parsed || !site?.mirrors) return [];
  return [site.domain, ...site.mirrors]
    .filter((domain) => !onDomain(hostnameOf(parsed), domain))
    .map((domain) => {
      const mirror = new URL(parsed.href);
      mirror.hostname = `www.${domain}`;
      mirror.protocol = "https:";
      return mirror.href;
    });
}

// A link pasted without its scheme ("www.biquuge.com/9/9685") still works
export function normalizeEnteredUrl(raw: string): string {
  const url = raw.trim();
  return canonicalUrl(/^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`);
}

// The book page `url` points to, normalized (on the site's own domain, with
// the trailing slash folder-style pages require), or null when it is not a
// book page of a supported site
export function bookPageUrl(url: string): string | null {
  const parsed = parseWebUrl(canonicalUrl(url));
  const site = findSite(url);
  if (!parsed || !site || !site.bookPath.test(parsed.pathname)) return null;
  if (!parsed.pathname.endsWith("/") && !parsed.pathname.endsWith(".html")) parsed.pathname += "/";
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
