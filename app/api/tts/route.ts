import { AI_VOICES } from "../../lib/types";

// A piece of a chapter read aloud by OpenAI (see app/lib/useSpeech.ts)

const MAX_TEXT_CHARS = 4000;
const INSTRUCTIONS =
  "Read this passage of a Vietnamese novel aloud in natural, fluent Vietnamese, like an audiobook narrator: clear, expressive, at a steady pace. Pronounce Sino-Vietnamese names naturally.";

export async function POST(req: Request) {
  let body: { apiKey?: unknown; text?: unknown; voice?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid request" }, { status: 400 });
  const { apiKey, text, voice } = body;
  if (typeof apiKey !== "string" || !apiKey.trim()) return Response.json({ error: "Missing API key" }, { status: 400 });
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_CHARS) {
    return Response.json({ error: "Invalid text" }, { status: 400 });
  }
  if (typeof voice !== "string" || !AI_VOICES.includes(voice)) return Response.json({ error: "Invalid voice" }, { status: 400 });

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, instructions: INSTRUCTIONS, response_format: "mp3" }),
      signal: req.signal,
    });
  } catch {
    return Response.json({ error: "OpenAI unreachable" }, { status: 502 });
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error(`[tts] OpenAI error ${res.status}: ${detail.slice(0, 300)}`);
    // The client tells a wrong key and a rate limit apart from other failures
    const status = res.status === 401 || res.status === 429 ? res.status : 502;
    return Response.json({ error: `OpenAI error ${res.status}` }, { status });
  }
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
