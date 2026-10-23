import { ChapterRecap } from "./types";
import { sanitizeOrder } from "./glossary";
import { compareOrder, sortByChapter } from "./sites";

// A novel's chapter summaries (written when a chapter's names are looked for,
// see app/lib/server/extractTerms.ts), kept to remind a reader coming back to
// the novel of what happened. Synced with the novel's names
// (app/lib/librarySync.ts). Shared by the server and the browser.

// Per novel: the latest chapters'
export const MAX_RECAPS = 300;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 120;
const MAX_SUMMARY_LENGTH = 400;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return text && text.length <= maxLength ? text : null;
}

// Validates recaps from an untrusted source; malformed ones are dropped,
// null if it is not a list or is too long
export function sanitizeRecaps(value: unknown): ChapterRecap[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_RECAPS) return null;
  const recaps: ChapterRecap[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const url = typeof raw.url === "string" && raw.url.length <= MAX_URL_LENGTH && /^https?:\/\//.test(raw.url) ? raw.url : null;
    const title = cleanText(raw.title, MAX_TITLE_LENGTH);
    const summary = cleanText(raw.summary, MAX_SUMMARY_LENGTH);
    const at = Number.isSafeInteger(raw.at) && (raw.at as number) > 0 ? (raw.at as number) : null;
    if (!url || title === null || !summary || !at) continue;
    const recap: ChapterRecap = { url, title, summary, at };
    const order = sanitizeOrder(raw.order);
    if (order) recap.order = order;
    recaps.push(recap);
  }
  return recaps;
}

// Two devices' recaps of a novel together: one per chapter (the later), the
// latest MAX_RECAPS chapters
export function unionRecaps(a: ChapterRecap[], b: ChapterRecap[]): ChapterRecap[] {
  const byUrl = new Map<string, ChapterRecap>();
  for (const recap of [...a, ...b]) {
    const kept = byUrl.get(recap.url);
    if (!kept || kept.at < recap.at) byUrl.set(recap.url, recap);
  }
  return sortByChapter([...byUrl.values()]).slice(-MAX_RECAPS);
}

// The chapters just before the one at `url` (whose place is `order`), the
// latest last: none after it (chapters translated ahead), nor any whose place
// is not known (one read earlier cannot be told from one ahead)
export function recapsBefore(recaps: ChapterRecap[], url: string, order: number[] | null, count: number): ChapterRecap[] {
  if (!order) return [];
  const before = recaps.filter((r) => r.url !== url && r.order && compareOrder(r.order, order) < 0);
  return sortByChapter(before).slice(-count);
}
