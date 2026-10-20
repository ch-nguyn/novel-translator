import { DEFAULT_AI_MODEL } from "../types";
import { AI_UNAVAILABLE_ERROR } from "../plan";
import { auth } from "./auth";
import { isSubscribed } from "./subscription";
import { ApiError } from "./apiError";

// Which key pays for an AI call. The app's own AI Router key comes first, for
// signed-in users on the monthly plan; everyone else uses the key they
// entered in Settings.
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

// `text` without `apiKey` (a provider may quote the key it refused)
export function redactKey(text: string, apiKey: string): string {
  const shown = redactSystemKey(text);
  return apiKey.length >= 8 ? shown.split(apiKey).join("[redacted]") : shown;
}

// The error a user is shown for a failed AI call: on the app's key, a generic
// one (the details go to the logs)
export function publicAiError(apiKey: string, message: string): string {
  if (!apiKey || apiKey !== systemApiKey()) return redactKey(message, apiKey);
  console.error(`[ai] ${redactSystemKey(message).slice(0, 300)}`);
  return AI_UNAVAILABLE_ERROR;
}

// The database could not say whether the user has the plan. Not the same as
// not having it: a subscriber is neither asked for a key nor charged on theirs.
export class PlanCheckError extends ApiError {
  constructor() {
    super("planCheck", "Could not check your plan right now. Please try again in a few minutes.", 503);
  }
}

// The request carries a sign-in (its session may still turn out expired)
function hasSessionCookie(headers: Headers): boolean {
  return /(^|;\s*)(__Secure-)?better-auth\.session_token=/.test(headers.get("cookie") ?? "");
}

// The signed-in user the request comes from, when the app's key is open to
// them. Throws PlanCheckError when the database fails for a signed-in user.
async function systemAIUser(headers: Headers): Promise<string | null> {
  if (!systemApiKey()) return null;
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers });
  } catch (e) {
    if (!hasSessionCookie(headers)) return null;
    console.error(`[plan] session check failed: ${e instanceof Error ? e.message : e}`);
    throw new PlanCheckError();
  }
  if (!session) return null;
  try {
    return (await isSubscribed(session.user.id)) ? session.user.id : null;
  } catch (e) {
    console.error(`[plan] subscription check failed: ${e instanceof Error ? e.message : e}`);
    throw new PlanCheckError();
  }
}

// The request comes from a signed-in user the app's key is open to. Throws
// PlanCheckError when that cannot be told.
export async function canUseSystemAI(headers: Headers): Promise<boolean> {
  return (await systemAIUser(headers)) !== null;
}

export interface AiAccess {
  apiKey: string;
  model: string;
  // Paid by the app (the router key and SYSTEM_AI_MODEL)
  system: boolean;
  // Who it is paid for, when `system`
  userId?: string;
}

// The key and model for a request carrying the user's `apiKey` and `model`;
// null when there is neither the app's key nor the user's. Throws
// PlanCheckError when whether the user has the plan cannot be told.
export async function resolveAiAccess(req: Request, apiKey: unknown, model: unknown): Promise<AiAccess | null> {
  const userId = await systemAIUser(req.headers);
  if (userId) return { apiKey: systemApiKey(), model: SYSTEM_AI_MODEL, system: true, userId };
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) return null;
  return { apiKey: key, model: typeof model === "string" && model ? model : DEFAULT_AI_MODEL, system: false };
}
