import { DEFAULT_AI_MODEL } from "../types";
import { auth } from "./auth";
import { isSubscribed } from "./subscription";

// Which key pays for an AI call. The app's own AI Router key comes first, for
// signed-in users on the monthly plan or let in by SYSTEM_KEY_ALLOWED_EMAILS
// (comma-separated); everyone else uses the key they entered in Settings.
// The router key never leaves the server.

// The only model run on the app's key
export const SYSTEM_AI_MODEL = "gpt-5.6-luna";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function routerKey(): string {
  return process.env.AI_ROUTER_API_KEY?.trim() ?? "";
}

function routerBaseUrl(): string {
  return process.env.AI_ROUTER_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
}

export function systemApiKey(): string {
  return routerBaseUrl() ? routerKey() : "";
}

// Where OpenAI-style calls made with `apiKey` go: the router for its key
export function openAIBaseUrl(apiKey: string): string {
  const key = systemApiKey();
  return key && apiKey === key ? routerBaseUrl() : OPENAI_BASE_URL;
}

// `text` (a provider's error, shown to users and logged) without the app's key,
// in case the router echoes it back
export function redactSystemKey(text: string): string {
  const key = routerKey();
  return key ? text.split(key).join("[redacted]") : text;
}

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.SYSTEM_KEY_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

// The request comes from a signed-in user the app's key is open to
export async function canUseSystemAI(headers: Headers): Promise<boolean> {
  if (!systemApiKey()) return false;
  const session = await auth.api.getSession({ headers }).catch(() => null);
  if (!session) return false;
  if (session.user.emailVerified && allowedEmails().has(session.user.email.toLowerCase())) return true;
  return isSubscribed(session.user.id).catch(() => false);
}

export interface AiAccess {
  apiKey: string;
  model: string;
  // Paid by the app (the router key and SYSTEM_AI_MODEL)
  system: boolean;
}

// The key and model for a request carrying the user's `apiKey` and `model`;
// null when there is neither the app's key nor the user's
export async function resolveAiAccess(req: Request, apiKey: unknown, model: unknown): Promise<AiAccess | null> {
  if (await canUseSystemAI(req.headers)) return { apiKey: systemApiKey(), model: SYSTEM_AI_MODEL, system: true };
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) return null;
  return { apiKey: key, model: typeof model === "string" && model ? model : DEFAULT_AI_MODEL, system: false };
}
