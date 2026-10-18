export interface SavedChapter {
  url: string;
  title: string;
  novelName: string;
  novelSlug: string;
  simplifiedText: string;
  prevUrl: string | null;
  nextUrl: string | null;
  savedAt: number;
}

export type AIProvider = "openai" | "gemini" | "claude" | "openrouter";

export interface AIModelOption {
  provider: AIProvider;
  label: string;
  models: string[];
}

export const DEFAULT_AI_MODEL = "gpt-6-luna";

export const AI_MODEL_OPTIONS: AIModelOption[] = [
  {
    provider: "openai",
    label: "OpenAI",
    models: [
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-6-luna",
      "gpt-6.1-sol",
    ],
  },
];

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

export interface ReaderSettings {
  bgColor: string;
  fontSize: number;
  lineSpacing: number;
  openaiApiKey: string;
  geminiApiKey: string;
  claudeApiKey: string;
  openrouterApiKey: string;
  aiModel: string;
  customPrompt: string;
  appLang: "en" | "vi";
  autoClearNovels: boolean;
  reasoningEffort: ReasoningEffort;
  // Remember the novel's names and translate them the same way in every chapter
  autoGlossary: boolean;
  // Reading aloud: the device's own voices, or OpenAI's (with the OpenAI key)
  speechEngine: SpeechEngine;
  // voiceURI of the device voice; empty for its first Vietnamese one
  speechVoice: string;
  speechAiVoice: string;
  speechRate: number;
}

export type SpeechEngine = "device" | "ai";

// OpenAI's voices (gpt-4o-mini-tts), best first
export const AI_VOICES = ["marin", "cedar", "coral", "nova", "shimmer", "sage", "alloy", "ash", "ballad", "echo", "fable", "onyx", "verse"];
export const DEFAULT_AI_VOICE = "marin";
export const SPEECH_RATES = [0.8, 1, 1.2, 1.4, 1.6, 1.8, 2];

export function getProviderForModel(model: string): AIProvider {
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "claude";
  // OpenRouter models have org/model:free format
  if (model.includes("/")) return "openrouter";
  return "openai";
}

// OpenAI reasoning models (GPT-5 and later, o-series). They go through the
// Responses API, support reasoning effort, and reject any
// temperature other than the default.
export function isOpenAIReasoningModel(model: string): boolean {
  if (getProviderForModel(model) !== "openai") return false;
  // Fine-tuned models ("ft:gpt-5…:org::id") behave like their base model
  const base = model.replace(/^ft:/, "");
  const gpt = base.match(/^gpt-(\d+)/);
  if (gpt) return parseInt(gpt[1], 10) >= 5;
  return /^o\d/.test(base);
}

export function getApiKeyForModel(settings: ReaderSettings): string {
  const provider = getProviderForModel(settings.aiModel);
  switch (provider) {
    case "gemini": return settings.geminiApiKey;
    case "claude": return settings.claudeApiKey;
    case "openrouter": return settings.openrouterApiKey;
    default: return settings.openaiApiKey;
  }
}

export const BG_OPTIONS = [
  { bg: "#ffffff", text: "#1a1a1a", label: "White" },
  { bg: "#f5f5dc", text: "#3b3024", label: "Sepia" },
  { bg: "#d4edda", text: "#1b3a26", label: "Green" },
  { bg: "#1a1a2e", text: "#d4d4d4", label: "Dark" },
  { bg: "#0d0d0d", text: "#cccccc", label: "Black" },
];

export function getTextColor(bgColor: string): string {
  return BG_OPTIONS.find((o) => o.bg === bgColor)?.text ?? "#1a1a1a";
}

// Chapters translated ahead in the background, on top of the one being opened
export const PREFETCH_CHAPTERS = 3;

export const ZH_TITLE_PROMPT = "Dịch tiêu đề truyện sau từ tiếng Trung sang tiếng Việt (ưu tiên Hán Việt) phổ thông dễ hiểu. KHÔNG được để lại bất kỳ chữ Trung Quốc nào. Giữ nguyên dấu '-' phân cách giữa tên truyện và tên chương. Chỉ trả về bản dịch, không giải thích.";

export interface TranslatedChapter {
  text: string;
  title: string;
  novelName: string;
  chapterName: string;
  prevUrl: string | null;
  nextUrl: string | null;
  // Names found in this chapter that the novel's glossary did not have yet
  newTerms?: GlossaryTerm[];
}

export type TermKind = "character" | "place" | "organization" | "skill" | "item" | "other";
export const TERM_KINDS: TermKind[] = ["character", "place", "organization", "skill", "item", "other"];

// A name in a novel's glossary, translated the same way in every chapter
export interface GlossaryTerm {
  // As written in the original text; empty for a name the user corrected
  // that was never listed (it can then only be fixed in saved chapters)
  source: string;
  // As written in the translation
  target: string;
  kind: TermKind;
  gender?: "male" | "female";
  // Other ways translations wrote it; replaced by `target` when a chapter is saved
  aliases?: string[];
  // The chapter it was found in
  firstSeen?: string;
  // Set or corrected by the user, so never changed by a translation
  edited?: boolean;
}

export interface TranslateOptions {
  apiKey: string;
  model: string;
  customPrompt?: string;
  reasoningEffort?: string;
  // Off: no glossary in the prompt and no names extracted
  useGlossary?: boolean;
}

// "saved": the device already saved it; only a receipt (with nextUrl) is kept
export type ChapterJobStatus = "fetching" | "translating" | "done" | "error" | "saved";

// A chapter being (or already) translated by a server-side background job
export interface ChapterJob extends TranslatedChapter {
  url: string;
  jobId: string;
  status: ChapterJobStatus;
  lang: string;
  error?: string;
  updatedAt: number;
}

export function getTranslateOptions(settings: ReaderSettings): TranslateOptions {
  return {
    apiKey: getApiKeyForModel(settings),
    model: settings.aiModel,
    customPrompt: settings.customPrompt,
    reasoningEffort: settings.reasoningEffort,
    useGlossary: settings.autoGlossary,
  };
}
