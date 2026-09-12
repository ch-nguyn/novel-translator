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
