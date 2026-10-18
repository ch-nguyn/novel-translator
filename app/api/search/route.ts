import { DEFAULT_AI_MODEL } from "../../lib/types";
import { hasChinese, MAX_QUERY_CHARS, SearchCandidate, SearchErrorCode } from "../../lib/search";
import { guessCandidates, searchNovels } from "../../lib/server/searchNovels";
import { ModelCallError } from "../../lib/server/llm";

function fail(code: SearchErrorCode, status: number) {
  return Response.json({ error: code }, { status });
}

// Finds novels on the supported sites by name. A name typed in Vietnamese or
// pinyin is first turned into Chinese by the AI; a Chinese one (typed, or a
// guess picked again from an earlier search) is searched as it is.
export async function POST(req: Request) {
  let body: { query?: unknown; candidate?: unknown; apiKey?: unknown; model?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return fail("invalid", 400);
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_AI_MODEL;

  let candidates: SearchCandidate[];
  const picked = body.candidate as Partial<Record<keyof SearchCandidate, unknown>> | undefined;
  if (picked && typeof picked === "object") {
    const name = (value: unknown) => (typeof value === "string" && hasChinese(value) && value.length <= 50 ? value : undefined);
    const title = name(picked.title);
    if (!title) return fail("invalid", 400);
    candidates = [{ title, titleTraditional: name(picked.titleTraditional), author: name(picked.author), authorTraditional: name(picked.authorTraditional) }];
  } else {
    if (!query || query.length > MAX_QUERY_CHARS) return fail("invalid", 400);
    const chinese = hasChinese(query);
    if (!apiKey && !chinese) return fail("needKey", 400);
    try {
      // A Chinese name is searchable without the AI, which only adds its
      // other script and author (to find it among look-alikes)
      candidates = apiKey ? await guessCandidates(apiKey, model, query) : [];
    } catch (e) {
      const rejected = e instanceof ModelCallError && (e.status === 401 || e.status === 403);
      if (!chinese) return rejected ? fail("badKey", 401) : fail("aiFailed", 502);
      candidates = [];
    }
    if (candidates.length === 0) {
      if (!chinese) return fail("aiFailed", 502);
      candidates = [{ title: query }];
    }
  }

  return Response.json(await searchNovels(candidates), { headers: { "Cache-Control": "no-store" } });
}
