import { ChapterJob, TranslatedChapter, TranslateOptions } from "./types";
import { ChapterMeta } from "./api";
import { deduplicateTitle, extractNovelSlug, getDeviceId, getSavedChapters, saveChapter } from "./storage";

// Client side of the background jobs in app/api/jobs: chapters keep translating
// on the server after the tab is closed, and are pulled into localStorage when
// the app is opened again.

const POLL_INTERVAL_MS = 1500;
// Give up on a chapter whose server state has not changed for this long
const STALL_TIMEOUT_MS = 120_000;

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
export async function startBackgroundJob(
  url: string,
  options: TranslateOptions,
  known: Record<string, string | null>,
  signal?: AbortSignal
): Promise<string | null> {
  if (jobsUnavailable) return null;

  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: getDeviceId(), url, known, ...options }),
    signal,
  });
  if (res.status === 501) {
    jobsUnavailable = true;
    return null;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to start background translation");
  }
  return (await res.json()).jobId;
}

async function getJobChapter(url: string, signal?: AbortSignal): Promise<ChapterJob | null> {
  const params = new URLSearchParams({ deviceId: getDeviceId(), url });
  const res = await fetch(`/api/jobs?${params}`, { signal });
  if (!res.ok) throw new Error("Failed to check translation progress");
  return (await res.json()).chapter;
}

// Whether the server is still working on (or has finished) this chapter
export async function hasJobChapter(url: string): Promise<boolean> {
  if (jobsUnavailable) return false;
  try {
    const chapter = await getJobChapter(url);
    return !!chapter && chapter.status !== "error";
  } catch {
    return false;
  }
}

// Polls a chapter's server-side progress until it is done. `jobId` is the job
// that was just started for it, if any: an error left by an older job is
// ignored because the new job retries it.
export async function watchJobChapter(
  url: string,
  jobId: string | null,
  signal: AbortSignal,
  onMeta: (meta: ChapterMeta) => void,
  onText: (text: string) => void
): Promise<TranslatedChapter> {
  watching.add(url);
  try {
    let metaSent = false;
    let lastUpdatedAt = 0;
    let lastChangeAt = Date.now();

    while (true) {
      const chapter = await getJobChapter(url, signal);
      const isOldError = chapter?.status === "error" && jobId !== null && chapter.jobId !== jobId;

      if (chapter && !isOldError) {
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

// Removes chapters from the server once they are saved locally
export async function acknowledgeJobChapters(urls: string[]) {
  if (jobsUnavailable || urls.length === 0) return;
  await fetch("/api/jobs", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: getDeviceId(), urls }),
  }).catch(() => {});
}

export function saveTranslatedChapter(url: string, chapter: TranslatedChapter): string {
  const novelSlug = extractNovelSlug(url);
  const others = getSavedChapters().filter((c) => c.url !== url);
  const title = deduplicateTitle(chapter.chapterName || chapter.title || url, novelSlug, others);
  saveChapter({
    url,
    title,
    novelName: chapter.novelName || "",
    novelSlug,
    simplifiedText: chapter.text,
    prevUrl: chapter.prevUrl,
    nextUrl: chapter.nextUrl,
    savedAt: Date.now(),
  });
  return title;
}

// Saves every chapter the server finished while the app was closed. Returns how many were saved.
export async function syncFinishedJobs(): Promise<number> {
  if (jobsUnavailable) return 0;
  try {
    const res = await fetch(`/api/jobs?${new URLSearchParams({ deviceId: getDeviceId() })}`);
    if (res.status === 501) {
      jobsUnavailable = true;
      return 0;
    }
    if (!res.ok) return 0;

    const chapters: ChapterJob[] = (await res.json()).chapters;
    const finished = chapters
      .filter((c) => c.status === "done" && !watching.has(c.url))
      .sort((a, b) => a.updatedAt - b.updatedAt);
    for (const c of finished) saveTranslatedChapter(c.url, c);
    await acknowledgeJobChapters(finished.map((c) => c.url));
    return finished.length;
  } catch {
    return 0;
  }
}
