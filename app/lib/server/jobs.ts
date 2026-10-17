import { Redis } from "@upstash/redis";
import { ChapterJob, TranslateOptions, ZH_TITLE_PROMPT } from "../types";
import { fetchContent } from "./fetchContent";
import { createSimplifyStream, USAGE_MARKER_REGEX } from "./simplify";
import { translateTitleBatch } from "./translateTitle";

// Background translation jobs.
//
// A job translates a window of consecutive chapters starting at `url`. Each
// serverless invocation translates at most one chapter, then hands the rest of
// the window to a fresh invocation (via `continueJob`) so no single invocation
// hits the platform time limit. Results are kept in Redis per device until the
// client pulls them into localStorage.
//
// The API key only travels in request bodies between invocations; it is never
// written to Redis.

const CHAPTER_TTL_SECONDS = 7 * 24 * 60 * 60;
const JOB_TTL_SECONDS = 24 * 60 * 60;
// How often partial text is written while the model is streaming
const FLUSH_INTERVAL_MS = 1500;
// An in-progress chapter with no update for this long is considered dead and gets retried
export const STALE_AFTER_MS = 90_000;

export interface JobStep extends TranslateOptions {
  deviceId: string;
  jobId: string;
  url: string;
  // Chapters left in the window, including `url`
  remaining: number;
  // Chapters the device already has: url → nextUrl. These are skipped, not re-translated.
  known: Record<string, string | null>;
}

let redis: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (redis === undefined) {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    redis = url && token ? new Redis({ url, token }) : null;
  }
  return redis;
}

export function isValidDeviceId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

const chaptersKey = (deviceId: string) => `nt:${deviceId}:chapters`;
const jobKey = (deviceId: string) => `nt:${deviceId}:job`;

export function isStale(chapter: ChapterJob): boolean {
  return chapter.status !== "done" && chapter.status !== "error" && Date.now() - chapter.updatedAt > STALE_AFTER_MS;
}

// Registers a new job for the device. Any older job of the same device stops
// after finishing the chapter it is currently on.
export async function createJob(db: Redis, deviceId: string): Promise<string> {
  const jobId = crypto.randomUUID();
  await db.set(jobKey(deviceId), jobId, { ex: JOB_TTL_SECONDS });
  return jobId;
}

export async function isCurrentJob(db: Redis, deviceId: string, jobId: string): Promise<boolean> {
  return (await db.get<string>(jobKey(deviceId))) === jobId;
}

export async function getChapter(db: Redis, deviceId: string, url: string): Promise<ChapterJob | null> {
  return db.hget<ChapterJob>(chaptersKey(deviceId), url);
}

export async function getAllChapters(db: Redis, deviceId: string): Promise<ChapterJob[]> {
  const all = await db.hgetall<Record<string, ChapterJob>>(chaptersKey(deviceId));
  return all ? Object.values(all) : [];
}

export async function deleteChapters(db: Redis, deviceId: string, urls: string[]) {
  if (urls.length > 0) await db.hdel(chaptersKey(deviceId), ...urls);
}

async function fetchNextUrl(url: string): Promise<string | null> {
  try {
    return (await fetchContent(url)).nextUrl;
  } catch {
    return null;
  }
}

// Walks the window from `step.url`, skipping chapters that are already
// available, and translates the first one that is not. Returns the step that
// should run next, or null when the window is finished or the job was replaced.
export async function runJobStep(db: Redis, step: JobStep): Promise<JobStep | null> {
  let url: string | null = step.url;
  let remaining = step.remaining;

  while (url && remaining > 0) {
    if (!(await isCurrentJob(db, step.deviceId, step.jobId))) return null;
    remaining--;

    if (url in step.known) {
      url = step.known[url] ?? (await fetchNextUrl(url));
      continue;
    }

    const existing = await getChapter(db, step.deviceId, url);
    if (existing && (existing.status === "done" || (existing.status !== "error" && !isStale(existing)))) {
      // Done, or being translated by an earlier job that will finish it
      url = existing.nextUrl ?? (await fetchNextUrl(url));
      continue;
    }

    const nextUrl = await translateChapter(db, step, url);
    return nextUrl && remaining > 0 ? { ...step, url: nextUrl, remaining } : null;
  }

  return null;
}

// Translates one chapter, writing progress to Redis. Returns the next chapter
// URL, or null on failure (the window stops so a bad key or quota error is not
// repeated for every chapter).
async function translateChapter(db: Redis, step: JobStep, url: string): Promise<string | null> {
  const key = chaptersKey(step.deviceId);
  let chapter: ChapterJob = {
    url,
    jobId: step.jobId,
    status: "fetching",
    lang: "vi",
    text: "",
    title: "",
    novelName: "",
    chapterName: "",
    prevUrl: null,
    nextUrl: null,
    updatedAt: Date.now(),
  };
  const save = async (patch: Partial<ChapterJob>) => {
    chapter = { ...chapter, ...patch, updatedAt: Date.now() };
    await db.hset(key, { [url]: chapter });
  };

  try {
    await save({});
    await db.expire(key, CHAPTER_TTL_SECONDS);

    const content = await fetchContent(url);
    await save({
      status: "translating",
      lang: content.lang,
      title: content.title,
      novelName: content.novelName,
      chapterName: content.chapterName,
      prevUrl: content.prevUrl,
      nextUrl: content.nextUrl,
    });

    const stream = await createSimplifyStream({
      text: content.text,
      apiKey: step.apiKey,
      model: step.model,
      lang: content.lang,
      customPrompt: step.customPrompt,
      referenceLinks: step.referenceLinks,
      reasoningEffort: step.reasoningEffort,
      webSearch: step.webSearch,
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let lastFlush = Date.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (Date.now() - lastFlush > FLUSH_INTERVAL_MS) {
        lastFlush = Date.now();
        await save({ text });
      }
    }
    text = text.replace(USAGE_MARKER_REGEX, "");

    let { novelName, chapterName } = content;
    if (content.lang === "zh" && chapterName) {
      try {
        const [c, n] = await translateTitleBatch(step.apiKey, step.model, [chapterName, novelName], ZH_TITLE_PROMPT);
        chapterName = c || chapterName;
        novelName = n || novelName;
      } catch { /* keep original */ }
    }

    await save({
      status: "done",
      text,
      novelName,
      chapterName,
      title: content.lang === "zh" ? chapterName : content.title,
    });
    await db.expire(key, CHAPTER_TTL_SECONDS);
    return content.nextUrl;
  } catch (e: unknown) {
    await save({ status: "error", error: e instanceof Error ? e.message : "Translation failed" }).catch(() => {});
    return null;
  }
}

// Hands the next step to a new invocation of /api/jobs/run so it gets its own time budget
export async function continueJob(origin: string, step: JobStep) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Lets the self-call through Vercel Deployment Protection on preview deployments
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  try {
    const res = await fetch(`${origin}/api/jobs/run`, {
      method: "POST",
      headers,
      body: JSON.stringify(step),
    });
    if (!res.ok) console.error(`[jobs] continue failed: ${res.status}`);
  } catch (e) {
    console.error("[jobs] continue failed", e);
  }
}

export async function runAndContinue(db: Redis, origin: string, step: JobStep) {
  const next = await runJobStep(db, step);
  if (next) await continueJob(origin, next);
}
