import { translateTitle, translateTitleBatch } from "../../lib/server/translateTitle";
import { resolveAiAccess } from "../../lib/server/aiAccess";

export async function POST(req: Request) {
  try {
    const { title, titles, apiKey, model, prompt } = await req.json();
    const access = await resolveAiAccess(req, apiKey, model);

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
