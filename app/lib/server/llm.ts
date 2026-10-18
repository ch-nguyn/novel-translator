import { isOpenAIReasoningModel } from "../types";

// One-shot (non-streaming) model calls for short tasks: title translation,
// listing a chapter's names. Chapters themselves stream (see simplify.ts).

export function getProvider(model: string): "openai" | "gemini" | "claude" | "openrouter" {
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "claude";
  if (model.includes("/")) return "openrouter";
  return "openai";
}

export class ModelCallError extends Error {
  status: number;

  constructor(provider: string, status: number) {
    super(`${provider} error ${status}`);
    this.name = "ModelCallError";
    this.status = status;
  }
}

interface CompleteParams {
  apiKey: string;
  model: string;
  system: string;
  input: string;
  // Upper bound on the answer (Claude requires one)
  maxTokens: number;
  // What the call is for, in error logs
  task: string;
  // OpenAI reasoning models: "none" for quick lookups that need no thinking
  reasoningEffort?: "none" | "low";
}

// The failed call is otherwise invisible to the user; log why
async function fail(task: string, provider: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  console.error(`[${task}] ${provider} error ${res.status}: ${body.slice(0, 300)}`);
  throw new ModelCallError(provider, res.status);
}

// Text of a Responses API result: the output_text parts of its message items.
// Empty unless the response completed (an incomplete one holds a cut-off answer).
function responsesOutputText(data: {
  status?: string;
  output?: { type: string; content?: { type: string; text?: string }[] }[];
}): string {
  if (data.status !== "completed") return "";
  return (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
}

// The model's answer, trimmed; empty if it gave none. Throws ModelCallError
// when the provider rejects the request.
export async function complete({ apiKey, model, system, input, maxTokens, task, reasoningEffort = "low" }: CompleteParams): Promise<string> {
  const provider = getProvider(model);

  // Reasoning models (GPT-5+, o-series) reject a custom temperature on Chat Completions
  if (isOpenAIReasoningModel(model)) {
    const call = (effort: string) =>
      fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, instructions: system, input, reasoning: { effort } }),
      });
    let res = await call(reasoningEffort);
    // Models that must reason a little reject "none"
    if (res.status === 400 && reasoningEffort === "none") {
      console.error(`[${task}] ${model} rejected reasoning effort "none": ${(await res.text().catch(() => "")).slice(0, 200)}`);
      res = await call("low");
    }
    if (!res.ok) return fail(task, "OpenAI", res);
    return responsesOutputText(await res.json()).trim();
  }

  if (provider === "gemini") {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: input }] }],
        generationConfig: { temperature: 0.1 },
      }),
    });
    if (!res.ok) return fail(task, "Gemini", res);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  }

  if (provider === "claude") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: input }],
        temperature: 0.1,
      }),
    });
    if (!res.ok) return fail(task, "Claude", res);
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || "";
  }

  // OpenAI / OpenRouter (OpenAI-compatible)
  const baseUrl = provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
      temperature: 0.1,
    }),
  });
  if (!res.ok) return fail(task, provider, res);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}
