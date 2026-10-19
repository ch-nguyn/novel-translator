import { DEFAULT_AI_MODEL } from "../types";
import { SYSTEM_AI_MODEL, systemApiKey } from "./aiAccess";
import { allow, clientIp } from "./rateLimit";

// The AI for the small helpers every reader gets, signed in or not, with a
// key or without: finding a novel by its Vietnamese name, naming the search
// results, translating a table of contents' and a chapter's titles. Runs on
// the app's key (the reader's own one is for translating chapters); the
// reader's key only where the app has none (local setups).

// Questions to the AI one address may cause a day (answers already cached
// cost nothing). A search asks several (its guess, then a few for each site's
// novels), a table of contents one per 25 titles: far more than a few readers
// on one network need. It only stops someone using the app's AI for something else.
const CALLS_PER_DAY = 3000;

export interface HelperAi {
  apiKey: string;
  model: string;
  // On the app's key
  system: boolean;
  // Counts one question to the AI; false once the address asked too many today
  allowCall: () => Promise<boolean>;
}

// null when there is neither the app's key nor the reader's `apiKey`
export function helperAi(req: Request, apiKey: unknown, model?: unknown): HelperAi | null {
  const system = systemApiKey();
  if (system) {
    const ip = clientIp(req);
    return { apiKey: system, model: SYSTEM_AI_MODEL, system: true, allowCall: () => allow("helper-ai", ip, CALLS_PER_DAY, 24 * 3600) };
  }
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) return null;
  return { apiKey: key, model: typeof model === "string" && model ? model : DEFAULT_AI_MODEL, system: false, allowCall: async () => true };
}
