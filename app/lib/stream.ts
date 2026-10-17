// A translation stream is the translated text followed by exactly one terminal
// record on its own final line:
//   <!--END:<nonce>:{"usage":{"input":1,"output":2},"error":null}-->
// `error` is a message when the model stopped before finishing the chapter.
// `nonce` is random per stream and sent separately (the X-Stream-Nonce header),
// so model output — even one that copies this format — can never pass for the
// record. The record is only looked for on the last line, and a stream that
// ends without it (cut off anywhere) counts as unfinished.
// Shared by the API routes, the background job runner and the browser.

export interface TokenUsage {
  input: number;
  output: number;
}

export const STREAM_NONCE_HEADER = "X-Stream-Nonce";
export const STREAM_ENDED_EARLY_ERROR = "The translation stream ended before the model finished. Please try again.";

const END_PREFIX = "\n<!--END:";
const END_SUFFIX = "-->";

export function newStreamNonce(): string {
  return crypto.randomUUID();
}

export function endRecord(nonce: string, usage: TokenUsage, error: string | null): string {
  // JSON.stringify never emits a raw newline, so the record stays on one line
  return `${END_PREFIX}${nonce}:${JSON.stringify({ usage, error })}${END_SUFFIX}`;
}

export interface ParsedTranslation {
  text: string;
  usage: TokenUsage | null;
  // Set when the stream is not a complete, successful translation
  error: string | null;
}

function isTokenUsage(value: unknown): value is TokenUsage {
  const u = value as TokenUsage;
  return !!u && typeof u === "object" && Number.isFinite(u.input) && Number.isFinite(u.output);
}

// Parses a (possibly still arriving) stream. While streaming, `text` is what
// can be shown so far and `error` is STREAM_ENDED_EARLY_ERROR because the
// terminal record has not arrived yet; callers only act on `error` at the end.
// Only the last line is examined, so calling this per chunk stays cheap.
export function parseTranslationStream(raw: string, nonce: string): ParsedTranslation {
  const lastLine = raw.lastIndexOf("\n");
  const tail = lastLine >= 0 ? raw.slice(lastLine) : "";
  const prefix = `${END_PREFIX}${nonce}:`;

  if (nonce && tail.startsWith(prefix) && tail.endsWith(END_SUFFIX)) {
    try {
      const record = JSON.parse(tail.slice(prefix.length, tail.length - END_SUFFIX.length));
      const errorValid = record?.error === null || typeof record?.error === "string";
      if (record && typeof record === "object" && isTokenUsage(record.usage) && errorValid) {
        return { text: raw.slice(0, lastLine), usage: record.usage, error: record.error };
      }
    } catch {
      // not a valid record; fall through
    }
  }

  // Hide the first bytes of a terminal record that has started arriving
  const hidden = END_PREFIX.startsWith(tail) || tail.startsWith(END_PREFIX);
  return { text: hidden && lastLine >= 0 ? raw.slice(0, lastLine) : raw, usage: null, error: STREAM_ENDED_EARLY_ERROR };
}
