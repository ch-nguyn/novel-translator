import { CodedError, codeOfMessage, ErrorCode } from "../errors";

// An error a route answers with `status`, `code` telling the reader what to do
// (see app/lib/errors.ts)
export class ApiError extends CodedError {
  constructor(code: ErrorCode, message: string, public status: number) {
    super(code, message);
  }
}

// The answer for a failed request
export function errorResponse(code: ErrorCode, message: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error: message, code }, { status, headers });
}

// The answer for `e`, thrown while handling a request; `status` when it does not carry one
export function responseFor(e: unknown, status = 500): Response {
  if (e instanceof ApiError) return errorResponse(e.code, e.message, e.status);
  const message = e instanceof Error ? e.message : "Internal server error";
  return errorResponse(codeOf(e), message, status);
}

export function codeOf(e: unknown): ErrorCode {
  if (e instanceof CodedError) return e.code;
  return codeOfMessage(e instanceof Error ? e.message : "");
}

// What a refusal from the reader's own AI provider means for them
export function providerErrorCode(status: number, message: string): ErrorCode {
  if (status === 401 || status === 403) return "invalidKey";
  // Gemini answers a wrong key with 400 "API key not valid"
  if (status === 400 && /api[ _-]?key/i.test(message)) return "invalidKey";
  if (status === 402 || status === 429) return "keyQuota";
  return "aiFailed";
}
