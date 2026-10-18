import { GlossaryTerm, SavedChapter } from "./types";
import { importTerms, makeNameFixer, sanitizeTerms } from "./glossary";
import {
  getGlossary,
  getGlossaryNovels,
  getLastReadMap,
  getSavedChapters,
  getScrollPositions,
  restoreLibrary,
  reviveNovel,
  rewriteNovelChapters,
  saveGlossary,
  withStorageLock,
} from "./storage";
import { downloadBlob } from "./exportNovel";

// The whole library in one file (without settings or API keys), to restore
// later or on another device

const FILE_FORMAT = "novel-translator-backup";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringMap(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function scrollMap(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] =>
    typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0
  ));
}

// Copy only chapter fields, so arbitrary properties never enter storage or a backup.
function parseChapter(value: unknown): SavedChapter | null {
  if (!isRecord(value)) return null;
  const { url, title, novelName, novelSlug, simplifiedText, prevUrl, nextUrl, savedAt } = value;
  if (
    typeof url !== "string" || typeof title !== "string" || typeof novelName !== "string" ||
    typeof novelSlug !== "string" || typeof simplifiedText !== "string" ||
    (prevUrl !== null && typeof prevUrl !== "string") || (nextUrl !== null && typeof nextUrl !== "string") ||
    typeof savedAt !== "number" || !Number.isFinite(savedAt)
  ) return null;
  return { url, title, novelName, novelSlug, simplifiedText, prevUrl, nextUrl, savedAt };
}

export function exportLibrary(): void {
  const glossaries: Record<string, GlossaryTerm[]> = Object.fromEntries(getGlossaryNovels().map((slug) => [slug, getGlossary(slug)]));
  const exportedAt = new Date().toISOString();
  const backup = {
    format: FILE_FORMAT,
    version: 1,
    exportedAt,
    chapters: getSavedChapters().map(parseChapter).filter((chapter): chapter is SavedChapter => chapter !== null),
    glossaries,
    lastRead: stringMap(getLastReadMap()),
    scroll: scrollMap(getScrollPositions()),
  };
  downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), `novel-translator-backup-${exportedAt.slice(0, 10)}.json`);
}

// Counts valid unique chapter URLs and novels in the backup; skipped counts malformed chapters.
export async function importLibrary(file: File): Promise<{ chapters: number; novels: number; skipped: number } | null> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return null;
  }
  if (
    !isRecord(data) || data.format !== FILE_FORMAT || data.version !== 1 ||
    typeof data.exportedAt !== "string" || !Number.isFinite(Date.parse(data.exportedAt)) ||
    !Array.isArray(data.chapters) || !isRecord(data.glossaries) || !isRecord(data.lastRead) ||
    (data.scroll !== undefined && !isRecord(data.scroll))
  ) return null;
  const incoming = new Map<string, SavedChapter>();
  const novels = new Set<string>();
  let skipped = 0;
  for (const value of data.chapters) {
    const chapter = parseChapter(value);
    if (!chapter) {
      skipped++;
      continue;
    }
    const previous = incoming.get(chapter.url);
    if (!previous || chapter.savedAt > previous.savedAt) incoming.set(chapter.url, chapter);
  }
  for (const chapter of incoming.values()) novels.add(chapter.novelSlug);
  const glossaries = new Map<string, GlossaryTerm[]>();
  for (const [slug, value] of Object.entries(data.glossaries)) {
    if (!Array.isArray(value)) return null;
    const terms = sanitizeTerms(value);
    if (!terms) return null;
    glossaries.set(slug, terms);
    novels.add(slug);
  }
  const lastRead = stringMap(data.lastRead);
  const scroll = scrollMap(data.scroll ?? {});
  for (const slug of Object.keys(lastRead)) novels.add(slug);
  return withStorageLock(() => {
    const merged = new Map<string, SavedChapter>();
    for (const chapter of [...getSavedChapters(), ...incoming.values()]) {
      const previous = merged.get(chapter.url);
      if (!previous || chapter.savedAt > previous.savedAt) merged.set(chapter.url, chapter);
    }
    // Newest first, as saved chapters are kept
    const kept = new Set(restoreLibrary([...merged.values()].sort((a, b) => b.savedAt - a.savedAt), lastRead, scroll).map((c) => c.url));
    for (const slug of novels) reviveNovel(slug);
    // The chapters are in already; a full storage (StorageFullError) loses only names
    for (const [slug, imported] of glossaries) {
      const terms = importTerms(getGlossary(slug), imported);
      saveGlossary(slug, terms);
      // Every chapter written with the names as merged
      rewriteNovelChapters(slug, makeNameFixer(terms));
    }
    return { chapters: [...incoming.keys()].filter((url) => kept.has(url)).length, novels: novels.size, skipped };
  });
}
