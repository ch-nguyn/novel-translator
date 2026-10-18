// Reading a chapter aloud: the text cut into the pieces spoken one at a time.
// Pure functions (no browser APIs), shared with the tests.

// A piece of the chapter spoken in one go, and the line (paragraph) of the
// chapter text it comes from, which is highlighted while it is read
export interface SpeechSegment {
  paragraph: number;
  text: string;
}

// Device voices: Chrome stops some voices mid-sentence on long utterances, so
// they get short pieces. AI voices: longer pieces cost fewer requests (OpenAI
// takes up to 4096 characters).
export const DEVICE_SEGMENT_CHARS = 220;
export const AI_SEGMENT_CHARS = 1500;

// Decorations that are not read ("***", "【】", "====")
const NOT_SPOKEN = /[*#_=~<>[\]{}|\\^`【】〖〗「」『』《》]+/g;

// A line as it should be spoken; null if there is nothing to say
export function speakableText(line: string): string | null {
  const text = line.replace(NOT_SPOKEN, " ").replace(/\s+/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : null;
}

// Splits a long paragraph at sentence ends (or else commas, then spaces) into
// pieces of at most `max` characters
export function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?…。！？]+(?:[.!?…。！？]+["”'’)\]]*|$)\s*/gu) ?? [text];
  const pieces: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };
  for (const sentence of sentences) {
    if (current.length + sentence.length <= max) {
      current += sentence;
      continue;
    }
    push();
    if (sentence.length <= max) {
      current = sentence;
      continue;
    }
    // A sentence longer than a piece: cut at commas, then at spaces
    for (const part of sentence.match(/[^,;，；、]+[,;，；、]?\s*/gu) ?? [sentence]) {
      if (current.length + part.length > max) push();
      if (part.length <= max) {
        current += part;
        continue;
      }
      for (const word of part.split(/(?<=\s)/)) {
        if (current.length + word.length > max) push();
        // A "word" longer than a piece (text without spaces): cut it anywhere
        for (let at = 0; at < word.length; at += max) {
          const chunk = word.slice(at, at + max);
          if (current.length + chunk.length > max) push();
          current += chunk;
        }
      }
    }
  }
  push();
  return pieces;
}

// The chapter's pieces in reading order. While it is still being translated
// (`complete` false), its last line may be cut off and is left for later.
export function speechSegments(text: string, max: number, complete = true): SpeechSegment[] {
  const lines = text.split("\n");
  if (!complete) lines.pop();
  const segments: SpeechSegment[] = [];
  lines.forEach((line, paragraph) => {
    const speakable = speakableText(line);
    if (!speakable) return;
    for (const piece of splitText(speakable, max)) segments.push({ paragraph, text: piece });
  });
  return segments;
}

// The first piece of `paragraph`, or of the first spoken line after it
export function segmentAt(segments: SpeechSegment[], paragraph: number): number {
  const index = segments.findIndex((s) => s.paragraph >= paragraph);
  return index < 0 ? segments.length : index;
}

// A place in the chapter that survives a change of its pieces (another
// voice's piece length, a name rewritten): the paragraph and the piece in it.
// Past the end of what can be read, it is the next paragraph to come.
export interface SpeechCursor {
  paragraph: number;
  piece: number;
}

export function cursorAt(segments: SpeechSegment[], index: number): SpeechCursor {
  const segment = segments[index];
  if (!segment) return { paragraph: (segments[segments.length - 1]?.paragraph ?? -1) + 1, piece: 0 };
  return { paragraph: segment.paragraph, piece: index - segmentAt(segments, segment.paragraph) };
}

export function indexAt(segments: SpeechSegment[], cursor: SpeechCursor): number {
  const first = segmentAt(segments, cursor.paragraph);
  if (segments[first]?.paragraph !== cursor.paragraph) return first;
  let index = first;
  while (index - first < cursor.piece && segments[index + 1]?.paragraph === cursor.paragraph) index++;
  return index;
}

// "m:ss"
export function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
