import { DEFAULT_AI_MODEL } from "../../lib/types";

function getProvider(model: string): "openai" | "gemini" | "claude" | "openrouter" {
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "claude";
  if (model.includes("/")) return "openrouter";
  return "openai";
}

const DEFAULT_PROMPT = "Dịch tiêu đề truyện sau từ tiếng Trung sang phiên âm Hán Việt. KHÔNG được để lại bất kỳ chữ Trung Quốc nào. Số chương phải viết bằng số (VD: 第二十章 → Chương 20, 第一百零三章 → Chương 103). Chỉ trả về bản dịch, không giải thích.";

async function translate(apiKey: string, model: string, title: string, prompt: string): Promise<string> {
  const provider = getProvider(model);

  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: prompt }] },
        contents: [{ parts: [{ text: title }] }],
        generationConfig: { temperature: 0.1 },
      }),
    });
    if (!res.ok) return title;
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
    if (!res.ok) return title;
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
  if (!res.ok) return title;
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || title;
}

export async function POST(req: Request) {
  try {
    const { title, titles, apiKey, model, prompt } = await req.json();

    // Batch mode: translate multiple titles in a single AI call
    if (titles && Array.isArray(titles) && titles.length > 0 && apiKey) {
      const combined = titles.map((t: string, i: number) => `[${i + 1}] ${t}`).join("\n");
      const batchPrompt = (prompt || DEFAULT_PROMPT) +
        `\n\nCó ${titles.length} tiêu đề cần dịch, mỗi tiêu đề trên một dòng có đánh số [1], [2],... Trả về bản dịch theo đúng format [1] ..., [2] ..., mỗi dòng một tiêu đề.`;
      const result = await translate(apiKey, model || DEFAULT_AI_MODEL, combined, batchPrompt);
      const translated = titles.map((_: string, i: number) => {
        const regex = new RegExp(`\\[${i + 1}\\]\\s*(.+)`);
        const match = result.match(regex);
        return match ? match[1].trim() : titles[i];
      });
      return Response.json({ translated });
    }

    // Single mode (backward compatible)
    if (!title || !apiKey) {
      return Response.json({ translated: title }, { status: 200 });
    }

    const translated = await translate(apiKey, model || DEFAULT_AI_MODEL, title, prompt || DEFAULT_PROMPT);
    return Response.json({ translated });
  } catch {
    return Response.json({ translated: "" }, { status: 200 });
  }
}
