import { GlossaryTerm } from "../types";
import { MAX_NOTE_LENGTH, sanitizeTerms } from "../glossary";
import { complete, getProvider, ModelCallError } from "./llm";

// Lists the names a translated chapter introduced, with the original text and
// the translation it used, for the novel's glossary (see app/lib/glossary.ts);
// with what the chapter told of them (notes), and a summary of the chapter,
// to remind the reader later. One request, on a model that has read the chapter anyway.

// Lining up names between a chapter and its translation needs no large
// model, so OpenAI keys use a small one (falling back to the user's model if
// the key cannot use it)
const OPENAI_EXTRACTION_MODEL = "gpt-5.6-luna";
const MAX_NEW_TERMS = 60;
// Known names listed in the request so the model does not repeat them
const MAX_KNOWN_LISTED = 300;
// Of their latest note, what is shown to the model
const KNOWN_NOTE_CHARS = 80;
export const MAX_SUMMARY_LENGTH = 400;
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
- "note": điều ĐÁNG NHỚ chương này cho biết về tên đó, viết bằng tiếng Việt với đúng tên như bản dịch, tối đa 100 ký tự. Lần đầu xuất hiện: là ai/là gì (thân phận, quan hệ với nhân vật chính). Về sau: chỉ sự kiện lớn (đột phá cảnh giới, bị thương nặng, chết, phản bội, kết thân, lộ thân phận...). Không có gì đáng nhớ thì bỏ trống. Chủ yếu cho character, các loại khác chỉ khi thật quan trọng.
- Tên trong danh sách "Đã biết" (dạng gốc=cách dịch, kèm [đã ghi: ...] là ghi chú gần nhất): chỉ liệt kê lại nếu bản dịch này viết tên đó KHÁC đi (với "target" là cách bản dịch này đã viết), hoặc nếu chương có điều mới đáng nhớ về tên đó (với "target" như cũ và "note"). KHÔNG ghi lại điều đã ghi.
- Mỗi tên một lần, tối đa 40 tên quan trọng nhất.
- "summary": tóm tắt diễn biến chính của chương trong 1-2 câu tiếng Việt (tối đa 300 ký tự), dùng đúng tên như bản dịch.

Chỉ trả về JSON đúng dạng sau, không giải thích:
{"terms":[{"source":"林动","target":"Lâm Động","kind":"character","gender":"male","note":"Thiếu niên Lâm gia, nhân vật chính"}],"summary":"Lâm Động nhặt được một viên đá thần bí sau trận tỷ thí với Lâm Hoành."}`;

interface ExtractParams {
  apiKey: string;
  model: string;
  // The chapter as fetched, and its translation
  source: string;
  translation: string;
  // The novel's glossary so far
  known: GlossaryTerm[];
}

// The JSON object in a model answer that may wrap it in a code fence or prose
function parseAnswer(answer: string): { terms?: unknown; summary?: unknown } {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const parsed = JSON.parse(answer.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Collapses whitespace; cut at a word near `max` characters
function shorten(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

export interface ChapterMemory {
  // New names, and known ones written differently or with something new to note
  terms: GlossaryTerm[];
  summary: string;
}

const HAS_CJK = /[㐀-鿿豈-﫿]/;

// Never throws: a chapter is complete without its names, so any failure just
// yields none
export async function extractTerms({ apiKey, model, source, translation, known }: ExtractParams): Promise<ChapterMemory> {
  const sourceText = source.slice(0, MAX_SOURCE_CHARS);
  const translatedText = translation.slice(0, MAX_TRANSLATION_CHARS);
  const knownTerms = new Map(known.filter((t) => t.source).map((t) => [t.source, t]));
  const listed = [...knownTerms.values()]
    .filter((t) => sourceText.includes(t.source))
    .slice(0, MAX_KNOWN_LISTED)
    .map((t) => {
      const note = t.notes?.at(-1)?.text;
      return `${t.source}=${t.target}${note ? ` [đã ghi: ${shorten(note, KNOWN_NOTE_CHARS)}]` : ""}`;
    });
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
      if (!retry) return { terms: [], summary: "" };
    }
  }

  const parsed = parseAnswer(answer);
  const raw = Array.isArray(parsed.terms) ? parsed.terms : [];
  // A name's note comes as `note`; kept as the term's notes
  const withNotes = raw.map((item) => {
    if (!item || typeof item !== "object") return item;
    const { note, notes: _notes, ...term } = item as Record<string, unknown>;
    const text = shorten(note, MAX_NOTE_LENGTH);
    return text && !HAS_CJK.test(text) ? { ...term, notes: [{ text }] } : term;
  });
  const terms = sanitizeTerms(withNotes, 500) ?? [];
  const seen = new Set<string>();
  const found: GlossaryTerm[] = [];
  for (const term of terms) {
    // Only names really in this chapter and its translation, so a made-up or
    // misspelled one never enters the glossary. A known name comes back only
    // when written differently, to be recorded as a variant and fixed, or
    // with something new to note.
    const knownTarget = knownTerms.get(term.source)?.target;
    if (
      term.source.length < 2 ||
      (knownTarget === term.target && !term.notes) ||
      seen.has(term.source) ||
      !sourceText.includes(term.source) ||
      !translatedText.includes(term.target) ||
      HAS_CJK.test(term.target)
    ) {
      continue;
    }
    seen.add(term.source);
    const { aliases: _aliases, edited: _edited, ...clean } = term;
    found.push(clean);
    if (found.length >= MAX_NEW_TERMS) break;
  }
  const summary = shorten(parsed.summary, MAX_SUMMARY_LENGTH);
  return { terms: found, summary: HAS_CJK.test(summary) ? "" : summary };
}
