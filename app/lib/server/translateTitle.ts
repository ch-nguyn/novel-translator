import { DEFAULT_AI_MODEL, isOpenAIReasoningModel } from "../types";

function getProvider(model: string): "openai" | "gemini" | "claude" | "openrouter" {
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "claude";
  if (model.includes("/")) return "openrouter";
  return "openai";
}

const DEFAULT_PROMPT = "Dịch tiêu đề truyện sau từ tiếng Trung sang phiên âm Hán Việt. KHÔNG được để lại bất kỳ chữ Trung Quốc nào. Số chương phải viết bằng số (VD: 第二十章 → Chương 20, 第一百零三章 → Chương 103). Chỉ trả về bản dịch, không giải thích.";

// A failed title translation falls back to the original title; log why so it is not invisible
async function logFailure(provider: string, res: Response) {
  const body = await res.text().catch(() => "");
  console.error(`[translate-title] ${provider} error ${res.status}: ${body.slice(0, 300)}`);
}

// Text of a Responses API result: the output_text parts of its message items.
// Empty unless the response completed (an incomplete one holds a cut-off title).
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

async function translate(apiKey: string, model: string, title: string, prompt: string): Promise<string> {
  const provider = getProvider(model);

  // Reasoning models (GPT-5+, o-series) reject a custom temperature on Chat Completions
  if (isOpenAIReasoningModel(model)) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions: prompt,
        input: title,
        reasoning: { effort: "low" },
      }),
    });
    if (!res.ok) {
      await logFailure("OpenAI", res);
      return title;
    }
    return responsesOutputText(await res.json()).trim() || title;
  }

  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: prompt }] },
        contents: [{ parts: [{ text: title }] }],
        generationConfig: { temperature: 0.1 },
      }),
    });
    if (!res.ok) {
      await logFailure("Gemini", res);
      return title;
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || title;
  }

  if (provider === "claude") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system: prompt,
        messages: [{ role: "user", content: title }],
        temperature: 0.1,
      }),
    });
    if (!res.ok) {
      await logFailure("Claude", res);
      return title;
    }
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || title;
  }

  // OpenAI / OpenRouter (OpenAI-compatible)
  const baseUrl = provider === "openrouter"
    ? "https://openrouter.ai/api/v1"
    : "https://api.openai.com/v1";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_AI_MODEL,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: title },
      ],
      temperature: 0.1,
    }),
  });
  if (!res.ok) {
    await logFailure(provider, res);
    return title;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || title;
}

export async function translateTitle(apiKey: string, model: string | undefined, title: string, prompt?: string): Promise<string> {
  return translate(apiKey, model || DEFAULT_AI_MODEL, title, prompt || DEFAULT_PROMPT);
}

// Translate multiple titles in a single AI call
export async function translateTitleBatch(apiKey: string, model: string | undefined, titles: string[], prompt?: string): Promise<string[]> {
  const combined = titles.map((t, i) => `[${i + 1}] ${t}`).join("\n");
  const batchPrompt = (prompt || DEFAULT_PROMPT) +
    `\n\nCó ${titles.length} tiêu đề cần dịch, mỗi tiêu đề trên một dòng có đánh số [1], [2],... Trả về bản dịch theo đúng format [1] ..., [2] ..., mỗi dòng một tiêu đề.`;
  const result = await translate(apiKey, model || DEFAULT_AI_MODEL, combined, batchPrompt);
  return titles.map((_, i) => {
    const regex = new RegExp(`\\[${i + 1}\\]\\s*(.+)`);
    const match = result.match(regex);
    return match ? match[1].trim() : titles[i];
  });
}
