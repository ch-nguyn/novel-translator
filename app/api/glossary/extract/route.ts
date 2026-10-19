import { sanitizeTerms } from "../../../lib/glossary";
import { extractTerms } from "../../../lib/server/extractTerms";
import { resolveAiAccess } from "../../../lib/server/aiAccess";

export const maxDuration = 60;

const MAX_TEXT_LENGTH = 200_000;

// The names a translated chapter introduced, for the novel's glossary.
// Used when a chapter is translated in the tab and to scan saved chapters;
// background jobs call extractTerms themselves.
export async function POST(req: Request) {
  try {
    const { apiKey, model, source, translation, known } = await req.json();
    const access = await resolveAiAccess(req, apiKey, model);
    if (!access) {
      return Response.json({ error: "API key is required. Set it in Settings." }, { status: 400 });
    }
    if (
      typeof source !== "string" ||
      typeof translation !== "string" ||
      source.length > MAX_TEXT_LENGTH ||
      translation.length > MAX_TEXT_LENGTH
    ) {
      return Response.json({ error: "Invalid chapter text" }, { status: 400 });
    }
    const knownTerms = sanitizeTerms(known);
    if (!knownTerms) {
      return Response.json({ error: "Invalid glossary" }, { status: 400 });
    }

    const terms = await extractTerms({
      apiKey: access.apiKey,
      model: access.model,
      source,
      translation,
      known: knownTerms,
    });
    return Response.json({ terms });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
