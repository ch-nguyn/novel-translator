import { findSite } from "./sites";
import { tocChapterNumber } from "./toc";

// Where a reader is in a novel on their shelf, as two devices may each have
// it (app/lib/librarySync.ts, app/lib/server/library.ts). Shared by the
// server and the browser.

export interface ReadingPlace {
  url: string;
  chapterTitle: string;
  paragraph: number;
  removed?: boolean;
  // When it last changed, on the device that changed it
  updatedAt: number;
}

// The chapter's place in its novel, comparable with its other chapters':
// from the link on sites numbering their chapters in order, else from the
// chapter number in its title. Null when neither tells.
export function chapterOrder(url: string, chapterTitle: string): number[] | null {
  try {
    const order = findSite(url)?.chapterOrder?.(new URL(url).pathname);
    if (order) return order;
  } catch {
    return null;
  }
  // 第一百二十章 …, or as translated: Chương 120: …
  const number = tocChapterNumber(chapterTitle) ?? Number(chapterTitle.match(/^\s*Chương\s+(\d+)\b/i)?.[1] ?? NaN);
  return Number.isSafeInteger(number) ? [number] : null;
}

// Above 0 when `a` is further along than `b`, below when behind, 0 at the
// same place; null when the chapters' order is not known
function compareProgress(a: ReadingPlace, b: ReadingPlace): number | null {
  if (a.url !== b.url) {
    const x = chapterOrder(a.url, a.chapterTitle);
    const y = chapterOrder(b.url, b.chapterTitle);
    if (!x || !y) return null;
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    }
  }
  return a.paragraph - b.paragraph;
}

// Whether `incoming` (a change from another device) replaces `kept`: the
// place further along wins, so reading back on one device does not move the
// others back. The same device moving its own place (`sameDevice`), a
// deletion, or places whose order is not known: the later change wins.
export function replacesPlace(kept: ReadingPlace, incoming: ReadingPlace, sameDevice: boolean): boolean {
  const progress = sameDevice || kept.removed || incoming.removed ? null : compareProgress(incoming, kept);
  if (progress === null || progress === 0) return incoming.updatedAt > kept.updatedAt;
  return progress > 0;
}
