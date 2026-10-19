import { createSimplifyStream } from "../../lib/server/simplify";
import { STREAM_NONCE_HEADER } from "../../lib/stream";
import { sanitizeTerms } from "../../lib/glossary";
import { resolveAiAccess } from "../../lib/server/aiAccess";
import { fetchContent, FetchContentError } from "../../lib/server/fetchContent";
import { clientIp } from "../../lib/server/rateLimit";
import { countPlanChapter, PlanBusyError, planCustomPrompt, releasingStream, takePlanSlot } from "../../lib/server/planLimits";

export const maxDuration = 300;

// `release`, done at most once
function once(release: () => Promise<void>): () => Promise<void> {
  let done: Promise<void> | null = null;
  return () => (done ??= release());
}

// Translates a chapter. On the user's key, the `text` sent; on the app's
// (the monthly plan), the chapter at `url`, fetched here: the plan
// translates the novel sites' chapters, not any text.
export async function POST(req: Request) {
  try {
    const { text: sentText, url, apiKey, model, lang: sentLang, customPrompt, glossary, reasoningEffort } = await req.json();

    const access = await resolveAiAccess(req, apiKey, model);
    if (!access) {
      return Response.json(
        { error: "API key is required. Set it in Settings." },
        { status: 400 }
      );
    }

    const terms = sanitizeTerms(glossary);
    if (!terms) {
      return Response.json({ error: "Invalid glossary" }, { status: 400 });
    }

    let text = sentText;
    let lang = sentLang;
    let release: (() => Promise<void>) | null = null;
    if (access.system) {
      if (!url || typeof url !== "string" || url.length > 2048) {
        return Response.json({ error: "Missing URL" }, { status: 400 });
      }
      try {
        release = once(await takePlanSlot(access.userId!));
      } catch (e) {
        if (e instanceof PlanBusyError) return Response.json({ error: e.message }, { status: 429 });
        throw e;
      }
      // The reader went away (closed the app, opened another chapter), maybe already
      req.signal.addEventListener("abort", () => release?.());
      if (req.signal.aborted) {
        await release();
        return new Response(null, { status: 499 });
      }
      try {
        ({ text, lang } = await fetchContent(url, undefined, clientIp(req)));
      } catch (e) {
        await release();
        if (e instanceof FetchContentError) return Response.json({ error: e.message }, { status: e.status });
        throw e;
      }
    } else if (!text || typeof text !== "string") {
      return Response.json({ error: "Missing text" }, { status: 400 });
    }

    let result: Awaited<ReturnType<typeof createSimplifyStream>>;
    try {
      result = await createSimplifyStream({
        text,
        apiKey: access.apiKey,
        model: access.model,
        lang,
        customPrompt: access.system ? planCustomPrompt(customPrompt) : customPrompt,
        glossary: terms,
        reasoningEffort,
        signal: access.system ? req.signal : undefined,
      });
    } catch (e) {
      await release?.();
      throw e;
    }
    if (access.system) await countPlanChapter(access.userId!);

    return new Response(release ? releasingStream(result.stream, release) : result.stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", [STREAM_NONCE_HEADER]: result.nonce },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
