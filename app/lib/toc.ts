import { readErrorMessage } from "./api";
import { extractNovelSlug, getNovelUpdates, recordNovelToc } from "./storage";

// A novel's table of contents: every chapter its site lists, in reading
// order (see app/api/toc). Only titles and links, so it costs no translation.

export interface TocChapter {
  // As the site writes it (Chinese)
  title: string;
  url: string;
}

export interface NovelToc {
  bookUrl: string;
  novelTitle: string;
  chapters: TocChapter[];
}

// The site is asked again after this long; the server caches it about as long
const MAX_AGE_MS = 10 * 60 * 1000;
const cache = new Map<string, { toc: NovelToc; at: number }>();

// This tab's copy of a novel's table of contents, if it was loaded lately
export function getCachedToc(url: string): NovelToc | null {
  const cached = cache.get(extractNovelSlug(url));
  return cached && Date.now() - cached.at < MAX_AGE_MS ? cached.toc : null;
}

// The table of contents of the novel `url` (a chapter or the novel's page)
// belongs to. `fresh` skips this tab's copy, for "check for new chapters".
export async function fetchNovelToc(url: string, { signal, fresh = false }: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<NovelToc> {
  const slug = extractNovelSlug(url);
  const cached = cache.get(slug);
  if (!fresh && cached && Date.now() - cached.at < MAX_AGE_MS) return cached.toc;
  const params = new URLSearchParams({ url });
  // A different address skips the server's cached answer
  if (fresh) params.set("at", String(Date.now()));
  const res = await fetch(`/api/toc?${params}`, { signal });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Could not load the table of contents"));
  const toc: NovelToc = await res.json();
  cache.set(slug, { toc, at: Date.now() });
  return toc;
}

const DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNITS: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };

// 五百二十三 → 523, 一零二 → 102, 十二 → 12
export function parseChineseNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return parseInt(text, 10);
  if (![...text].every((c) => c in DIGITS || c in UNITS || c === "万" || c === "萬")) return null;
  // Written digit by digit, without units
  if (![...text].some((c) => c in UNITS || c === "万" || c === "萬")) {
    return parseInt([...text].map((c) => DIGITS[c]).join(""), 10);
  }
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const c of text) {
    if (c in DIGITS) digit = DIGITS[c];
    else if (c in UNITS) {
      section += (digit || 1) * UNITS[c];
      digit = 0;
    } else {
      total += (section + digit) * 10000;
      section = 0;
      digit = 0;
    }
  }
  return total + section + digit;
}

// The chapter number in a site's title: 第五百二十三章 剑出 → 523, 第12章 → 12
export function tocChapterNumber(title: string): number | null {
  const match = title.match(/第\s*([0-9零〇一二两兩三四五六七八九十拾百佰千仟万萬]+)\s*[章节節回话話]/);
  return match ? parseChineseNumber(match[1]) : null;
}

// The site's title with its chapter number in Vietnamese: 第五百二十三章 剑出 →
// Chương 523: 剑出 (a volume before it stays: 第七卷 纵横人界 Chương 1230: 图谋阴罗)
export function readableTocTitle(title: string): string {
  const match = title.match(/第\s*([0-9零〇一二两兩三四五六七八九十拾百佰千仟万萬]+)\s*[章节節回话話]\s*[:：、.]?\s*/);
  const number = match && parseChineseNumber(match[1]);
  if (number === null || !match) return title;
  const before = title.slice(0, match.index);
  const rest = title.slice(match.index! + match[0].length).trim();
  return `${before}Chương ${number}${rest ? `: ${rest}` : ""}`;
}

const titleCache = new Map<string, string>();

// Vietnamese titles for `titles` (Chinese), by title; the ones the AI gave
// none for are missing. By the app's AI (see helperAi), or from the server's
// cache when another reader looked them up.
export async function translateTocTitles(titles: string[], apiKey: string, signal?: AbortSignal): Promise<Map<string, string>> {
  const missing = [...new Set(titles)].filter((title) => !titleCache.has(title));
  if (missing.length > 0) {
    const res = await fetch("/api/toc/titles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles: missing, apiKey }),
      signal,
    });
    if (res.ok) {
      const { titles: found } = (await res.json()) as { titles: Record<string, string> };
      for (const [title, translated] of Object.entries(found)) titleCache.set(title, translated);
    }
  }
  return new Map(titles.flatMap((title) => (titleCache.has(title) ? [[title, titleCache.get(title)!] as const] : [])));
}

// A novel is looked up again after this long, unless the reader asks
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
// Sites asked at once
const CHECK_CONCURRENCY = 2;

// Looks up how many chapters each novel's site lists now (see recordNovelToc).
// `urls`: a chapter of each novel. Without `force`, novels checked recently
// are skipped. Returns the slugs of the novels that have chapters they did not have before.
export async function checkNovelUpdates(urls: string[], { force = false, signal }: { force?: boolean; signal?: AbortSignal } = {}): Promise<string[]> {
  const updates = getNovelUpdates();
  const due = urls.filter((url) => force || !(Date.now() - (updates[extractNovelSlug(url)]?.checkedAt ?? 0) < UPDATE_CHECK_INTERVAL_MS));
  const grown: string[] = [];
  const queue = [...due];
  const worker = async () => {
    for (let url = queue.shift(); url && !signal?.aborted; url = queue.shift()) {
      try {
        const params = new URLSearchParams({ url, summary: "1" });
        // A different address skips the server's cached answer
        if (force) params.set("at", String(Date.now()));
        const res = await fetch(`/api/toc?${params}`, { signal });
        if (!res.ok) continue;
        const { total, latestTitle }: { total: number; latestTitle: string } = await res.json();
        if (!(total > 0) || signal?.aborted) continue;
        const slug = extractNovelSlug(url);
        const before = getNovelUpdates()[slug]?.total;
        recordNovelToc(slug, total, latestTitle);
        // This tab's copy of the list is out of date
        if (cache.get(slug)?.toc.chapters.length !== total) cache.delete(slug);
        if (before !== undefined && total > before) grown.push(slug);
      } catch {
        // The site is down or changed: checked again next time
      }
    }
  };
  await Promise.all(Array.from({ length: CHECK_CONCURRENCY }, worker));
  return grown;
}
