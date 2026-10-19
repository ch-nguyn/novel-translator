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
  runAndContinue,
  sanitizeKnown,
} from "../../lib/server/jobs";
import { resolveAiAccess } from "../../lib/server/aiAccess";
import { limitRequest } from "../../lib/server/rateLimit";
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
      return Response.json({ error: "API key is required. Set it in Settings." }, { status: 400 });
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
    if (force === true) await forgetReceipt(db, deviceId, url);
    const jobId = await createJob(db, deviceId, url);
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
        model: access.model,
        customPrompt: access.system ? planCustomPrompt(customPrompt) : customPrompt,
        glossary: terms,
        reasoningEffort,
        useGlossary: useGlossary !== false,
      })
    );

    return Response.json({ jobId }, { status: 202 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}

// ?deviceId=…&url=… → one chapter, plus whether a worker is still alive on it;
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
    return Response.json({ chapter, alive });
  }
  return Response.json({ chapters: await getAllChapters(db, deviceId) });
}

// The client saved (or discarded) these chapters; `cancelNovel` also stops the
// running job if it is translating that novel
export async function DELETE(req: Request) {
  const db = getRedis();
  if (!db) return Response.json(NOT_CONFIGURED, { status: 501 });

  const { deviceId, urls, cancelNovel } = await req.json();
  if (!isValidDeviceId(deviceId) || !Array.isArray(urls)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  await acknowledgeChapters(db, deviceId, urls.filter((u): u is string => typeof u === "string"));
  if (typeof cancelNovel === "string" && cancelNovel) await cancelNovelJob(db, deviceId, cancelNovel);
  return Response.json({ ok: true });
}
