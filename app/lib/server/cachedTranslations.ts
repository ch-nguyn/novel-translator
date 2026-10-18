import { parseNames, SEARCH_AI_MODEL } from "../search";
import { complete } from "./llm";
import { getRedis } from "./jobs";

// Short texts (novel names, chapter titles) translated by the AI with the
// reader's OpenAI key, and cached for every reader: a popular novel's names
// are then shown without asking the AI again. Every entry expires, so texts
// nobody looks at any more do not pile up.

const TTL_SECONDS = 90 * 24 * 3600;
// Longer texts are blurbs or junk, not worth keeping
const MAX_CACHED_CHARS = 60;

export interface TranslationKind {
  // Asks for a JSON object with the input's numbers (see parseNames)
  prompt: string;
  cacheKey: (text: string) => string;
  // Texts asked of the AI at once
  perCall: number;
  // What the call is for, in error logs
  task: string;
}

// The AI's translations of `texts`, in order ("" where it gave none)
async function ask(texts: string[], apiKey: string, kind: TranslationKind): Promise<string[]> {
  const answer = await complete({
    apiKey,
    model: SEARCH_AI_MODEL,
    system: kind.prompt,
    input: JSON.stringify(Object.fromEntries(texts.map((text, i) => [i + 1, text]))),
    maxTokens: 200 + 40 * texts.length,
    task: kind.task,
    reasoningEffort: "none",
  });
  const names = parseNames(answer, texts.length);
  if (!names || names.some((name) => !name)) console.error(`[${kind.task}] incomplete answer for ${texts.length} texts: ${answer.slice(0, 300)}`);
  return names ?? texts.map(() => "");
}

// Translations of `texts`, by text: from the cache, else from the AI (when
// there is a key). Missing when neither has them.
export async function cachedTranslations(texts: string[], apiKey: string, kind: TranslationKind): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (texts.length === 0) return found;
  const redis = getRedis();
  try {
    const cached = redis ? await redis.mget<unknown[]>(...texts.map(kind.cacheKey)) : [];
    // Values come back JSON-parsed: a name like "1984" is a number
    texts.forEach((text, i) => {
      const value = cached[i];
      if (value !== null && value !== undefined && value !== "") found.set(text, String(value));
    });
  } catch {
    // only a cache
  }
  const missing = texts.filter((text) => !found.has(text));
  if (missing.length === 0 || !apiKey) return found;
  const pipeline = redis?.pipeline();
  // In small batches side by side, then once more for any the AI skipped
  for (let attempt = 0; attempt < 2; attempt++) {
    const asking = texts.filter((text) => !found.has(text));
    if (asking.length === 0) break;
    const batches = Array.from({ length: Math.ceil(asking.length / kind.perCall) }, (_, i) => asking.slice(i * kind.perCall, (i + 1) * kind.perCall));
    const answers = await Promise.all(
      batches.map((batch) =>
        ask(batch, apiKey, kind).catch((e) => {
          console.error(`[${kind.task}] ${e instanceof Error ? e.message : e}`);
          // Still shown, untranslated
          return batch.map(() => "");
        })
      )
    );
    batches.forEach((batch, b) =>
      batch.forEach((text, i) => {
        const translation = answers[b][i];
        if (!translation) return;
        found.set(text, translation);
        if (text.length <= MAX_CACHED_CHARS) pipeline?.set(kind.cacheKey(text), translation, { ex: TTL_SECONDS });
      })
    );
  }
  if (pipeline && pipeline.length() > 0) await pipeline.exec().catch(() => {});
  return found;
}
