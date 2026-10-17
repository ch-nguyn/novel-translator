import { after } from "next/server";
import { getRedis, isCurrentJob, isValidDeviceId, JobStep, runAndContinue } from "../../../lib/server/jobs";

export const maxDuration = 300;

// Continues a background job with its next chapter. Called by the job itself;
// only steps whose jobId is still the device's current job are accepted.
export async function POST(req: Request) {
  const db = getRedis();
  if (!db) return Response.json({ error: "Not configured" }, { status: 501 });

  const step: JobStep = await req.json();
  if (!isValidDeviceId(step.deviceId) || typeof step.jobId !== "string" || typeof step.url !== "string") {
    return Response.json({ error: "Invalid step" }, { status: 400 });
  }
  if (!(await isCurrentJob(db, step.deviceId, step.jobId))) {
    return Response.json({ skipped: true });
  }

  after(() => runAndContinue(db, new URL(req.url).origin, step));
  return Response.json({ ok: true }, { status: 202 });
}
