import { DEFAULT_AI_MODEL } from "../../../lib/types";
import { sanitizeTerms } from "../../../lib/glossary";
import { extractTerms } from "../../../lib/server/extractTerms";

export const maxDuration = 60;

const MAX_TEXT_LENGTH = 200_000;

// The names a translated chapter introduced, for the novel's glossary.
// Used when a chapter is translated in the tab and to scan saved chapters;
// background jobs call extractTerms themselves.
export async function POST(req: Request) {
  try {
    const { apiKey, model, source, translation, known, url } = await req.json();
    if (!apiKey || typeof apiKey !== "string") {
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
      apiKey,
      model: typeof model === "string" && model ? model : DEFAULT_AI_MODEL,
      source,
      translation,
      known: knownTerms,
      chapterUrl: typeof url === "string" && url.length <= 2048 ? url : undefined,
    });
    return Response.json({ terms });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
