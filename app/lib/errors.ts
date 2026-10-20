import { AI_UNAVAILABLE_ERROR } from "./plan";
import { STREAM_ENDED_EARLY_ERROR } from "./stream";
import type { Translations } from "./i18n";

// What went wrong, so the reader is told in their language what to do. The
// API sends it as `code` beside an English `error` (kept for the logs and as
// the details of an error a code does not explain).
export const ERROR_CODES = [
  // The link is not of a supported site
  "unsupportedSite",
  // The page has no chapter text (or no first chapter)
  "noContent",
  // The novel's site failed or could not be reached
  "siteFailed",
  // The novel's site, or the app's server, took too long
  "slow",
  // Too many requests from the reader's network
  "rateLimited",
  // The app is busy (or a service it needs is down): try again in a moment
  "busy",
  "needKey",
  // The reader's AI key was refused
  "invalidKey",
  // The reader's AI account is out of quota (or asked too fast)
  "keyQuota",
  // The app's AI is having trouble
  "aiUnavailable",
  // The reader's AI provider failed some other way (details shown)
  "aiFailed",
  // The model stopped before finishing the chapter
  "aiStopped",
  // ... because the chapter is longer than its answers may be
  "aiOutputLimit",
  // The model would not translate the chapter
  "aiRefused",
  // Every chapter the plan translates at once is taken
  "planBusy",
  // The plan could not be checked right now
  "planCheck",
  // A background translation stopped
  "jobStopped",
  // The chapter was saved on this device and has since been removed
  "chapterGone",
  // The device is offline or lost the connection
  "network",
  "unknown",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

export class CodedError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = "CodedError";
  }
}

// The code of an answer with no (known) code of its own, by its status
export function codeForStatus(status: number): ErrorCode {
  if (status === 429) return "rateLimited";
  if (status === 503) return "busy";
  if (status === 504) return "slow";
  return "unknown";
}

// The error of a failed API answer
export async function readError(res: Response, fallback: string): Promise<CodedError> {
  const body = await res.json().catch(() => null);
  const code = isErrorCode(body?.code) ? body.code : codeForStatus(res.status);
  const message = typeof body?.error === "string" && body.error ? body.error : `${fallback} (HTTP ${res.status})`;
  return new CodedError(code, message);
}

// `e`'s code, and its English message as the details
export function describeError(e: unknown): { code: ErrorCode; message: string } {
  if (e instanceof CodedError) return { code: e.code, message: e.message };
  const message = e instanceof Error ? e.message : String(e);
  // fetch() failing to reach the server: Chrome, Safari, Firefox
  if (e instanceof TypeError && /fetch|load failed|network/i.test(message)) return { code: "network", message };
  return { code: codeOfMessage(message), message };
}

// What a message without a code is: the AI's ways of failing (app/lib/server/simplify.ts)
export function codeOfMessage(message: string): ErrorCode {
  if (message === AI_UNAVAILABLE_ERROR) return "aiUnavailable";
  if (message.startsWith("The model hit its output limit")) return "aiOutputLimit";
  if (message.startsWith("The model refused")) return "aiRefused";
  if (message === STREAM_ENDED_EARLY_ERROR || message.startsWith("The model ")) return "aiStopped";
  return "unknown";
}

const TEXT: Record<ErrorCode, keyof Translations> = {
  unsupportedSite: "errUnsupportedSite",
  noContent: "errNoContent",
  siteFailed: "errSiteFailed",
  slow: "errSlow",
  rateLimited: "errRateLimited",
  busy: "errBusy",
  needKey: "needApiKey",
  invalidKey: "errInvalidKey",
  keyQuota: "errKeyQuota",
  aiUnavailable: "aiUnavailable",
  aiFailed: "errAiFailed",
  aiStopped: "errAiStopped",
  aiOutputLimit: "errAiOutputLimit",
  aiRefused: "errAiRefused",
  planBusy: "errPlanBusy",
  planCheck: "errPlanCheck",
  jobStopped: "errJobStopped",
  chapterGone: "errChapterGone",
  network: "errNetwork",
  unknown: "errUnknown",
};

// What the reader is told
export function errorText(t: Translations, code: ErrorCode): string {
  return t[TEXT[code]];
}

// Errors whose English details help the reader (their own AI provider's
// message), or the owner when the reader sends a screenshot
export function showsDetails(code: ErrorCode): boolean {
  return code === "aiFailed" || code === "unknown";
}
