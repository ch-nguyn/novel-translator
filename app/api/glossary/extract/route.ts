import { sanitizeTerms } from "../../../lib/glossary";
import { extractTerms } from "../../../lib/server/extractTerms";
import { resolveAiAccess } from "../../../lib/server/aiAccess";
import { takePlanSlot } from "../../../lib/server/planLimits";
import { ApiError, responseFor } from "../../../lib/server/apiError";

export const maxDuration = 60;

// A chapter's worth (its translation is longer than the Chinese)
const MAX_SOURCE = 50_000;
const MAX_TRANSLATION = 150_000;

// The names a translated chapter introduced, for the novel's glossary (on the
// monthly plan only).
// Used when a chapter is translated in the tab and to scan saved chapters;
// background jobs call extractTerms themselves.
export async function POST(req: Request) {
  try {
    const { apiKey, model, source, translation, known } = await req.json();
    const access = await resolveAiAccess(req, apiKey, model);
    // Remembering names is part of the monthly plan
    if (!access?.system) {
      return Response.json({ error: "Remembering names is part of the monthly plan." }, { status: 403 });
    }
    if (
      typeof source !== "string" ||
      typeof translation !== "string" ||
      source.length > MAX_SOURCE ||
      translation.length > MAX_TRANSLATION
    ) {
      return Response.json({ error: "Invalid chapter text" }, { status: 400 });
    }
    const knownTerms = sanitizeTerms(known);
    if (!knownTerms) {
      return Response.json({ error: "Invalid glossary" }, { status: 400 });
    }

    let release: () => Promise<void>;
    try {
      release = await takePlanSlot(access.userId!);
    } catch (e) {
      if (e instanceof ApiError) return responseFor(e);
      throw e;
    }
    try {
      const terms = await extractTerms({
        apiKey: access.apiKey,
        model: access.model,
        source,
        translation,
        known: knownTerms,
      });
      return Response.json({ terms });
    } finally {
      await release();
    }
  } catch (e) {
    if (e instanceof ApiError) return responseFor(e);
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
