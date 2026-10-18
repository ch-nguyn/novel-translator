import { createHmac, timingSafeEqual } from "crypto";
import { Redis } from "@upstash/redis";
import { ChapterJob, GlossaryTerm, TranslateOptions, ZH_TITLE_PROMPT } from "../types";
import { mergeTerms } from "../glossary";
import { extractNovelSlug } from "../storage";
import { fetchContent } from "./fetchContent";
import { createSimplifyStream } from "./simplify";
import { parseTranslationStream } from "../stream";
import { translateTitleBatch } from "./translateTitle";
import { extractTerms } from "./extractTerms";
import { systemApiKey } from "./aiAccess";

// Background translation jobs.
//
// A job translates a window of consecutive chapters starting at `url`. Each
// serverless invocation translates at most one chapter, then hands the rest of
// the window to a fresh invocation (via `continueJob`) so no single invocation
// hits the platform time limit. Results are kept in Redis per device until the
// client pulls them into localStorage.
//
// A worker owns a chapter through a claim key (SET NX with a short TTL) that
// holds a token unique to that worker; a heartbeat keeps it alive while the
// model works — even while it is reasoning and produces no text. Another job
// only retakes a chapter once its claim has expired, so a chapter is never
// translated (and paid for) twice at once. Every write, renewal and release is
// an atomic Lua check of the token, so a worker that lost its claim can never
// overwrite its successor's result.
//
// Chapters the device has saved are replaced by small "saved" receipts rather
// than deleted, so a job started from an older view of the device never
// translates them again.
//
// Each translated chapter also reports the names it introduced (newTerms);
// they are added to the glossary handed to the next chapter, so the chapters
// of one window name things alike before the device has seen any of them.
//
// The user's API key only travels in request bodies between invocations; it is
// never written to Redis. A job on the app's key carries `system` instead and
// reads the key from the environment. Steps passed between invocations are HMAC-signed.

const CHAPTER_TTL_SECONDS = 7 * 24 * 60 * 60;
const JOB_TTL_SECONDS = 24 * 60 * 60;
// How often partial text is written while the model is streaming
const FLUSH_INTERVAL_MS = 1500;
// A claim not refreshed for this long belongs to a dead worker
const CLAIM_TTL_SECONDS = 60;
const HEARTBEAT_INTERVAL_MS = 15_000;
// Upper bound on the chapters a device reports as already saved
export const MAX_KNOWN_CHAPTERS = 500;
const CONTINUE_RETRY_DELAYS_MS = [1000, 3000];
// Receipts of saved chapters are dropped after this long
const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Lua scripts: KEYS[1] is the claim key, ARGV[1] the worker's token
const OWNED_HSET = `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('HSET', KEYS[2], ARGV[2], ARGV[3]) return 1 end return 0`;
const OWNED_RENEW = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end return 0`;
const OWNED_RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
// KEYS[1] is the job key, ARGV[1] the ":novelSlug" suffix of the job to cancel
const CANCEL_IF_NOVEL = `local v = redis.call('GET', KEYS[1]) if v and string.sub(v, -string.len(ARGV[1])) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

export interface JobStep extends TranslateOptions {
  deviceId: string;
  jobId: string;
  url: string;
  // Chapters left in the window, including `url`
  remaining: number;
  // Chapters the device already has: url → nextUrl. These are skipped, not re-translated.
  known: Record<string, string | null>;
  // The novel's glossary, plus the names found by the window's chapters so far
  glossary: GlossaryTerm[];
  // Runs on the app's key (`apiKey` is then empty)
  system?: boolean;
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

// Validates the device's list of saved chapters; returns null if malformed or too large
export function sanitizeKnown(known: unknown): Record<string, string | null> | null {
  if (known === undefined || known === null) return {};
  if (typeof known !== "object" || Array.isArray(known)) return null;
  const entries = Object.entries(known as Record<string, unknown>);
  if (entries.length > MAX_KNOWN_CHAPTERS) return null;
  for (const [url, next] of entries) {
    if (url.length > 2048 || (next !== null && (typeof next !== "string" || next.length > 2048))) return null;
  }
  return known as Record<string, string | null>;
}

const chaptersKey = (deviceId: string) => `nt:${deviceId}:chapters`;
// Value: `${jobId}:${novelSlug}`
const jobKey = (deviceId: string) => `nt:${deviceId}:job`;
const claimKey = (deviceId: string, url: string) => `nt:${deviceId}:claim:${url}`;

// Registers a new job for the device. Any older job of the same device stops
// after finishing the chapter it is currently on.
export async function createJob(db: Redis, deviceId: string, startUrl: string): Promise<string> {
  const jobId = crypto.randomUUID();
  await db.set(jobKey(deviceId), `${jobId}:${extractNovelSlug(startUrl)}`, { ex: JOB_TTL_SECONDS });
  return jobId;
}

// The user cleared a novel: stop the device's job if (and only if) it is
// translating that novel. Atomic, so a job started meanwhile is never deleted.
export async function cancelNovelJob(db: Redis, deviceId: string, novelSlug: string) {
  await db.eval(CANCEL_IF_NOVEL, [jobKey(deviceId)], [`:${novelSlug}`]);
}

async function isCurrentJob(db: Redis, deviceId: string, jobId: string): Promise<boolean> {
  const current = await db.get<string>(jobKey(deviceId));
  return typeof current === "string" && current.startsWith(`${jobId}:`);
}

export async function getChapter(db: Redis, deviceId: string, url: string): Promise<ChapterJob | null> {
  return db.hget<ChapterJob>(chaptersKey(deviceId), url);
}

// Whether a worker currently holds the chapter (false means an unfinished chapter was abandoned)
export async function isChapterClaimed(db: Redis, deviceId: string, url: string): Promise<boolean> {
  return (await db.exists(claimKey(deviceId, url))) > 0;
}

const isFinished = (chapter: ChapterJob | null) => chapter?.status === "done" || chapter?.status === "saved";

// Every chapter stored for the device except "saved" receipts; expired receipts are dropped
export async function getAllChapters(db: Redis, deviceId: string): Promise<ChapterJob[]> {
  const all = await db.hgetall<Record<string, ChapterJob>>(chaptersKey(deviceId));
  if (!all) return [];
  const chapters = Object.values(all);
  const expired = chapters
    .filter((c) => c.status === "saved" && Date.now() - c.updatedAt > RECEIPT_TTL_MS)
    .map((c) => c.url);
  if (expired.length > 0) await db.hdel(chaptersKey(deviceId), ...expired);
  return chapters.filter((c) => c.status !== "saved");
}

// The user explicitly asked for this chapter again (it is no longer on the
// device): drop its "saved" receipt so the new job translates it
export async function forgetReceipt(db: Redis, deviceId: string, url: string) {
  const chapter = await getChapter(db, deviceId, url);
  if (chapter?.status === "saved") await db.hdel(chaptersKey(deviceId), url);
}

// The device saved (or discarded) these chapters. Finished ones are replaced
// by a receipt that keeps later jobs from translating them again; unfinished
// ones are removed so a later job can retry them.
export async function acknowledgeChapters(db: Redis, deviceId: string, urls: string[]) {
  for (const url of urls) {
    const chapter = await getChapter(db, deviceId, url);
    if (!chapter) continue;
    if (chapter.status === "done") {
      const receipt: ChapterJob = {
        url,
        jobId: chapter.jobId,
        status: "saved",
        lang: chapter.lang,
        text: "",
        title: "",
        novelName: "",
        chapterName: "",
        prevUrl: chapter.prevUrl,
        nextUrl: chapter.nextUrl,
        updatedAt: Date.now(),
      };
      await db.hset(chaptersKey(deviceId), { [url]: receipt });
    } else if (chapter.status !== "saved") {
      await db.hdel(chaptersKey(deviceId), url);
    }
  }
}

async function fetchNextUrl(url: string): Promise<string | null> {
  try {
    return (await fetchContent(url)).nextUrl;
  } catch {
    return null;
  }
}

// Walks the window from `step.url`, skipping chapters that are already
// available or owned by another worker, and translates the first one it can
// claim. Returns the step that should run next, or null when the window is
// finished or the job was replaced.
export async function runJobStep(db: Redis, step: JobStep): Promise<JobStep | null> {
  let url: string | null = step.url;
  let remaining = step.remaining;
  let glossary = step.glossary ?? [];

  while (url && remaining > 0) {
    if (!(await isCurrentJob(db, step.deviceId, step.jobId))) return null;
    remaining--;

    if (Object.hasOwn(step.known, url)) {
      url = step.known[url] ?? (await fetchNextUrl(url));
      continue;
    }

    const existing = await getChapter(db, step.deviceId, url);
    if (isFinished(existing)) {
      glossary = mergeTerms(glossary, existing!.newTerms ?? []);
      url = existing!.nextUrl ?? (await fetchNextUrl(url));
      continue;
    }

    const token = crypto.randomUUID();
    const claim = claimKey(step.deviceId, url);
    if (!(await db.set(claim, token, { nx: true, ex: CLAIM_TTL_SECONDS }))) {
      // Another worker is on it and will finish it
      url = existing?.nextUrl ?? (await fetchNextUrl(url));
      continue;
    }
    // The previous owner may have finished between our read and our claim
    const latest = await getChapter(db, step.deviceId, url);
    if (isFinished(latest)) {
      await db.eval(OWNED_RELEASE, [claim], [token]);
      glossary = mergeTerms(glossary, latest!.newTerms ?? []);
      url = latest!.nextUrl ?? (await fetchNextUrl(url));
      continue;
    }

    const result = await translateChapter(db, { ...step, glossary }, url, token);
    if (!result?.nextUrl || remaining <= 0) return null;
    return { ...step, url: result.nextUrl, remaining, glossary: mergeTerms(glossary, result.newTerms) };
  }

  return null;
}

// Translates one chapter claimed with `token`, writing progress to Redis.
// Returns the next chapter URL and the names the chapter introduced, or null
// on failure (the window stops so a bad key or quota error is not repeated
// for every chapter) or when the claim was lost.
async function translateChapter(
  db: Redis,
  step: JobStep,
  url: string,
  token: string
): Promise<{ nextUrl: string | null; newTerms: GlossaryTerm[] } | null> {
  const key = chaptersKey(step.deviceId);
  const claim = claimKey(step.deviceId, url);
  const apiKey = step.system ? systemApiKey() : step.apiKey;

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
  // Aborts the model request once another worker has taken the chapter over
  const lost = new AbortController();

  // Writes are serialized (so a heartbeat never lands after, and undoes, a
  // newer write) and only applied while this worker still holds the claim.
  let writes: Promise<unknown> = Promise.resolve();
  const save = (patch: Partial<ChapterJob>): Promise<boolean> => {
    chapter = { ...chapter, ...patch, updatedAt: Date.now() };
    const snapshot = JSON.stringify(chapter);
    const write = writes.then(async () => {
      if (lost.signal.aborted) return false;
      const owned = (await db.eval(OWNED_HSET, [claim, key], [token, url, snapshot])) === 1;
      if (!owned) lost.abort();
      return owned;
    });
    writes = write.catch(() => {});
    return write;
  };

  const heartbeat = setInterval(() => {
    writes = writes.then(async () => {
      if (lost.signal.aborted) return;
      if ((await db.eval(OWNED_RENEW, [claim], [token, String(CLAIM_TTL_SECONDS)])) !== 1) {
        lost.abort();
        return;
      }
      // Refresh updatedAt so watchers see the worker is alive while the model reasons
      chapter = { ...chapter, updatedAt: Date.now() };
      await db.eval(OWNED_HSET, [claim, key], [token, url, JSON.stringify(chapter)]);
    }).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

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

    const { stream, nonce } = await createSimplifyStream({
      text: content.text,
      apiKey,
      model: step.model,
      lang: content.lang,
      customPrompt: step.customPrompt,
      glossary: step.useGlossary === false ? undefined : step.glossary,
      reasoningEffort: step.reasoningEffort,
      signal: lost.signal,
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    let lastFlush = Date.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      if (Date.now() - lastFlush > FLUSH_INTERVAL_MS) {
        lastFlush = Date.now();
        await save({ text: parseTranslationStream(raw, nonce).text });
      }
    }
    if (lost.signal.aborted) return null;

    const { text, error } = parseTranslationStream(raw, nonce);
    if (error) {
      // Keep the partial text visible, but never mark a cut-off chapter as done
      chapter = { ...chapter, text };
      throw new Error(error);
    }

    let { novelName, chapterName } = content;
    const [titles, newTerms] = await Promise.all([
      content.lang === "zh" && chapterName
        ? translateTitleBatch(apiKey, step.model, [chapterName, novelName], ZH_TITLE_PROMPT).catch(() => null)
        : null,
      step.useGlossary === false
        ? []
        : extractTerms({
            apiKey,
            model: step.model,
            source: content.text,
            translation: text,
            known: step.glossary,
            chapterUrl: url,
          }),
    ]);
    if (titles) {
      chapterName = titles[0] || chapterName;
      novelName = titles[1] || novelName;
    }

    clearInterval(heartbeat);
    const saved = await save({
      status: "done",
      text,
      novelName,
      chapterName,
      title: content.lang === "zh" ? chapterName : content.title,
      newTerms,
    });
    // A worker that lost its claim did not write anything
    if (!saved) return null;
    await db.expire(key, CHAPTER_TTL_SECONDS);
    return { nextUrl: content.nextUrl, newTerms };
  } catch (e: unknown) {
    clearInterval(heartbeat);
    await save({ status: "error", error: e instanceof Error ? e.message : "Translation failed" }).catch(() => false);
    return null;
  } finally {
    clearInterval(heartbeat);
    await writes;
    await db.eval(OWNED_RELEASE, [claim], [token]).catch(() => {});
  }
}

function signingKey(): string {
  return (
    process.env.JOB_SIGNING_SECRET ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    ""
  );
}

// HMAC over every field of the step, so continuation requests cannot be forged
// or tampered with (e.g. an inflated `remaining`)
export function signStep(step: JobStep): string {
  const payload = JSON.stringify([
    step.deviceId,
    step.jobId,
    step.url,
    step.remaining,
    step.known,
    step.apiKey,
    step.system ?? false,
    step.model,
    step.customPrompt ?? null,
    step.glossary ?? [],
    step.reasoningEffort ?? null,
    step.useGlossary ?? null,
  ]);
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

export function verifyStep(step: JobStep, signature: unknown): boolean {
  if (typeof signature !== "string" || !signingKey()) return false;
  const expected = Buffer.from(signStep(step), "hex");
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Hands the next step to a new invocation of /api/jobs/run so it gets its own
// time budget. Retries briefly: a dropped handoff would silently end the window.
export async function continueJob(origin: string, step: JobStep) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Lets the self-call through Vercel Deployment Protection on preview deployments
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const body = JSON.stringify({ step, signature: signStep(step) });

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${origin}/api/jobs/run`, { method: "POST", headers, body });
      // 4xx will not get better by retrying
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        if (!res.ok) console.error(`[jobs] continue rejected: ${res.status}`);
        return;
      }
      console.error(`[jobs] continue failed: ${res.status}`);
    } catch (e) {
      console.error("[jobs] continue failed", e);
    }
    if (attempt >= CONTINUE_RETRY_DELAYS_MS.length) return;
    await new Promise((r) => setTimeout(r, CONTINUE_RETRY_DELAYS_MS[attempt]));
  }
}

export async function runAndContinue(db: Redis, origin: string, step: JobStep) {
  const next = await runJobStep(db, step);
  if (next) await continueJob(origin, next);
}
