import { DEFAULT_AI_MODEL } from "../types";
import { complete } from "./llm";
import { digitChapterNumber, digitChineseChapterNumber, tocChapterNumber } from "../chapterTitle";

const DEFAULT_PROMPT = "Dịch tiêu đề truyện sau từ tiếng Trung sang phiên âm Hán Việt. KHÔNG được để lại bất kỳ chữ Trung Quốc nào. Số chương phải viết bằng số (VD: 第二十章 → Chương 20, 第一百零三章 → Chương 103). Chỉ trả về bản dịch, không giải thích.";

// Falls back to the original title when the call fails
async function translate(apiKey: string, model: string, title: string, prompt: string, maxTokens = 200): Promise<string> {
  try {
    return (await complete({ apiKey, model, system: prompt, input: title, maxTokens, task: "translate-title" })) || title;
  } catch {
    return title;
  }
}

// The chapter number in digits, whatever the AI writes: given to it in
// digits, and turned back into digits if it spells it out anyway
function numbered(title: string, translated: string): string {
  return translated === title ? title : digitChapterNumber(translated, tocChapterNumber(title));
}

export async function translateTitle(apiKey: string, model: string | undefined, title: string, prompt?: string): Promise<string> {
  return numbered(title, await translate(apiKey, model || DEFAULT_AI_MODEL, digitChineseChapterNumber(title), prompt || DEFAULT_PROMPT));
}

// Translate multiple titles in a single AI call
export async function translateTitleBatch(apiKey: string, model: string | undefined, titles: string[], prompt?: string): Promise<string[]> {
  const combined = titles.map((t, i) => `[${i + 1}] ${digitChineseChapterNumber(t)}`).join("\n");
  const batchPrompt = (prompt || DEFAULT_PROMPT) +
    `\n\nCó ${titles.length} tiêu đề cần dịch, mỗi tiêu đề trên một dòng có đánh số [1], [2],... Trả về bản dịch theo đúng format [1] ..., [2] ..., mỗi dòng một tiêu đề.`;
  // Room for every line (search results translate a few dozen names at once)
  const result = await translate(apiKey, model || DEFAULT_AI_MODEL, combined, batchPrompt, 200 + 40 * titles.length);
  return titles.map((_, i) => {
    const regex = new RegExp(`\\[${i + 1}\\]\\s*(.+)`);
    const match = result.match(regex);
    return match ? numbered(titles[i], match[1].trim()) : titles[i];
  });
}
