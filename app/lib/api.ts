import { GlossaryTerm, TranslatedChapter, TranslateOptions, ZH_TITLE_PROMPT } from "./types";
import { promptTerms } from "./glossary";
import { extractNovelSlug, getGlossary } from "./storage";
import { parseTranslationStream, STREAM_NONCE_HEADER } from "./stream";
import { SearchCandidate, SearchErrorCode, SearchResponse } from "./search";

// Pricing per million tokens: [input, output] in USD
// Models not listed here have unknown pricing
const MODEL_PRICING: Record<string, [number, number]> = {
  "gpt-5.4": [2.00, 8.00],
  "gpt-5.4-mini": [0.40, 1.60],
  "gpt-5.4-nano": [0.10, 0.40],
  "gpt-4.1": [2.00, 8.00],
  "gpt-4.1-mini": [0.40, 1.60],
  "gpt-4.1-nano": [0.10, 0.40],
  "gpt-4o": [2.50, 10.00],
  "gpt-4o-mini": [0.15, 0.60],
  "claude-opus-4-6-20260313": [15.00, 75.00],
  "claude-sonnet-4-6-20260313": [3.00, 15.00],
  "claude-haiku-4-5-20251001": [0.80, 4.00],
  "claude-sonnet-4-5-20250929": [3.00, 15.00],
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): string | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  const cost = (inputTokens * pricing[0] + outputTokens * pricing[1]) / 1_000_000;
  return `$${cost.toFixed(4)}`;
}

// Error message from a failed API response. Falls back to the status when the
// body is not JSON (e.g. a platform timeout page).
export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const err = await res.json().catch(() => null);
  if (err?.error) return err.error;
  if (res.status === 504) return `${fallback}: the server took too long to respond. Please try again.`;
  return `${fallback} (HTTP ${res.status})`;
}

export interface FetchContentResult {
  text: string;
  title: string;
  novelName: string;
  chapterName: string;
  prevUrl: string | null;
  nextUrl: string | null;
  lang: string;
}

// The first chapter's URL of the novel whose page `url` is
export async function fetchFirstChapterUrl(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch("/api/resolve-chapter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Failed to find the first chapter"));
  }
  return (await res.json()).url;
}

export async function fetchChapterContent(
  url: string,
  signal?: AbortSignal
): Promise<FetchContentResult> {
  const res = await fetch("/api/fetch-content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Failed to fetch content"));
  }

  const data = await res.json();
  return {
    text: data.text,
    title: data.title || "",
    novelName: data.novelName || "",
    chapterName: data.chapterName || "",
    prevUrl: data.prevUrl || null,
    nextUrl: data.nextUrl || null,
    lang: data.lang || "vi",
  };
}

export class SearchError extends Error {
  code: SearchErrorCode | null;

  constructor(code: SearchErrorCode | null, message: string) {
    super(message);
    this.name = "SearchError";
    this.code = code;
  }
}

// Novels on the supported sites named `query` (any language), or else exactly
// `candidate` (a Chinese name guessed by an earlier search)
export async function searchNovels(
  params: { query: string; candidate?: SearchCandidate; apiKey: string },
  signal?: AbortSignal
): Promise<SearchResponse> {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const code = ["needKey", "badKey", "aiFailed", "invalid"].includes(err?.error) ? (err.error as SearchErrorCode) : null;
    throw new SearchError(code, `Search failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function translateTitle(
  title: string,
  apiKey: string,
  model: string,
  prompt?: string
): Promise<string> {
  if (!title.trim() || !apiKey) return title;

  try {
    const res = await fetch("/api/translate-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, apiKey, model, prompt }),
    });

    if (!res.ok) return title;

    const data = await res.json();
    return data.translated || title;
  } catch {
    return title;
  }
}

export async function translateTitles(
  titles: string[],
  apiKey: string,
  model: string,
  prompt?: string
): Promise<string[]> {
  if (!apiKey || titles.every((t) => !t.trim())) return titles;

  try {
    const res = await fetch("/api/translate-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles, apiKey, model, prompt }),
    });

    if (!res.ok) return titles;

    const data = await res.json();
    return Array.isArray(data.translated) ? data.translated : titles;
  } catch {
    return titles;
  }
}

export async function simplifyText(
  text: string,
  apiKey: string,
  model: string,
  lang?: string,
  signal?: AbortSignal,
  onChunk?: (accumulated: string) => void,
  customPrompt?: string,
  glossary?: GlossaryTerm[],
  reasoningEffort?: string
): Promise<string> {
  const res = await fetch("/api/simplify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, apiKey, model, lang: lang || "vi", customPrompt, glossary, reasoningEffort }),
    signal,
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Failed to translate"));
  }

  const nonce = res.headers.get(STREAM_NONCE_HEADER) ?? "";
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let raw = "";

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        onChunk?.(parseTranslationStream(raw, nonce).text);
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      // The connection dropped: fine if the terminal record already arrived,
      // otherwise parsing below reports the chapter as unfinished
    }
  }

  const { text: result, usage, error } = parseTranslationStream(raw, nonce);
  onChunk?.(result);

  if (usage) {
    const cost = calculateCost(model, usage.input, usage.output);
    const costStr = cost ? ` | Cost: ${cost}` : " | [Unknown price]";
    console.log(
      `[Token Usage] Input: ${usage.input}, Output: ${usage.output}, Total: ${usage.input + usage.output}${costStr}`
    );
  }
  if (error) throw new Error(error);

  return result;
}

// The names `translation` introduced that `known` does not have yet. Never
// throws: the chapter is complete without them.
export async function extractChapterTerms(
  url: string,
  source: string,
  translation: string,
  known: GlossaryTerm[],
  options: TranslateOptions,
  signal?: AbortSignal
): Promise<GlossaryTerm[]> {
  try {
    const res = await fetch("/api/glossary/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, source, translation, known: promptTerms(known), apiKey: options.apiKey, model: options.model }),
      signal,
    });
    if (!res.ok) return [];
    const { terms } = await res.json();
    return Array.isArray(terms) ? terms : [];
  } catch {
    return [];
  }
}

export type ChapterMeta = Omit<TranslatedChapter, "text">;

// Fetches and translates a chapter in this browser tab (used when background jobs are unavailable)
export async function translateChapterDirect(
  url: string,
  options: TranslateOptions,
  signal: AbortSignal,
  onMeta: (meta: ChapterMeta) => void,
  onText: (text: string) => void
): Promise<TranslatedChapter> {
  const data = await fetchChapterContent(url, signal);
  onMeta(data);
  const useGlossary = options.useGlossary !== false;
  const glossary = useGlossary ? getGlossary(extractNovelSlug(url)) : [];

  const text = await simplifyText(
    data.text,
    options.apiKey,
    options.model,
    data.lang,
    signal,
    onText,
    options.customPrompt,
    promptTerms(glossary),
    options.reasoningEffort
  );

  let { title, novelName, chapterName } = data;
  const [translated, newTerms] = await Promise.all([
    // Both titles in a single call
    data.lang === "zh" && chapterName
      ? translateTitles([chapterName, novelName], options.apiKey, options.model, ZH_TITLE_PROMPT)
      : null,
    useGlossary ? extractChapterTerms(url, data.text, text, glossary, options, signal) : [],
  ]);
  if (translated) {
    chapterName = translated[0] || chapterName;
    novelName = translated[1] || novelName;
    title = chapterName;
  }

  return { text, title, novelName, chapterName, prevUrl: data.prevUrl, nextUrl: data.nextUrl, newTerms };
}
