import { GlossaryTerm } from "./types";
import { makeNameFixer, unionTerms } from "./glossary";
import {
  applyRemoteNovel,
  detachLibrary,
  getLibraryAccount,
  setLibraryAccount,
  getGlossary,
  getGlossarySync,
  getLibrary,
  getSavedChapters,
  getUnsyncedGlossaries,
  LibraryEntry,
  markGlossarySynced,
  markNovelSynced,
  rewriteNovelChapters,
  saveGlossary,
  withStorageLock,
} from "./storage";

// A signed-in user's bookshelf follows them to every device (app/api/library):
// the novels on it, where the reader is in each, and each novel's names.
// Per novel, the latest change wins; names changed on two devices at once
// are combined. Chapters stay on the device that translated them.
// Nothing is sent before the first sync with the signed-in account (`userId`)
// has settled whose shelf this device has.

// The account a device's request is for (checked by app/api/library)
export const LIBRARY_USER_HEADER = "x-library-user";

function headers(userId: string, json = false): HeadersInit {
  return json ? { [LIBRARY_USER_HEADER]: userId, "Content-Type": "application/json" } : { [LIBRARY_USER_HEADER]: userId };
}

interface RemoteNovel extends Omit<LibraryEntry, "dirty" | "removed"> {
  slug: string;
  removed: boolean;
}

export interface LibrarySyncResult {
  // Novels another device changed (moved on in, renamed), and deleted
  changed: string[];
  removed: string[];
  // Novels whose names another device changed
  glossaries: string[];
}

// Sends the novels changed here. `keepalive`: the page is closing.
export async function pushLibrary(userId: string, keepalive = false, signal?: AbortSignal): Promise<void> {
  if (getLibraryAccount() !== userId) return;
  const dirty = Object.entries(getLibrary()).filter(([, entry]) => entry.dirty);
  if (dirty.length === 0) return;
  const novels = dirty.map(([slug, { name, url, chapterTitle, paragraph, removed, updatedAt }]) => ({
    slug,
    name,
    url,
    chapterTitle,
    paragraph,
    removed: !!removed,
    updatedAt,
  }));
  const res = await fetch("/api/library", {
    method: "PUT",
    headers: headers(userId, true),
    body: JSON.stringify({ novels }),
    keepalive,
    signal,
  });
  if (!res.ok || getLibraryAccount() !== userId) return;
  for (const novel of novels) markNovelSynced(novel.slug, novel.updatedAt);
}

// Sends a novel's names, as a change to the account's version this device
// last had. Returns whether the account's changed since (they must be
// fetched and combined first).
async function pushGlossary(userId: string, slug: string, signal?: AbortSignal): Promise<boolean> {
  if (getLibraryAccount() !== userId) return false;
  const { updatedAt, syncedAt } = getGlossarySync(slug);
  const res = await fetch("/api/library/glossary", {
    method: "PUT",
    headers: headers(userId, true),
    body: JSON.stringify({ slug, terms: getGlossary(slug), updatedAt, baseUpdatedAt: syncedAt }),
    signal,
  });
  if (!res.ok || getLibraryAccount() !== userId) return false;
  const { saved, conflict }: { saved: boolean; conflict: boolean } = await res.json();
  if (saved) markGlossarySynced(slug, updatedAt);
  return conflict;
}

// Sends the names changed here (except those of deleted novels; a novel not
// on the account's shelf yet gets them on a later push)
export async function pushGlossaries(userId: string, signal?: AbortSignal): Promise<void> {
  if (getLibraryAccount() !== userId) return;
  const library = getLibrary();
  for (const slug of getUnsyncedGlossaries()) {
    if (signal?.aborted || getLibraryAccount() !== userId) return;
    if (library[slug]?.removed) continue;
    try {
      // Changed on another device meanwhile: combined, then sent again
      if (await pushGlossary(userId, slug, signal)) await syncGlossary(userId, slug, undefined, signal);
    } catch {
      // Sent again on the next push
    }
  }
}

// Brings a novel's names here and in the account together. `remoteUpdatedAt`
// (when the account's last changed) is looked up if not given. Returns
// whether the names here changed.
export async function syncGlossary(userId: string, slug: string, remoteUpdatedAt?: number, signal?: AbortSignal): Promise<boolean> {
  if (getLibraryAccount() !== userId) return false;
  let remote: { terms: GlossaryTerm[] | null; updatedAt: number } | null = null;
  const fetchRemote = async () => {
    const res = await fetch(`/api/library/glossary?slug=${encodeURIComponent(slug)}`, { cache: "no-store", headers: headers(userId), signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { terms: GlossaryTerm[] | null; updatedAt: number };
  };
  if (remoteUpdatedAt === undefined) {
    remote = await fetchRemote();
    remoteUpdatedAt = remote.updatedAt;
  }
  let changed = false;
  if (remoteUpdatedAt > getGlossarySync(slug).syncedAt) {
    remote ??= await fetchRemote();
    const { terms, updatedAt } = remote;
    if (!terms || signal?.aborted) return false;
    changed = await withStorageLock(() => {
      const library = getLibrary();
      // Another account signed in meanwhile, or the novel was deleted
      if (getLibraryAccount() !== userId || library[slug]?.removed) return false;
      const sync = getGlossarySync(slug);
      // Changed here too since the last sync: both sides' names are kept
      const merged = sync.updatedAt > sync.syncedAt;
      const local = getGlossary(slug);
      const next = merged ? (sync.updatedAt > updatedAt ? unionTerms(local, terms) : unionTerms(terms, local)) : terms;
      if (merged) {
        saveGlossary(slug, next, { updatedAt: Math.max(Date.now(), sync.updatedAt + 1, updatedAt + 1), syncedAt: updatedAt });
      } else {
        saveGlossary(slug, next, { updatedAt, syncedAt: updatedAt });
      }
      // Saved chapters write the names the new way
      rewriteNovelChapters(slug, makeNameFixer(next));
      return JSON.stringify(next) !== JSON.stringify(local);
    });
  }
  const sync = getGlossarySync(slug);
  if (sync.updatedAt > sync.syncedAt && !signal?.aborted) await pushGlossary(userId, slug, signal);
  return changed;
}

// Brings this device's shelf and the account's together: changes made on
// other devices come here, this device's go to the account. Names are synced
// for the novels with chapters on this device and `currentSlug` (the open
// one); others' come when they are opened. Null if the account was not reached.
export async function syncLibrary(userId: string, currentSlug: string | null, signal?: AbortSignal): Promise<LibrarySyncResult | null> {
  const res = await fetch("/api/library", { cache: "no-store", headers: headers(userId), signal });
  if (!res.ok) return null;
  const remote: { novels: RemoteNovel[]; glossaries: { slug: string; updatedAt: number }[] } = await res.json();
  if (signal?.aborted) return null;
  const result: LibrarySyncResult = { changed: [], removed: [], glossaries: [] };

  await withStorageLock(() => {
    // The shelf here was another account's (a guest's is this account's now)
    const previous = getLibraryAccount();
    if (previous !== null && previous !== userId) detachLibrary();
    setLibraryAccount(userId);
    const library = getLibrary();
    const withChapters = new Set(getSavedChapters().map((c) => c.novelSlug));
    for (const { slug, ...novel } of remote.novels) {
      const entry = library[slug];
      if (entry && entry.updatedAt >= novel.updatedAt) continue;
      // Deleted before this device ever had it
      if (novel.removed && !entry && !withChapters.has(slug)) continue;
      // Deleted by this account, but read here by another (see detachLibrary): kept
      if (novel.removed && entry?.updatedAt === 0) continue;
      applyRemoteNovel(slug, novel);
      // Already deleted here: nothing to tell
      if (novel.removed && entry?.removed) continue;
      (novel.removed ? result.removed : result.changed).push(slug);
    }
  });
  await pushLibrary(userId, false, signal).catch(() => {});

  const remoteGlossaries = new Map(remote.glossaries.map((g) => [g.slug, g.updatedAt]));
  const slugs = new Set(getSavedChapters().map((c) => c.novelSlug));
  if (currentSlug) slugs.add(currentSlug);
  const library = getLibrary();
  for (const slug of slugs) {
    if (signal?.aborted) break;
    if (library[slug]?.removed) continue;
    try {
      if (await syncGlossary(userId, slug, remoteGlossaries.get(slug) ?? 0, signal)) result.glossaries.push(slug);
    } catch {
      // Tried again on the next sync
    }
  }
  await pushGlossaries(userId, signal);
  return result;
}
