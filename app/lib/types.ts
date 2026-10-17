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

export const DEFAULT_AI_MODEL = "gpt-5.6-luna";

export const AI_MODEL_OPTIONS: AIModelOption[] = [
  {
    provider: "openai",
    label: "OpenAI",
    models: [
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.6-luna",
      "gpt-5.6-sol",
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
  referenceLinks: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
}

export function getProviderForModel(model: string): AIProvider {
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "claude";
  // OpenRouter models have org/model:free format
  if (model.includes("/")) return "openrouter";
  return "openai";
}

export function isChatGPTModel(model: string): boolean {
  return getProviderForModel(model) === "openai" && model.startsWith("gpt-5");
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
}

export interface TranslateOptions {
  apiKey: string;
  model: string;
  customPrompt?: string;
  referenceLinks?: string;
  reasoningEffort?: string;
  webSearch?: boolean;
}

export type ChapterJobStatus = "fetching" | "translating" | "done" | "error";

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
    referenceLinks: settings.referenceLinks,
    reasoningEffort: settings.reasoningEffort,
    webSearch: isChatGPTModel(settings.aiModel) ? settings.webSearch : false,
  };
}
