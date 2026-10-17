import { translateTitle, translateTitleBatch } from "../../lib/server/translateTitle";

export async function POST(req: Request) {
  try {
    const { title, titles, apiKey, model, prompt } = await req.json();

    // Batch mode: translate multiple titles in a single AI call
    if (titles && Array.isArray(titles) && titles.length > 0 && apiKey) {
      const translated = await translateTitleBatch(apiKey, model, titles, prompt);
      return Response.json({ translated });
    }

    // Single mode (backward compatible)
    if (!title || !apiKey) {
      return Response.json({ translated: title }, { status: 200 });
    }

    const translated = await translateTitle(apiKey, model, title, prompt);
    return Response.json({ translated });
  } catch {
    return Response.json({ translated: "" }, { status: 200 });
  }
}
