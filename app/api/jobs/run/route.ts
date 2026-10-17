import { after } from "next/server";
import { getRedis, JobStep, runAndContinue, verifyStep } from "../../../lib/server/jobs";

export const maxDuration = 300;

// Continues a background job with its next chapter. Only accepts steps signed
// by the job itself (see signStep); the runner then checks the job is still current.
export async function POST(req: Request) {
  const db = getRedis();
  if (!db) return Response.json({ error: "Not configured" }, { status: 501 });

  const { step, signature } = (await req.json()) as { step: JobStep; signature: unknown };
  if (!step || typeof step !== "object" || !verifyStep(step, signature)) {
    return Response.json({ error: "Invalid step" }, { status: 403 });
  }

  after(() => runAndContinue(db, new URL(req.url).origin, step));
  return Response.json({ ok: true }, { status: 202 });
}
