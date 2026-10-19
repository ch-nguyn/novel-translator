import { translateTitle, translateTitleBatch } from "../../lib/server/translateTitle";
import { helperAi } from "../../lib/server/helperAi";
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
    // The app's AI (see helperAi), which translates titles its own way only
    const ai = helperAi(req, apiKey, model);
    const prompt = ai?.system && sentPrompt !== ZH_TITLE_PROMPT ? undefined : sentPrompt;

    // Batch mode: translate multiple titles in a single AI call
    if (titles && Array.isArray(titles) && titles.length > 0 && ai) {
      if (!(await ai.allowCall())) return Response.json({ translated: titles });
      const translated = await translateTitleBatch(ai.apiKey, ai.model, titles, prompt);
      return Response.json({ translated });
    }

    // Single mode (backward compatible)
    if (!title || !ai || !(await ai.allowCall())) {
      return Response.json({ translated: title }, { status: 200 });
    }

    const translated = await translateTitle(ai.apiKey, ai.model, title, prompt);
    return Response.json({ translated });
  } catch {
    return Response.json({ translated: "" }, { status: 200 });
  }
}
