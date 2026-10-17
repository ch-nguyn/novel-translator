import { createSimplifyStream } from "../../lib/server/simplify";

export async function POST(req: Request) {
  try {
    const { text, apiKey, model, lang, customPrompt, referenceLinks, reasoningEffort, webSearch } = await req.json();

    if (!text || typeof text !== "string") {
      return Response.json({ error: "Missing text" }, { status: 400 });
    }

    if (!apiKey || typeof apiKey !== "string") {
      return Response.json(
        { error: "API key is required. Set it in Settings." },
        { status: 400 }
      );
    }

    const stream = await createSimplifyStream({
      text,
      apiKey,
      model,
      lang,
      customPrompt,
      referenceLinks,
      reasoningEffort,
      webSearch,
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
