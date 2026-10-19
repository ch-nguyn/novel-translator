import { translateTitle, translateTitleBatch } from "../../lib/server/translateTitle";
import { resolveAiAccess } from "../../lib/server/aiAccess";
import { ZH_TITLE_PROMPT } from "../../lib/types";
import { limitRequest } from "../../lib/server/rateLimit";

// A chapter's and its novel's name are translated together
const MAX_TITLES = 20;
const MAX_TITLE_CHARS = 200;
const isTitle = (title: unknown) => typeof title === "string" && title.length <= MAX_TITLE_CHARS;

export async function POST(req: Request) {
  const limited = await limitRequest(req, "titles");
  if (limited) return limited;
  try {
    const { title, titles, apiKey, model, prompt: sentPrompt } = await req.json();
    if (title !== undefined && !isTitle(title)) return Response.json({ translated: "" });
    if (titles !== undefined && (!Array.isArray(titles) || titles.length > MAX_TITLES || !titles.every(isTitle))) {
      return Response.json({ translated: [] });
    }
    const access = await resolveAiAccess(req, apiKey, model);
    // The monthly plan translates titles the app's way only
    const prompt = access?.system && sentPrompt !== ZH_TITLE_PROMPT ? undefined : sentPrompt;

    // Batch mode: translate multiple titles in a single AI call
    if (titles && Array.isArray(titles) && titles.length > 0 && access) {
      const translated = await translateTitleBatch(access.apiKey, access.model, titles, prompt);
      return Response.json({ translated });
    }

    // Single mode (backward compatible)
    if (!title || !access) {
      return Response.json({ translated: title }, { status: 200 });
    }

    const translated = await translateTitle(access.apiKey, access.model, title, prompt);
    return Response.json({ translated });
  } catch {
    return Response.json({ translated: "" }, { status: 200 });
  }
}
