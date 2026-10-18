import { AI_VOICES, DEFAULT_AI_MODEL, DEFAULT_AI_VOICE, GlossaryTerm, SavedChapter, ReaderSettings, SPEECH_RATES } from "./types";
import { findSite } from "./sites";
import { MAX_STORED_TERMS, sanitizeTerms } from "./glossary";

const STORAGE_KEY = "novel-translator-chapters";
const CURRENT_KEY = "novel-translator-current";
const SETTINGS_KEY = "novel-translator-settings";
const SCROLL_KEY = "novel-translator-scroll";
const DEVICE_KEY = "novel-translator-device-id";
const CLEARED_NOVELS_KEY = "novel-translator-cleared-novels";
const PENDING_WINDOW_KEY = "novel-translator-pending-window";
// One key per novel: `${GLOSSARY_KEY_PREFIX}${novelSlug}`
const GLOSSARY_KEY_PREFIX = "novel-translator-glossary:";
const PENDING_WINDOW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SCROLL_POSITIONS = 300;
const MAX_CHAPTERS_PER_NOVEL = 100;
const REMOVED_MODEL_NAMES = new Set([
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
]);

const DEFAULT_SETTINGS: ReaderSettings = {
  bgColor: "#f5f5dc",
  fontSize: 18,
  lineSpacing: 1.8,
  openaiApiKey: "",
  geminiApiKey: "",
  claudeApiKey: "",
  openrouterApiKey: "",
  aiModel: DEFAULT_AI_MODEL,
  customPrompt: "",
  appLang: "vi",
  autoClearNovels: false,
  reasoningEffort: "medium",
  autoGlossary: true,
  speechEngine: "device",
  speechVoice: "",
  speechAiVoice: DEFAULT_AI_VOICE,
  speechRate: 1,
};

// Groups chapters by novel (e.g. biquuge.com/0/229/245181.html → biquuge-229)
export function extractNovelSlug(url: string): string {
  try {
    const { pathname } = new URL(url);
    const slug = findSite(url)?.novelSlug(pathname);
    if (slug) return slug;
    return pathname.split("/").filter(Boolean)[0] || "unknown";
  } catch {
    return "unknown";
  }
}

export function getSavedChapters(): SavedChapter[] {
  try {
    const chapters: SavedChapter[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]"
    );
    return chapters.map((c) => ({
      ...c,
      novelName: c.novelName || "",
      novelSlug: c.novelSlug || extractNovelSlug(c.url),
      prevUrl: c.prevUrl ?? null,
      nextUrl: c.nextUrl ?? null,
    }));
  } catch {
    return [];
  }
}

export function deduplicateTitle(title: string, novelSlug: string, chapters?: SavedChapter[]): string {
  const all = chapters ?? getSavedChapters();
  const sameNameCount = all.filter(
    (c) => c.novelSlug === novelSlug && c.title === title
  ).length;
  return sameNameCount > 0 ? `${title} (${sameNameCount + 1})` : title;
}

// Browser storage cannot fit a chapter even after removing every other one
export class StorageFullError extends Error {
  constructor() {
    super("Browser storage is full. Clear some novels and try again.");
    this.name = "StorageFullError";
  }
}

// Runs `fn` while holding a lock shared by every tab of the app, so two tabs
// never interleave a read-modify-write of the saved chapters
export async function withStorageLock<T>(fn: () => Promise<T> | T): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("novel-translator-storage", async () => fn());
  }
  return fn();
}

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

// Least recently saved chapter to drop when storage is full: other novels
// first, then older chapters of the same novel. Never the one being saved.
function pickEvictionVictim(chapters: SavedChapter[], keep: SavedChapter): SavedChapter | null {
  const candidates = chapters.filter((c) => c.url !== keep.url);
  if (candidates.length === 0) return null;
  return candidates.reduce((victim, c) => {
    const victimOther = victim.novelSlug !== keep.novelSlug;
    const cOther = c.novelSlug !== keep.novelSlug;
    if (cOther !== victimOther) return cOther ? c : victim;
    return c.savedAt < victim.savedAt ? c : victim;
  });
}

// Saves a chapter. When browser storage is full, the oldest chapters are
// removed until it fits; returns how many were removed.
export function saveChapter(chapter: SavedChapter): number {
  let chapters = getSavedChapters();
  const existing = chapters.findIndex((c) => c.url === chapter.url);
  if (existing >= 0) {
    chapters[existing] = chapter;
  } else {
    chapter = { ...chapter, title: deduplicateTitle(chapter.title, chapter.novelSlug, chapters) };
    chapters.unshift(chapter);
  }

  chapters = limitNovelChapters(chapters, chapter.novelSlug);

  const settings = getSettings();
  // Auto-clear: keep only the current novel, remove all others
  if (settings.autoClearNovels) {
    chapters = chapters.filter((c) => c.novelSlug === chapter.novelSlug);
  }

  let evicted = 0;
  while (true) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chapters));
      return evicted;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      const victim = pickEvictionVictim(chapters, chapter);
      if (!victim) throw new StorageFullError();
      chapters = chapters.filter((c) => c !== victim);
      evicted++;
    }
  }
}

function limitNovelChapters(chapters: SavedChapter[], novelSlug: string): SavedChapter[] {
  const novelChapters = chapters.filter((c) => c.novelSlug === novelSlug);
  if (novelChapters.length <= MAX_CHAPTERS_PER_NOVEL) return chapters;

  const sorted = novelChapters.sort((a, b) => b.savedAt - a.savedAt);
  const toRemove = new Set(sorted.slice(MAX_CHAPTERS_PER_NOVEL).map((c) => c.url));
  return chapters.filter((c) => c.novelSlug !== novelSlug || !toRemove.has(c.url));
}

// Storage keys whose change (in another tab) affects the open novel's names
export function isGlossaryStorageKey(key: string | null): boolean {
  return key === null || key === STORAGE_KEY || key.startsWith(GLOSSARY_KEY_PREFIX);
}

// Rewrites the text of a novel's saved chapters (e.g. after a name was corrected)
export function rewriteNovelChapters(novelSlug: string, rewrite: (text: string) => string) {
  let changed = false;
  const chapters = getSavedChapters().map((c) => {
    if (c.novelSlug !== novelSlug) return c;
    const simplifiedText = rewrite(c.simplifiedText);
    if (simplifiedText === c.simplifiedText) return c;
    changed = true;
    return { ...c, simplifiedText };
  });
  if (!changed) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chapters));
  } catch (e) {
    throw isQuotaError(e) ? new StorageFullError() : e;
  }
}

export function clearNovelChapters(novelSlug: string) {
  const chapters = getSavedChapters().filter((c) => c.novelSlug !== novelSlug);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chapters));
  const cleared = getClearedNovels();
  cleared.add(novelSlug);
  localStorage.setItem(CLEARED_NOVELS_KEY, JSON.stringify([...cleared]));
  localStorage.removeItem(GLOSSARY_KEY_PREFIX + novelSlug);
  // Clear current URL if it belonged to this novel
  const currentUrl = getCurrentUrl();
  if (currentUrl && extractNovelSlug(currentUrl) === novelSlug) {
    localStorage.removeItem(CURRENT_KEY);
  }
}

// Novels the user cleared. Chapters of these that a background job finishes
// later are discarded instead of being saved again.
export function getClearedNovels(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLEARED_NOVELS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

// The user is reading this novel again
export function reviveNovel(novelSlug: string) {
  const cleared = getClearedNovels();
  if (cleared.delete(novelSlug)) {
    localStorage.setItem(CLEARED_NOVELS_KEY, JSON.stringify([...cleared]));
  }
}

export function getCurrentUrl(): string | null {
  return localStorage.getItem(CURRENT_KEY);
}

export function setCurrentUrl(url: string) {
  try {
    localStorage.setItem(CURRENT_KEY, url);
  } catch {
    // storage full; losing the resume position is harmless
  }
}

export function getSettings(): ReaderSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (!stored) return DEFAULT_SETTINGS;
    const settings = { ...DEFAULT_SETTINGS, ...stored };
    if (shouldResetModel(settings.aiModel)) {
      settings.aiModel = DEFAULT_AI_MODEL;
    }
    delete (settings as Record<string, unknown>).autoClearChapters;
    delete (settings as Record<string, unknown>).autoClearChaptersKeep;
    delete (settings as Record<string, unknown>).autoLineBreak;
    delete (settings as Record<string, unknown>).referenceLinks;
    delete (settings as Record<string, unknown>).webSearch;
    // Migrate legacy single apiKey to openaiApiKey
    if (stored.apiKey && !stored.openaiApiKey) {
      settings.openaiApiKey = stored.apiKey;
    }
    const legacyReasoningEffort = (settings as unknown as { reasoningEffort?: string }).reasoningEffort;
    if (legacyReasoningEffort === "minimal") {
      settings.reasoningEffort = "low";
    }
    delete (settings as Record<string, unknown>).apiKey;
    if (settings.speechEngine !== "device" && settings.speechEngine !== "ai") settings.speechEngine = "device";
    if (!AI_VOICES.includes(settings.speechAiVoice)) settings.speechAiVoice = DEFAULT_AI_VOICE;
    if (!SPEECH_RATES.includes(settings.speechRate)) settings.speechRate = 1;
    if (typeof settings.speechVoice !== "string") settings.speechVoice = "";
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function shouldResetModel(model: unknown): boolean {
  if (typeof model !== "string") return true;
  if (model.startsWith("gemini")) return true;
  if (model.startsWith("claude")) return true;
  if (model.includes("/")) return true;
  return REMOVED_MODEL_NAMES.has(model);
}

export function saveSettings(settings: ReaderSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getScrollPosition(url: string): number {
  try {
    const positions = JSON.parse(localStorage.getItem(SCROLL_KEY) || "{}");
    return positions[url] || 0;
  } catch {
    return 0;
  }
}

export function saveScrollPosition(url: string, position: number) {
  try {
    const positions: Record<string, number> = JSON.parse(localStorage.getItem(SCROLL_KEY) || "{}");
    // Re-insert so the most recently read chapters stay at the end, then drop the oldest
    delete positions[url];
    positions[url] = position;
    const urls = Object.keys(positions);
    for (const old of urls.slice(0, Math.max(0, urls.length - MAX_SCROLL_POSITIONS))) {
      delete positions[old];
    }
    localStorage.setItem(SCROLL_KEY, JSON.stringify(positions));
  } catch {
    // ignore
  }
}

export function extractChapterNumber(title: string): number | null {
  const match =
    title.match(/(?:ch(?:ương|apter|ap)?|chương)\s*(\d+)/i) ||
    title.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// Anonymous id that scopes this browser's background jobs on the server
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// Chapters of the same novel already saved locally: url → nextUrl
export function getKnownChapters(url: string, excludeUrl?: string): Record<string, string | null> {
  const novelSlug = extractNovelSlug(url);
  return Object.fromEntries(
    getSavedChapters()
      .filter((c) => c.novelSlug === novelSlug && c.url !== excludeUrl)
      .map((c) => [c.url, c.nextUrl])
  );
}

// The chapter the latest background job started from. On the next app open the
// same window is requested once more, so chapters lost to a broken job chain
// (e.g. a failed handoff between serverless invocations) still get translated.
export function setPendingWindow(url: string) {
  try {
    localStorage.setItem(PENDING_WINDOW_KEY, JSON.stringify({ url, at: Date.now() }));
  } catch {
    // storage full; only the recovery is lost
  }
}

export function getPendingWindow(): string | null {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_WINDOW_KEY) || "null");
    return pending && Date.now() - pending.at < PENDING_WINDOW_MAX_AGE_MS ? pending.url : null;
  } catch {
    return null;
  }
}

export function clearPendingWindow() {
  localStorage.removeItem(PENDING_WINDOW_KEY);
}

// The names a novel's translations use (see app/lib/glossary.ts)
export function getGlossary(novelSlug: string): GlossaryTerm[] {
  try {
    const stored = JSON.parse(localStorage.getItem(GLOSSARY_KEY_PREFIX + novelSlug) || "[]");
    return sanitizeTerms(Array.isArray(stored) ? stored.slice(0, MAX_STORED_TERMS) : []) ?? [];
  } catch {
    return [];
  }
}

// Throws StorageFullError when browser storage is full
export function saveGlossary(novelSlug: string, terms: GlossaryTerm[]) {
  try {
    if (terms.length === 0) localStorage.removeItem(GLOSSARY_KEY_PREFIX + novelSlug);
    else localStorage.setItem(GLOSSARY_KEY_PREFIX + novelSlug, JSON.stringify(terms));
  } catch (e) {
    throw isQuotaError(e) ? new StorageFullError() : e;
  }
}
