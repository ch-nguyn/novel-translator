import { ChapterJob, TranslatedChapter, TranslateOptions } from "./types";
import { applyNames, mergeTerms, promptTerms } from "./glossary";
import { ChapterMeta, readErrorMessage } from "./api";
import {
  deduplicateTitle,
  extractNovelSlug,
  getClearedNovels,
  getCurrentUrl,
  getDeviceId,
  getGlossary,
  getSavedChapters,
  getSettings,
  reviveNovel,
  saveChapter,
  saveGlossary,
  setPendingWindow,
} from "./storage";

// Client side of the background jobs in app/api/jobs: chapters keep translating
// on the server after the tab is closed, and are pulled into localStorage when
// the app is opened again.

const POLL_INTERVAL_MS = 1500;
// Give up on a chapter whose server state has not changed for this long. The
// server refreshes an in-progress chapter at least every 15s (heartbeat).
const STALL_TIMEOUT_MS = 120_000;
// keepalive requests are limited to 64 KiB of body (bytes, not characters)
const KEEPALIVE_MAX_BYTES = 60_000;
// After (re)starting a job, how long its worker may take to pick the chapter up
const RESTART_GRACE_MS = 30_000;

// Set once the server reports jobs are not configured; callers then translate in the tab
let jobsUnavailable = false;
// Chapters currently shown with live progress; sync leaves them to the watcher
const watching = new Set<string>();

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

// Starts translating `url` plus the next few chapters on the server, replacing
// any earlier job of this device. Returns the job id, or null if background
// jobs are unavailable.
export interface StartJobOptions {
  signal?: AbortSignal;
  // Remember the window so the next app open re-requests it (see setPendingWindow)
  remember?: boolean;
  // The user opened `url` and the device does not have it: translate it even if
  // the server holds a receipt saying it was saved before
  force?: boolean;
}

// When this tab last started a job; lets delayed work see it has been superseded
let lastJobStartAt = 0;
export const getLastJobStartAt = () => lastJobStartAt;

// False once the server has reported that background jobs are not configured
export const backgroundJobsMaybeAvailable = () => !jobsUnavailable;

export async function startBackgroundJob(
  url: string,
  options: TranslateOptions,
  known: Record<string, string | null>,
  { signal, remember = true, force = false }: StartJobOptions = {}
): Promise<string | null> {
  if (jobsUnavailable) return null;
  lastJobStartAt = Date.now();
  reviveNovel(extractNovelSlug(url));
  // Before the request: the app may be closed before the response arrives
  if (remember) setPendingWindow(url);
  await pendingCancel;

  const glossary = options.useGlossary === false ? [] : promptTerms(getGlossary(extractNovelSlug(url)));
  const body = JSON.stringify({ deviceId: getDeviceId(), url, known, force, glossary, ...options });
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
    // Lets the job start even if the app is closed right after pressing Next
    keepalive: new TextEncoder().encode(body).length < KEEPALIVE_MAX_BYTES,
  });
  if (res.status === 501) {
    jobsUnavailable = true;
    return null;
  }
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Failed to start background translation"));
  }
  return (await res.json()).jobId;
}

interface JobChapterState {
  chapter: ChapterJob | null;
  // A worker still holds the (unfinished) chapter
  alive: boolean;
}

async function getJobChapter(url: string, signal?: AbortSignal): Promise<JobChapterState> {
  const params = new URLSearchParams({ deviceId: getDeviceId(), url });
  const res = await fetch(`/api/jobs?${params}`, { signal });
  if (!res.ok) throw new Error("Failed to check translation progress");
  const data = await res.json();
  return { chapter: data.chapter ?? null, alive: !!data.alive };
}

// What the server has for a chapter: "active" (being translated or done),
// "error", "abandoned" (unfinished and no worker left), "saved" (the device
// saved it already), "none", or "unavailable" when jobs are not configured
export async function getJobChapterStatus(
  url: string
): Promise<"active" | "error" | "abandoned" | "saved" | "none" | "unavailable"> {
  if (jobsUnavailable) return "unavailable";
  try {
    const params = new URLSearchParams({ deviceId: getDeviceId(), url });
    const res = await fetch(`/api/jobs?${params}`);
    if (res.status === 501) {
      jobsUnavailable = true;
      return "unavailable";
    }
    if (!res.ok) return "unavailable";
    const { chapter, alive } = await res.json();
    if (!chapter) return "none";
    if (chapter.status === "saved") return "saved";
    if (chapter.status === "done") return "active";
    if (chapter.status === "error") return "error";
    return alive ? "active" : "abandoned";
  } catch {
    return "unavailable";
  }
}

function fromSavedChapter(url: string): TranslatedChapter | null {
  const saved = getSavedChapters().find((c) => c.url === url);
  if (!saved) return null;
  return {
    text: saved.simplifiedText,
    title: saved.title,
    novelName: saved.novelName,
    chapterName: saved.title,
    prevUrl: saved.prevUrl,
    nextUrl: saved.nextUrl,
  };
}

// Polls a chapter's server-side progress until it is done. `jobId` is the job
// that was just started for it, if any: an error left by an older job is
// ignored because the new job retries it. If the worker died (its claim
// expired), `restart` is called once to start a new job for the chapter.
export async function watchJobChapter(
  url: string,
  jobId: string | null,
  signal: AbortSignal,
  onMeta: (meta: ChapterMeta) => void,
  onText: (text: string) => void,
  restart?: () => Promise<string | null>
): Promise<TranslatedChapter> {
  watching.add(url);
  try {
    let metaSent = false;
    let lastUpdatedAt = 0;
    let lastChangeAt = Date.now();
    // A job was just started for this chapter: give its worker time to pick it up
    let graceUntil = jobId ? Date.now() + RESTART_GRACE_MS : 0;
    let restarted = false;

    while (true) {
      const { chapter, alive } = await getJobChapter(url, signal);
      const isOldError = chapter?.status === "error" && jobId !== null && chapter.jobId !== jobId;

      // Another tab may have saved the chapter (leaving only a receipt or nothing on the server)
      if (!chapter || chapter.status === "saved") {
        const saved = fromSavedChapter(url);
        if (saved) return saved;
        if (chapter) throw new Error("This chapter was already saved and has since been removed from this device. Please translate it again.");
      }

      const inProgress = chapter?.status === "fetching" || chapter?.status === "translating";
      // Unfinished, and no worker holds it (it died, or ours has not started yet)
      if (inProgress && !alive) {
        if (Date.now() >= graceUntil) {
          if (!restart || restarted) throw new Error("Background translation stopped. Please try again.");
          restarted = true;
          jobId = await restart();
          if (!jobId) throw new Error("Background translation stopped. Please try again.");
          graceUntil = Date.now() + RESTART_GRACE_MS;
          lastChangeAt = Date.now();
        }
      } else if (chapter && !isOldError) {
        if (chapter.status === "error") throw new Error(chapter.error || "Translation failed");
        if (chapter.status !== "fetching" && !metaSent) {
          onMeta(chapter);
          metaSent = true;
        }
        if (chapter.text) onText(chapter.text);
        if (chapter.status === "done") return chapter;
      }

      const updatedAt = chapter?.updatedAt ?? 0;
      if (updatedAt !== lastUpdatedAt) {
        lastUpdatedAt = updatedAt;
        lastChangeAt = Date.now();
      } else if (Date.now() - lastChangeAt > STALL_TIMEOUT_MS) {
        throw new Error("Background translation stopped responding. Please try again.");
      }

      await sleep(POLL_INTERVAL_MS, signal);
    }
  } finally {
    watching.delete(url);
  }
}

// Removes chapters from the server once they are saved locally (or discarded).
// `cancelNovel` also stops the running job if it is translating that novel.
export async function acknowledgeJobChapters(urls: string[], cancelNovel?: string) {
  if (jobsUnavailable || (urls.length === 0 && !cancelNovel)) return;
  const request = fetch("/api/jobs", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: getDeviceId(), urls, cancelNovel }),
  }).then(() => {}, () => {});
  // Cancelling matches the novel, not a job: a job started before it arrives would be cancelled too
  if (cancelNovel) pendingCancel = request;
  await request;
}

// The latest request cancelling a novel's job; new jobs wait for it
let pendingCancel: Promise<void> = Promise.resolve();

// The user cleared a novel: stop translating ahead and drop what the server holds for it
export async function discardNovelJobs(novelSlug: string) {
  if (jobsUnavailable) return;
  try {
    const res = await fetch(`/api/jobs?${new URLSearchParams({ deviceId: getDeviceId() })}`);
    if (!res.ok) return;
    const chapters: ChapterJob[] = (await res.json()).chapters;
    const urls = chapters.filter((c) => extractNovelSlug(c.url) === novelSlug).map((c) => c.url);
    await acknowledgeJobChapters(urls, novelSlug);
  } catch {
    // ignore; sync discards them later anyway
  }
}

// Saves a translated chapter locally, adding the names it introduced to the
// novel's glossary and writing every name the way the glossary does. Returns
// the text and title it was saved with, and how many old chapters had to be
// removed to make room. Call while holding the storage lock.
export function saveTranslatedChapter(
  url: string,
  chapter: TranslatedChapter
): { text: string; title: string; evicted: number } {
  const novelSlug = extractNovelSlug(url);
  let text = chapter.text;
  // Chapters removed to make room
  let evictedForNames = 0;
  // Unless the user turned the glossary off
  if (getSettings().autoGlossary) {
    const known = getGlossary(novelSlug);
    const glossary = mergeTerms(known, chapter.newTerms ?? []);
    if (glossary !== known) {
      try {
        evictedForNames = saveGlossary(novelSlug, glossary);
      } catch {
        // Storage is full even without old chapters: the chapter itself matters more; its names are lost
      }
    }
    text = applyNames(chapter.text, glossary);
  }
  const others = getSavedChapters().filter((c) => c.url !== url);
  const title = deduplicateTitle(chapter.chapterName || chapter.title || url, novelSlug, others);
  const evicted = saveChapter({
    url,
    title,
    novelName: chapter.novelName || "",
    novelSlug,
    simplifiedText: text,
    prevUrl: chapter.prevUrl,
    nextUrl: chapter.nextUrl,
    savedAt: Date.now(),
  });
  return { text, title, evicted: evicted + evictedForNames };
}

export interface SyncResult {
  saved: number;
  // Old chapters removed to make room in browser storage
  evicted: number;
}

// Saves every chapter the server finished while the app was closed.
// Chapters of novels the user cleared, or of other novels when "keep only the
// current novel" is on, are discarded instead. Skipped if another tab is
// already syncing.
export async function syncFinishedJobs(): Promise<SyncResult> {
  const result: SyncResult = { saved: 0, evicted: 0 };
  if (jobsUnavailable) return result;
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("novel-translator-storage", { ifAvailable: true }, async (lock) =>
      lock ? syncLocked(result) : result
    );
  }
  return syncLocked(result);
}

async function syncLocked(result: SyncResult): Promise<SyncResult> {
  try {
    const res = await fetch(`/api/jobs?${new URLSearchParams({ deviceId: getDeviceId() })}`);
    if (res.status === 501) {
      jobsUnavailable = true;
      return result;
    }
    if (!res.ok) return result;

    const chapters: ChapterJob[] = (await res.json()).chapters;
    const finished = chapters
      .filter((c) => c.status === "done" && !watching.has(c.url))
      .sort((a, b) => a.updatedAt - b.updatedAt);

    const cleared = getClearedNovels();
    const currentUrl = getCurrentUrl();
    const onlyNovel = getSettings().autoClearNovels && currentUrl ? extractNovelSlug(currentUrl) : null;
    const handled: string[] = [];
    try {
      for (const c of finished) {
        const slug = extractNovelSlug(c.url);
        if (!cleared.has(slug) && (!onlyNovel || slug === onlyNovel)) {
          result.evicted += saveTranslatedChapter(c.url, c).evicted;
          result.saved++;
        }
        handled.push(c.url);
      }
    } finally {
      // Chapters that could not be saved stay on the server for the next sync
      await acknowledgeJobChapters(handled);
    }
    return result;
  } catch {
    return result;
  }
}
