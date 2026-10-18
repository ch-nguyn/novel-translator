import { GlossaryTerm, TranslateOptions } from "./types";
import { importTerms, makeNameFixer, mergeTerms, sanitizeTerms } from "./glossary";
import { getClearedNovels, getGlossary, getSavedChapters, rewriteNovelChapters, saveGlossary, withStorageLock } from "./storage";
import { extractChapterTerms, fetchChapterContent } from "./api";

// What the user does with a novel's glossary (app/lib/glossary.ts) in the
// browser: correct names, scan saved chapters, export and import it.

// Changes a novel's glossary and rewrites its saved chapters to match.
// Nothing changes if the novel was deleted (e.g. in another tab) or `signal`
// was aborted meanwhile. Throws StorageFullError when storage is full.
export function updateGlossary(
  novelSlug: string,
  change: (terms: GlossaryTerm[]) => GlossaryTerm[],
  signal?: AbortSignal
): Promise<void> {
  return withStorageLock(() => {
    if (signal?.aborted || getClearedNovels().has(novelSlug)) return;
    const terms = change(getGlossary(novelSlug));
    saveGlossary(novelSlug, terms);
    rewriteNovelChapters(novelSlug, makeNameFixer(terms));
  });
}

// Saved chapters scanned for names, most recently saved first
export const SCAN_CHAPTERS = 10;

// Finds the names in a novel's most recent saved chapters (translated before
// the glossary existed): each chapter's original is fetched again and lined
// up with its saved translation. Returns how many names were added.
export async function scanSavedChapters(
  novelSlug: string,
  options: TranslateOptions,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal
): Promise<number> {
  const chapters = getSavedChapters()
    .filter((c) => c.novelSlug === novelSlug)
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, SCAN_CHAPTERS);
  let added = 0;
  for (let i = 0; i < chapters.length && !signal.aborted; i++) {
    onProgress(i, chapters.length);
    const chapter = chapters[i];
    try {
      const { text: source } = await fetchChapterContent(chapter.url, signal);
      const found = await extractChapterTerms(chapter.url, source, chapter.simplifiedText, getGlossary(novelSlug), options, signal);
      if (signal.aborted) break;
      await updateGlossary(
        novelSlug,
        (terms) => {
          const merged = mergeTerms(terms, found);
          added += merged.length - terms.length;
          return merged;
        },
        signal
      );
    } catch {
      // Skip a chapter that cannot be fetched; stop when cancelled
    }
  }
  onProgress(chapters.length, chapters.length);
  return added;
}

const FILE_FORMAT = "novel-translator-glossary";

// Downloads the glossary as a JSON file others can import
export function exportGlossary(novelSlug: string, novelName: string) {
  const terms = getGlossary(novelSlug).map(({ firstSeen: _firstSeen, edited: _edited, ...term }) => term);
  const file = JSON.stringify({ format: FILE_FORMAT, version: 1, novel: novelName, terms }, null, 2);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([file], { type: "application/json" }));
  link.download = `${(novelName || novelSlug).replace(/[\\/:*?"<>|]+/g, " ").trim()} - names.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Merges an exported glossary file into the novel's; its names win over the
// ones already there. Returns how many names it had, or null if the file is not a glossary.
export async function importGlossary(novelSlug: string, file: File): Promise<number | null> {
  let imported: GlossaryTerm[] | null;
  try {
    const data = JSON.parse(await file.text());
    imported = sanitizeTerms(Array.isArray(data) ? data : data?.terms);
  } catch {
    return null;
  }
  if (!imported || imported.length === 0) return null;
  await updateGlossary(novelSlug, (terms) => importTerms(terms, imported));
  return imported.length;
}
