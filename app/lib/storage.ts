import { AI_VOICES, DEFAULT_AI_MODEL, DEFAULT_AI_VOICE, GlossaryTerm, SavedChapter, ReaderSettings, SPEECH_RATES } from "./types";
import { findSite } from "./sites";
import { MAX_STORED_TERMS, sanitizeTerms } from "./glossary";

const STORAGE_KEY = "novel-translator-chapters";
const CURRENT_KEY = "novel-translator-current";
const SETTINGS_KEY = "novel-translator-settings";
// When the settings were last changed, and the sign-in they were last synced in
const SETTINGS_UPDATED_KEY = "novel-translator-settings-updated";
const SETTINGS_SESSION_KEY = "novel-translator-settings-session";
const SCROLL_KEY = "novel-translator-scroll";
const DEVICE_KEY = "novel-translator-device-id";
const CLEARED_NOVELS_KEY = "novel-translator-cleared-novels";
const PENDING_WINDOW_KEY = "novel-translator-pending-window";
// The chapter last opened in each novel, by novel slug; replaced by LIBRARY_KEY
const LAST_READ_KEY = "novel-translator-last-read";
// The bookshelf (see LibraryEntry), by novel slug
const LIBRARY_KEY = "novel-translator-library";
// Novels on the shelf, deleted ones included; the least recently read go first
const MAX_LIBRARY = 300;
// When each novel's glossary last changed and was last in step with the
// account (see GlossarySync), by novel slug
const GLOSSARY_SYNC_KEY = "novel-translator-glossary-sync";
// The account the shelf and names were last synced with
const LIBRARY_ACCOUNT_KEY = "novel-translator-library-account";
// What the novels' sites listed when last checked, by novel slug (see NovelUpdate)
const NOVEL_UPDATES_KEY = "novel-translator-novel-updates";
// One key per novel: `${GLOSSARY_KEY_PREFIX}${novelSlug}`
const GLOSSARY_KEY_PREFIX = "novel-translator-glossary:";
const PENDING_WINDOW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SCROLL_POSITIONS = 300;
export const MAX_CHAPTERS_PER_NOVEL = 50;
const REMOVED_MODEL_NAMES = new Set([
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
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
  autoGlossary: false,
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

// Least recently saved chapter to drop when storage is full: novels other
// than `keepSlug` first, then older chapters of it. Never `keepUrl`.
function pickEvictionVictim(chapters: SavedChapter[], keepSlug: string, keepUrl?: string): SavedChapter | null {
  const candidates = chapters.filter((c) => c.url !== keepUrl);
  if (candidates.length === 0) return null;
  return candidates.reduce((victim, c) => {
    const victimOther = victim.novelSlug !== keepSlug;
    const cOther = c.novelSlug !== keepSlug;
    if (cOther !== victimOther) return cOther ? c : victim;
    return c.savedAt < victim.savedAt ? c : victim;
  });
}

// Makes room when storage is full by removing the glossaries of novels with no
// saved chapter in `chapters` (except `keepSlug`'s). Returns whether any was.
function removeOrphanGlossaries(chapters: SavedChapter[], keepSlug: string): boolean {
  const slugs = new Set(chapters.map((c) => c.novelSlug)).add(keepSlug);
  const orphans: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(GLOSSARY_KEY_PREFIX) && !slugs.has(key.slice(GLOSSARY_KEY_PREFIX.length))) orphans.push(key);
  }
  for (const key of orphans) {
    localStorage.removeItem(key);
    forgetGlossarySync(key.slice(GLOSSARY_KEY_PREFIX.length));
  }
  return orphans.length > 0;
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
  let orphansRemoved = false;
  while (true) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chapters));
      shelveNovel(chapter);
      return evicted;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      if (!orphansRemoved) {
        orphansRemoved = true;
        if (removeOrphanGlossaries(chapters, chapter.novelSlug)) continue;
      }
      const victim = pickEvictionVictim(chapters, chapter.novelSlug, chapter.url);
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

// Deletes a novel: its chapters, names and place on the shelf (on every
// device of a signed-in user)
export function clearNovelChapters(novelSlug: string) {
  removeNovelData(novelSlug);
  updateLibrary((library) => {
    const entry = library[novelSlug];
    if (entry) library[novelSlug] = { ...entry, removed: true, updatedAt: nextUpdatedAt(entry), dirty: true };
  });
}

// What a deleted novel leaves on this device
function removeNovelData(novelSlug: string) {
  const chapters = getSavedChapters().filter((c) => c.novelSlug !== novelSlug);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chapters));
  const cleared = getClearedNovels();
  cleared.add(novelSlug);
  localStorage.setItem(CLEARED_NOVELS_KEY, JSON.stringify([...cleared]));
  localStorage.removeItem(GLOSSARY_KEY_PREFIX + novelSlug);
  forgetGlossarySync(novelSlug);
  const { [novelSlug]: _update, ...updates } = getNovelUpdates();
  localStorage.setItem(NOVEL_UPDATES_KEY, JSON.stringify(updates));
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

// A novel on the reader's shelf. Kept apart from the saved chapters (which
// come and go) and, for a signed-in user, synced with the account
// (app/lib/librarySync.ts): the latest change to a novel wins.
export interface LibraryEntry {
  name: string;
  // The chapter last opened in it, and the paragraph at the top of the screen
  // there (unlike a scroll offset, the same on every device)
  url: string;
  chapterTitle: string;
  paragraph: number;
  // When it last changed, here or on another device
  updatedAt: number;
  // Deleted; kept so the deletion reaches the other devices
  removed?: boolean;
  // Changed here and not sent to the account yet
  dirty?: boolean;
}

export type Library = Record<string, LibraryEntry>;

// Called when the shelf or a glossary changes here (not when another device's
// change is applied), so it can be sent to the account
const localChangeListeners = new Set<() => void>();

export function onLocalLibraryChange(listener: () => void): () => void {
  localChangeListeners.add(listener);
  return () => localChangeListeners.delete(listener);
}

function notifyLocalChange() {
  for (const listener of localChangeListeners) listener();
}

export function getLibrary(): Library {
  try {
    const stored = localStorage.getItem(LIBRARY_KEY);
    if (stored === null) return migrateLibrary();
    const library = JSON.parse(stored);
    return library && typeof library === "object" && !Array.isArray(library) ? library : {};
  } catch {
    return {};
  }
}

// The shelf from before it existed: the novels with saved chapters, each at
// the chapter last opened in it (else the latest saved)
function migrateLibrary(): Library {
  let lastRead: Record<string, unknown> = {};
  try {
    lastRead = JSON.parse(localStorage.getItem(LAST_READ_KEY) || "{}") ?? {};
  } catch {
    // none
  }
  const library: Library = {};
  const chapters = [...getSavedChapters()].sort((a, b) => b.savedAt - a.savedAt);
  for (const c of chapters) {
    if (library[c.novelSlug]) continue;
    const novelChapters = chapters.filter((other) => other.novelSlug === c.novelSlug);
    const opened = novelChapters.find((other) => other.url === lastRead[c.novelSlug]) ?? c;
    library[c.novelSlug] = {
      name: novelChapters.find((other) => other.novelName)?.novelName ?? "",
      url: opened.url,
      chapterTitle: opened.title,
      paragraph: 0,
      updatedAt: c.savedAt,
      dirty: true,
    };
  }
  saveLibrary(library);
  localStorage.removeItem(LAST_READ_KEY);
  return library;
}

function saveLibrary(library: Library) {
  let entries = Object.entries(library);
  if (entries.length > MAX_LIBRARY) {
    // Changes not sent yet stay (a deletion would come back otherwise); then
    // deleted novels go first, then the least recently read
    const rank = (entry: LibraryEntry) => (entry.dirty ? 0 : entry.removed ? 2 : 1);
    entries = entries
      .sort(([, a], [, b]) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
      .slice(0, MAX_LIBRARY);
  }
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // storage full; the shelf is rebuilt from the account or the chapters
  }
}

// Later than the entry's last change, even if another device's clock is ahead
function nextUpdatedAt(entry: LibraryEntry | undefined): number {
  return Math.max(Date.now(), (entry?.updatedAt ?? 0) + 1);
}

// Changes the shelf in place; a change made here (an entry marked dirty) is
// reported to onLocalLibraryChange listeners
function updateLibrary(change: (library: Library) => void) {
  const library = getLibrary();
  const before = JSON.stringify(library);
  change(library);
  if (JSON.stringify(library) === before) return;
  saveLibrary(library);
  notifyLocalChange();
}

// Sets a novel's entry fields; nothing changes if they are already so
function setLibraryEntry(novelSlug: string, fields: Omit<LibraryEntry, "updatedAt" | "removed" | "dirty">) {
  updateLibrary((library) => {
    const entry = library[novelSlug];
    if (
      entry &&
      !entry.removed &&
      // Another account's (see detachLibrary): reading it now sends it to this one
      entry.updatedAt > 0 &&
      entry.name === fields.name &&
      entry.url === fields.url &&
      entry.chapterTitle === fields.chapterTitle &&
      entry.paragraph === fields.paragraph
    ) {
      return;
    }
    library[novelSlug] = { ...fields, updatedAt: nextUpdatedAt(entry), dirty: true };
  });
}

// A chapter was saved: its novel is on the shelf, with its name
function shelveNovel(chapter: SavedChapter) {
  const entry = getLibrary()[chapter.novelSlug];
  if (entry?.removed) return;
  if (!entry) {
    setLibraryEntry(chapter.novelSlug, { name: chapter.novelName, url: chapter.url, chapterTitle: chapter.title, paragraph: 0 });
  } else if (!entry.name && chapter.novelName) {
    setLibraryEntry(chapter.novelSlug, { ...entry, name: chapter.novelName });
  }
}

// The chapter the reader last opened in a novel. Not the most recently saved
// one: chapters translated ahead are saved after the one being read.
export function getLastReadUrl(novelSlug: string): string | null {
  const entry = getLibrary()[novelSlug];
  return entry && !entry.removed ? entry.url : null;
}

// The chapter the reader is on (and so their place in its novel). `info`
// fills in what the shelf shows when it is known.
export function setCurrentUrl(url: string, info: { novelName?: string; chapterTitle?: string } = {}) {
  try {
    localStorage.setItem(CURRENT_KEY, url);
  } catch {
    // storage full; losing the resume position is harmless
  }
  const slug = extractNovelSlug(url);
  const entry = getLibrary()[slug];
  const same = entry && !entry.removed && entry.url === url;
  setLibraryEntry(slug, {
    name: info.novelName || entry?.name || getSavedChapters().find((c) => c.novelSlug === slug && c.novelName)?.novelName || "",
    url,
    chapterTitle: info.chapterTitle ?? (same ? entry.chapterTitle : getSavedChapters().find((c) => c.url === url)?.title ?? ""),
    paragraph: same ? entry.paragraph : 0,
  });
  markNovelSeen(slug);
}

// The reader scrolled to `paragraph` of the chapter `url`
export function setReadingParagraph(url: string, paragraph: number) {
  const slug = extractNovelSlug(url);
  const entry = getLibrary()[slug];
  if (!entry || entry.removed || entry.url !== url || entry.paragraph === paragraph) return;
  setLibraryEntry(slug, { ...entry, paragraph });
}

// Another device's change to a novel, newer than this device's entry.
// A deleted novel is deleted here too.
export function applyRemoteNovel(novelSlug: string, remote: Omit<LibraryEntry, "dirty">) {
  const entry = getLibrary()[novelSlug];
  if (remote.removed) {
    removeNovelData(novelSlug);
  } else {
    reviveNovel(novelSlug);
    // The scroll offset kept here is older than the paragraph the reader got to there
    if (!entry || entry.url !== remote.url || entry.paragraph !== remote.paragraph) forgetScrollPosition(remote.url);
  }
  const library = getLibrary();
  library[novelSlug] = { ...remote };
  saveLibrary(library);
}

// Sent to the account: the entry is no longer dirty unless it changed meanwhile
export function markNovelSynced(novelSlug: string, updatedAt: number) {
  const library = getLibrary();
  const entry = library[novelSlug];
  if (!entry?.dirty || entry.updatedAt !== updatedAt) return;
  delete entry.dirty;
  saveLibrary(library);
}

export function getLibraryAccount(): string | null {
  return localStorage.getItem(LIBRARY_ACCOUNT_KEY);
}

export function setLibraryAccount(userId: string) {
  localStorage.setItem(LIBRARY_ACCOUNT_KEY, userId);
}

// Another account signs in on this device: the shelf and names here were
// another account's, so they are not sent to this one; the account's own
// replace them (a novel read here again is sent as usual)
export function detachLibrary() {
  const library = getLibrary();
  for (const [slug, entry] of Object.entries(library)) {
    if (entry.removed) delete library[slug];
    else library[slug] = { ...entry, updatedAt: 0, dirty: undefined };
  }
  saveLibrary(library);
  const syncs: Record<string, GlossarySync> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(GLOSSARY_KEY_PREFIX)) syncs[key.slice(GLOSSARY_KEY_PREFIX.length)] = { updatedAt: 0, syncedAt: 0 };
  }
  try {
    localStorage.setItem(GLOSSARY_SYNC_KEY, JSON.stringify(syncs));
  } catch {
    // ignore
  }
}

export function isLibraryStorageKey(key: string | null): boolean {
  return key === null || key === LIBRARY_KEY;
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

// API keys: encrypted when kept for a signed-in user (app/lib/server/userSettings.ts)
export const SECRET_SETTINGS = ["openaiApiKey", "geminiApiKey", "claudeApiKey", "openrouterApiKey"] as const;
// Settings that only make sense on this device (its own voices), never synced
export const DEVICE_SETTINGS: readonly string[] = ["speechVoice"];

// `updatedAt` is when they were changed; another device's sync passes its own
export function saveSettings(settings: ReaderSettings, updatedAt = Date.now()) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  localStorage.setItem(SETTINGS_UPDATED_KEY, String(updatedAt));
}

// 0 if never saved; settings saved before this was recorded count as the oldest
export function getSettingsUpdatedAt(): number {
  const updatedAt = Number(localStorage.getItem(SETTINGS_UPDATED_KEY));
  if (updatedAt > 0) return updatedAt;
  return localStorage.getItem(SETTINGS_KEY) ? 1 : 0;
}

export function getSettingsSession(): string | null {
  return localStorage.getItem(SETTINGS_SESSION_KEY);
}

export function setSettingsSession(sessionId: string) {
  localStorage.setItem(SETTINGS_SESSION_KEY, sessionId);
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

function forgetScrollPosition(url: string) {
  try {
    const positions: Record<string, number> = JSON.parse(localStorage.getItem(SCROLL_KEY) || "{}");
    if (!(url in positions)) return;
    delete positions[url];
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

// When a novel's glossary last changed here or on another device, and the
// change last in step with the account (both 0 if never): it has changes to
// send while `updatedAt` > `syncedAt`
export interface GlossarySync {
  updatedAt: number;
  syncedAt: number;
}

function getGlossarySyncMap(): Record<string, GlossarySync> {
  try {
    const map = JSON.parse(localStorage.getItem(GLOSSARY_SYNC_KEY) || "{}");
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
}

export function getGlossarySync(novelSlug: string): GlossarySync {
  const sync = getGlossarySyncMap()[novelSlug];
  if (sync) return sync;
  // Names collected before syncing existed: changes never sent
  return localStorage.getItem(GLOSSARY_KEY_PREFIX + novelSlug) ? { updatedAt: 1, syncedAt: 0 } : { updatedAt: 0, syncedAt: 0 };
}

// The novels whose glossary has changes not sent to the account yet
export function getUnsyncedGlossaries(): string[] {
  return Object.entries(getGlossarySyncMap())
    .filter(([, sync]) => sync.updatedAt > sync.syncedAt)
    .map(([slug]) => slug);
}

function setGlossarySync(novelSlug: string, sync: GlossarySync) {
  try {
    localStorage.setItem(GLOSSARY_SYNC_KEY, JSON.stringify({ ...getGlossarySyncMap(), [novelSlug]: sync }));
  } catch {
    // storage full; the glossary is sent again next time
  }
}

// The account has the glossary as it was at `updatedAt`: later changes here
// (still to be sent) build on that version
export function markGlossarySynced(novelSlug: string, updatedAt: number) {
  const sync = getGlossarySync(novelSlug);
  if (updatedAt <= sync.syncedAt) return;
  setGlossarySync(novelSlug, { updatedAt: Math.max(sync.updatedAt, updatedAt), syncedAt: updatedAt });
}

function forgetGlossarySync(novelSlug: string) {
  const { [novelSlug]: _sync, ...others } = getGlossarySyncMap();
  try {
    localStorage.setItem(GLOSSARY_SYNC_KEY, JSON.stringify(others));
  } catch {
    // ignore
  }
}

// Saves a novel's glossary. When browser storage is full, room is made like
// for a chapter: the glossaries of novels with no saved chapter go first, then
// the oldest saved chapters (other novels' first). Returns how many chapters
// were removed; throws StorageFullError if it still does not fit.
// `sync` is given for a glossary from the account; otherwise it is a change
// made here, to be sent to the account.
export function saveGlossary(novelSlug: string, terms: GlossaryTerm[], sync?: GlossarySync): number {
  const key = GLOSSARY_KEY_PREFIX + novelSlug;
  const stamp = () => {
    if (sync) return setGlossarySync(novelSlug, sync);
    const previous = getGlossarySync(novelSlug);
    setGlossarySync(novelSlug, { updatedAt: Math.max(Date.now(), previous.updatedAt + 1), syncedAt: previous.syncedAt });
    notifyLocalChange();
  };
  if (terms.length === 0) {
    const had = localStorage.getItem(key) !== null;
    localStorage.removeItem(key);
    if (had || sync) stamp();
    return 0;
  }
  const value = JSON.stringify(terms);
  let chapters = getSavedChapters();
  let evicted = 0;
  let orphansRemoved = false;
  while (true) {
    try {
      localStorage.setItem(key, value);
      stamp();
      return evicted;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      if (!orphansRemoved) {
        orphansRemoved = true;
        if (removeOrphanGlossaries(chapters, novelSlug)) continue;
      }
      const victim = pickEvictionVictim(chapters, novelSlug);
      if (!victim) throw new StorageFullError();
      chapters = chapters.filter((c) => c !== victim);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chapters));
      evicted++;
    }
  }
}

// A novel's chapter count on its site when last checked, and when the reader
// last opened it: the difference is how many chapters came out since
export interface NovelUpdate {
  total: number;
  // The site's newest chapter
  latestTitle: string;
  checkedAt: number;
  // `total` when the reader last opened the novel
  seen: number;
}

export function getNovelUpdates(): Record<string, NovelUpdate> {
  try {
    const map = JSON.parse(localStorage.getItem(NOVEL_UPDATES_KEY) || "{}");
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
}

function saveNovelUpdates(updates: Record<string, NovelUpdate>) {
  try {
    localStorage.setItem(NOVEL_UPDATES_KEY, JSON.stringify(updates));
  } catch {
    // storage full; only the new-chapter counts are lost
  }
}

// Records what a novel's site lists now. The first check sets the baseline:
// chapters already out then are not "new".
export function recordNovelToc(novelSlug: string, total: number, latestTitle: string) {
  // Deleted while its site was being asked
  if (getClearedNovels().has(novelSlug)) return;
  const updates = getNovelUpdates();
  const previous = updates[novelSlug];
  updates[novelSlug] = { total, latestTitle, checkedAt: Date.now(), seen: previous ? Math.min(previous.seen, total) : total };
  saveNovelUpdates(updates);
}

// The reader opened the novel: its new chapters are no longer new
export function markNovelSeen(novelSlug: string) {
  const updates = getNovelUpdates();
  const update = updates[novelSlug];
  if (!update || update.seen === update.total) return;
  updates[novelSlug] = { ...update, seen: update.total };
  saveNovelUpdates(updates);
}

// Sets a saved chapter's links to the chapters around it, changing nothing
// else (no chapter is removed, unlike saveChapter). False if it is not saved.
export function updateChapterLinks(url: string, prevUrl: string | null, nextUrl: string | null): boolean {
  const chapters = getSavedChapters();
  const chapter = chapters.find((c) => c.url === url);
  if (!chapter) return false;
  chapter.prevUrl = prevUrl;
  chapter.nextUrl = nextUrl;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chapters));
  } catch {
    // storage full: the links are found again next time
    return false;
  }
  return true;
}
