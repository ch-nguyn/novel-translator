import { after } from "next/server";
import { PREFETCH_CHAPTERS } from "../../lib/types";
import { sanitizeTerms } from "../../lib/glossary";
import {
  cancelNovelJob,
  createJob,
  acknowledgeChapters,
  forgetReceipt,
  getAllChapters,
  getChapter,
  getRedis,
  isChapterClaimed,
  isValidDeviceId,
  MAX_ACKNOWLEDGED,
  runAndContinue,
  sanitizeKnown,
} from "../../lib/server/jobs";
import { resolveAiAccess } from "../../lib/server/aiAccess";
import { clientIp, limitRequest } from "../../lib/server/rateLimit";
import { errorResponse, responseFor } from "../../lib/server/apiError";
import { planCustomPrompt } from "../../lib/server/planLimits";

export const maxDuration = 300;

const NOT_CONFIGURED = { error: "Background jobs are not configured (missing Upstash Redis env vars)" };

// Start a background job translating `url` and the following chapters
export async function POST(req: Request) {
  const db = getRedis();
  if (!db) return Response.json(NOT_CONFIGURED, { status: 501 });
  const limited = await limitRequest(req, "jobs");
  if (limited) return limited;

  try {
    const { deviceId, url, apiKey, model, customPrompt, glossary, useGlossary, reasoningEffort, known, force } = await req.json();

    if (!isValidDeviceId(deviceId)) {
      return Response.json({ error: "Invalid device id" }, { status: 400 });
    }
    if (!url || typeof url !== "string" || url.length > 2048) {
      return Response.json({ error: "Missing URL" }, { status: 400 });
    }
    const access = await resolveAiAccess(req, apiKey, model);
    if (!access) {
      return errorResponse("needKey", "API key is required. Set it in Settings.", 400);
    }
    const knownChapters = sanitizeKnown(known);
    if (!knownChapters) {
      return Response.json({ error: "Invalid list of saved chapters" }, { status: 400 });
    }
    const terms = sanitizeTerms(glossary);
    if (!terms) {
      return Response.json({ error: "Invalid glossary" }, { status: 400 });
    }

    // `force`: the user opened this chapter and the device does not have it
    let jobId: string;
    try {
      if (force === true) await forgetReceipt(db, deviceId, url);
      jobId = await createJob(db, deviceId, url);
    } catch (e) {
      // Redis failing: the device translates the chapter itself meanwhile
      console.error(`[jobs] not started: ${e instanceof Error ? e.message : e}`);
      return errorResponse("busy", "Background translation is unavailable for a moment.", 503);
    }
    after(() =>
      runAndContinue(db, new URL(req.url).origin, {
        deviceId,
        jobId,
        url,
        remaining: 1 + PREFETCH_CHAPTERS,
        known: knownChapters,
        // The app's key is read again by each step, never passed between them
        apiKey: access.system ? "" : access.apiKey,
        system: access.system,
        userId: access.userId,
        ip: clientIp(req),
        model: access.model,
        customPrompt: access.system ? planCustomPrompt(customPrompt) : customPrompt,
        glossary: terms,
        reasoningEffort,
        // Remembering names is part of the monthly plan
        useGlossary: access.system && useGlossary !== false,
      })
    );

    return Response.json({ jobId }, { status: 202 });
  } catch (e: unknown) {
    return responseFor(e);
  }
}

// ?deviceId=…&url=… → one chapter, plus whether a worker is still alive on it
// (&since=<its updatedAt the device has> → without the text of an unfinished
// chapter that has not changed since);
// ?deviceId=… → every chapter stored for the device
export async function GET(req: Request) {
  const db = getRedis();
  if (!db) return Response.json(NOT_CONFIGURED, { status: 501 });

  const params = new URL(req.url).searchParams;
  const deviceId = params.get("deviceId");
  const url = params.get("url");
  if (!isValidDeviceId(deviceId)) {
    return Response.json({ error: "Invalid device id" }, { status: 400 });
  }

  if (url) {
    const chapter = await getChapter(db, deviceId, url);
    const inProgress = chapter?.status === "fetching" || chapter?.status === "translating";
    const alive = inProgress && (await isChapterClaimed(db, deviceId, url));
    const unchanged = inProgress && chapter.updatedAt === Number(params.get("since"));
    return Response.json({ chapter: unchanged ? { ...chapter, text: "" } : chapter, alive });
  }
  return Response.json({ chapters: await getAllChapters(db, deviceId) });
}

// The client saved (or discarded) these chapters; `cancelNovel` also stops the
// running job if it is translating that novel
export async function DELETE(req: Request) {
  const db = getRedis();
  if (!db) return Response.json(NOT_CONFIGURED, { status: 501 });
  const limited = await limitRequest(req, "acknowledge");
  if (limited) return limited;

  const { deviceId, urls, cancelNovel } = await req.json().catch(() => ({}));
  if (
    !isValidDeviceId(deviceId) ||
    !Array.isArray(urls) ||
    urls.length > MAX_ACKNOWLEDGED ||
    !urls.every((u) => typeof u === "string" && u.length <= 2048) ||
    (cancelNovel !== undefined && (typeof cancelNovel !== "string" || cancelNovel.length > 512))
  ) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  await acknowledgeChapters(db, deviceId, [...new Set<string>(urls)]);
  if (typeof cancelNovel === "string" && cancelNovel) await cancelNovelJob(db, deviceId, cancelNovel);
  return Response.json({ ok: true });
}
