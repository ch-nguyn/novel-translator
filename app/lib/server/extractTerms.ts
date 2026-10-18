import { GlossaryTerm } from "../types";
import { sanitizeTerms } from "../glossary";
import { complete, getProvider, ModelCallError } from "./llm";

// Lists the names a translated chapter introduced, with the original text and
// the translation it used, for the novel's glossary (see app/lib/glossary.ts).

// Lining up names between a chapter and its translation needs no large
// model, so OpenAI keys use a small one (falling back to the user's model if
// the key cannot use it)
const OPENAI_EXTRACTION_MODEL = "gpt-5.4-mini";
const MAX_NEW_TERMS = 60;
// Known names listed in the request so the model does not repeat them
const MAX_KNOWN_LISTED = 300;
const MAX_SOURCE_CHARS = 40_000;
const MAX_TRANSLATION_CHARS = 80_000;

const PROMPT = `Bạn nhận được một chương truyện gốc (trong thẻ <original>) và bản dịch tiếng Việt của chương đó (trong thẻ <translation>). Hãy liệt kê các TÊN RIÊNG trong chương để các chương sau dịch thống nhất, chia theo loại:
- character: tên người, biệt hiệu của một nhân vật cụ thể
- place: địa danh (thành, trấn, núi, sông, đại lục, bí cảnh...)
- organization: tông môn, môn phái, gia tộc, thế lực, triều đại
- skill: công pháp, chiêu thức, bí thuật, cảnh giới tu luyện
- item: pháp bảo, binh khí, đan dược, linh thú có tên riêng
- other: tên riêng khác (chủng tộc, danh hiệu riêng...)

Quy tắc:
- "source": chép NGUYÊN VĂN từ bản gốc, không thêm bớt chữ nào.
- "target": chép NGUYÊN VĂN cách bản dịch đã viết tên đó (giữ nguyên hoa thường). Bản dịch không có tên đó thì bỏ qua.
- "gender": chỉ cho character, "male" hoặc "female" khi chương cho biết rõ; không chắc thì bỏ trống.
- KHÔNG liệt kê từ thông thường, đại từ, xưng hô hay chức danh chung (sư phụ, đại ca, trưởng lão, bệ hạ...), con số.
- Tên trong danh sách "Đã biết" (dạng gốc=cách dịch): chỉ liệt kê lại nếu bản dịch này viết tên đó KHÁC đi, với "target" là cách bản dịch này đã viết.
- Mỗi tên một lần, tối đa 40 tên quan trọng nhất.

Chỉ trả về JSON đúng dạng sau, không giải thích:
{"terms":[{"source":"林动","target":"Lâm Động","kind":"character","gender":"male"}]}`;

interface ExtractParams {
  apiKey: string;
  model: string;
  // The chapter as fetched, and its translation
  source: string;
  translation: string;
  // The novel's glossary so far
  known: GlossaryTerm[];
  // Recorded as where the new names were first seen
  chapterUrl?: string;
}

// The JSON object in a model answer that may wrap it in a code fence or prose
function parseAnswer(answer: string): unknown {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return (JSON.parse(answer.slice(start, end + 1)) as { terms?: unknown }).terms ?? null;
  } catch {
    return null;
  }
}

const HAS_CJK = /[㐀-鿿豈-﫿]/;

// Never throws: a chapter is complete without its names, so any failure just
// yields none
export async function extractTerms({ apiKey, model, source, translation, known, chapterUrl }: ExtractParams): Promise<GlossaryTerm[]> {
  const sourceText = source.slice(0, MAX_SOURCE_CHARS);
  const translatedText = translation.slice(0, MAX_TRANSLATION_CHARS);
  const knownTargets = new Map(known.filter((t) => t.source).map((t) => [t.source, t.target]));
  const listed = [...knownTargets]
    .filter(([source]) => sourceText.includes(source))
    .slice(0, MAX_KNOWN_LISTED)
    .map(([source, target]) => `${source}=${target}`);
  const input =
    (listed.length > 0 ? `Đã biết: ${listed.join(", ")}\n\n` : "") +
    `<original>\n${sourceText}\n</original>\n\n<translation>\n${translatedText}\n</translation>`;

  const models = getProvider(model) === "openai" && model !== OPENAI_EXTRACTION_MODEL ? [OPENAI_EXTRACTION_MODEL, model] : [model];
  let answer = "";
  for (const candidate of models) {
    try {
      answer = await complete({ apiKey, model: candidate, system: PROMPT, input, maxTokens: 4000, task: "extract-terms" });
      break;
    } catch (e) {
      // Only a model this key cannot use is worth retrying with the user's own model
      const retry = e instanceof ModelCallError && [400, 403, 404].includes(e.status);
      if (!retry) return [];
    }
  }

  const terms = sanitizeTerms(parseAnswer(answer), 500) ?? [];
  const seen = new Set<string>();
  const found: GlossaryTerm[] = [];
  for (const term of terms) {
    // Only names really in this chapter and its translation, so a made-up or
    // misspelled one never enters the glossary. A known name comes back only
    // when written differently, to be recorded as a variant and fixed.
    if (
      term.source.length < 2 ||
      knownTargets.get(term.source) === term.target ||
      seen.has(term.source) ||
      !sourceText.includes(term.source) ||
      !translatedText.includes(term.target) ||
      HAS_CJK.test(term.target)
    ) {
      continue;
    }
    seen.add(term.source);
    const { aliases: _aliases, edited: _edited, ...clean } = term;
    found.push(chapterUrl ? { ...clean, firstSeen: chapterUrl } : clean);
    if (found.length >= MAX_NEW_TERMS) break;
  }
  return found;
}
