import { after } from "next/server";
import { PREFETCH_CHAPTERS } from "../../lib/types";
import {
  createJob,
  deleteChapters,
  getAllChapters,
  getChapter,
  getRedis,
  isValidDeviceId,
  runAndContinue,
} from "../../lib/server/jobs";

export const maxDuration = 300;

const NOT_CONFIGURED = { error: "Background jobs are not configured (missing Upstash Redis env vars)" };

// Start a background job translating `url` and the following chapters
export async function POST(req: Request) {
  const db = getRedis();
  if (!db) return Response.json(NOT_CONFIGURED, { status: 501 });

  try {
    const { deviceId, url, apiKey, model, customPrompt, referenceLinks, reasoningEffort, webSearch, known } = await req.json();

    if (!isValidDeviceId(deviceId)) {
      return Response.json({ error: "Invalid device id" }, { status: 400 });
    }
    if (!url || typeof url !== "string") {
      return Response.json({ error: "Missing URL" }, { status: 400 });
    }
    if (!apiKey || typeof apiKey !== "string") {
      return Response.json({ error: "API key is required. Set it in Settings." }, { status: 400 });
    }

    const jobId = await createJob(db, deviceId);
    after(() =>
      runAndContinue(db, new URL(req.url).origin, {
        deviceId,
        jobId,
        url,
        remaining: 1 + PREFETCH_CHAPTERS,
        known: known && typeof known === "object" ? known : {},
        apiKey,
        model,
        customPrompt,
        referenceLinks,
        reasoningEffort,
        webSearch: !!webSearch,
      })
    );

    return Response.json({ jobId }, { status: 202 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}

// ?deviceId=…&url=… → one chapter; ?deviceId=… → every chapter stored for the device
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
    return Response.json({ chapter: await getChapter(db, deviceId, url) });
  }
  return Response.json({ chapters: await getAllChapters(db, deviceId) });
}

// Remove chapters the client has already saved locally
export async function DELETE(req: Request) {
  const db = getRedis();
  if (!db) return Response.json(NOT_CONFIGURED, { status: 501 });

  const { deviceId, urls } = await req.json();
  if (!isValidDeviceId(deviceId) || !Array.isArray(urls)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  await deleteChapters(db, deviceId, urls.filter((u): u is string => typeof u === "string"));
  return Response.json({ ok: true });
}
