import { sanitizeTerms } from "../../../lib/glossary";
import { extractTerms } from "../../../lib/server/extractTerms";
import { resolveAiAccess } from "../../../lib/server/aiAccess";
import { takePlanSlot } from "../../../lib/server/planLimits";
import { limitRequest } from "../../../lib/server/rateLimit";
import { ApiError, errorResponse, responseFor } from "../../../lib/server/apiError";

export const maxDuration = 60;

// A chapter's worth (its translation is longer than the Chinese)
const MAX_SOURCE = 50_000;
const MAX_TRANSLATION = 150_000;

// The names a translated chapter introduced, for the novel's glossary: by the
// app's AI on the monthly plan, otherwise with the reader's own API key.
// Used when a chapter is translated in the tab and to scan saved chapters;
// background jobs call extractTerms themselves.
export async function POST(req: Request) {
  try {
    const { apiKey, model, source, translation, known } = await req.json();
    const access = await resolveAiAccess(req, apiKey, model);
    if (!access) {
      return errorResponse("needKey", "API key is required. Set it in Settings.", 400);
    }
    if (!access.system) {
      const limited = await limitRequest(req, "extract");
      if (limited) return limited;
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

    // The plan's chapters at once (the reader's own key is theirs to spend)
    let release: () => Promise<void> = async () => {};
    if (access.system) {
      try {
        release = await takePlanSlot(access.userId!);
      } catch (e) {
        if (e instanceof ApiError) return responseFor(e);
        throw e;
      }
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
