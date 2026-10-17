import { TranslatedChapter, TranslateOptions, ZH_TITLE_PROMPT } from "./types";

// Pricing per million tokens: [input, output] in USD
// Models not listed here are considered free
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

export interface FetchContentResult {
  text: string;
  title: string;
  novelName: string;
  chapterName: string;
  prevUrl: string | null;
  nextUrl: string | null;
  lang: string;
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
    const err = await res.json();
    throw new Error(err.error || "Failed to fetch content");
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
  referenceLinks?: string,
  reasoningEffort?: string,
  webSearch?: boolean
): Promise<string> {
  const res = await fetch("/api/simplify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, apiKey, model, lang: lang || "vi", customPrompt, referenceLinks, reasoningEffort, webSearch }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to simplify");
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let result = "";

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
      onChunk?.(result);
    }
  }

  // Extract and log token usage
  const usageMatch = result.match(/\n<!--USAGE:(\{.*?\})-->/);
  if (usageMatch) {
    result = result.replace(usageMatch[0], "");
    try {
      const usage = JSON.parse(usageMatch[1]);
      const cost = calculateCost(model, usage.input, usage.output);
      const costStr = cost ? ` | Cost: ${cost}` : " | [Free]";
      console.log(
        `[Token Usage] Input: ${usage.input}, Output: ${usage.output}, Total: ${usage.input + usage.output}${costStr}`
      );
    } catch {
      // ignore
    }
    onChunk?.(result);
  }

  return result;
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

  const text = await simplifyText(
    data.text,
    options.apiKey,
    options.model,
    data.lang,
    signal,
    onText,
    options.customPrompt,
    options.referenceLinks,
    options.reasoningEffort,
    options.webSearch
  );

  let { title, novelName, chapterName } = data;
  // Translate title if Chinese (single API call for both titles)
  if (data.lang === "zh" && chapterName) {
    const translated = await translateTitles([chapterName, novelName], options.apiKey, options.model, ZH_TITLE_PROMPT);
    chapterName = translated[0] || chapterName;
    novelName = translated[1] || novelName;
    title = chapterName;
  }

  return { text, title, novelName, chapterName, prevUrl: data.prevUrl, nextUrl: data.nextUrl };
}
