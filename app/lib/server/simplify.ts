import { DEFAULT_AI_MODEL, GlossaryTerm, isOpenAIReasoningModel } from "../types";
import { glossaryPrompt } from "../glossary";
import { endRecord, newStreamNonce, STREAM_ENDED_EARLY_ERROR, TokenUsage } from "../stream";

const VI_PROMPT = `Bạn là biên tập viên chuyên viết lại truyện tiên hiệp/kiếm hiệp tiếng Việt (dịch từ tiếng Trung). Văn gốc thường lủng củng, ngữ pháp sai, từ ngữ khó hiểu. Nhiệm vụ của bạn là viết lại cho mượt mà, đúng văn phong cổ phong nhưng vẫn dễ đọc.

Quy tắc BẮT BUỘC:

NỘI DUNG:
- Giữ nguyên TOÀN BỘ nội dung, cốt truyện, hội thoại - KHÔNG được cắt bỏ hay thêm bất kỳ chi tiết nào
- Giữ nguyên tên riêng nhân vật và địa danh
- Những từ chửi bậy cứ viết thoải mái sao cho đúng ngữ cảnh nhất có thể

VĂN PHONG:
- Sử dụng ngôn ngữ trang trọng, cổ phong, mang âm hưởng kiếm hiệp/tiên hiệp. Tránh dùng từ ngữ hiện đại hoặc quá bình dân
- Câu văn cần có nhịp điệu, mượt mà, dịch thoát ý - không được dịch word-by-word kiểu máy móc
- Viết câu đúng ngữ pháp tiếng Việt, rõ ràng dễ hiểu

ĐẠI TỪ NHÂN XƯNG (quan trọng):
- KHÔNG dùng "Tôi - Bạn" hay "Anh - Em" trừ bối cảnh hiện đại đặc biệt
- Xưng hô phải linh hoạt theo vai vế và địa vị: Ta - Ngươi (ngang hàng), Lão phu - Tiểu hữu (bậc trên - dưới), Bản tọa - Các ngươi (chưởng môn), Sư tôn - Đệ tử, Phụ thân/Cha - Con
- Cha nói với con: xưng "Ta" gọi "con". Con nói với cha: xưng "Con" gọi "cha/phụ thân"
- Đồng môn/giang hồ: dùng huynh, đệ, muội, tỷ
- Chúng tôi -> Bọn ta / Chúng ta
- Ngôi thứ 3 kể chuyện: Anh ấy -> Hắn, Cô ấy -> Nàng/Bà (tùy ngữ cảnh)

THUẬT NGỮ:
- Ưu tiên từ Hán Việt cho danh từ riêng, chiêu thức, pháp bảo, địa danh, thuật ngữ tu luyện (VD: "Trúc Cơ", "Kim Đan", "Phi Kiếm", "Tông môn")
- Giữ nguyên cấp bậc tu luyện chuẩn: Luyện Khí, Trúc Cơ, Kết Đan, Nguyên Anh, Hóa Thần, Luyện Hư, Hợp Thể, Đại Thừa, Độ Kiếp
- Nhất quán: một thuật ngữ/tên phải dịch giống nhau xuyên suốt (không đổi qua lại giữa các cách dịch khác nhau)

HỘI THOẠI:
- Lời thoại đặt trong dấu ngoặc kép "..."
- Mỗi lượt thoại của nhân vật khác nhau xuống dòng mới

- Chỉ trả về văn bản đã viết lại, không giải thích gì thêm`;

const ZH_PROMPT = `Bạn là dịch giả chuyên nghiệp, chuyên dịch truyện tiên hiệp/kiếm hiệp từ tiếng Trung sang tiếng Việt theo văn phong cổ phong.

Quy tắc BẮT BUỘC:

NỘI DUNG (quan trọng):
- Dịch TOÀN BỘ nội dung - KHÔNG được cắt bỏ hay thêm bất kỳ chi tiết nào
- KHÔNG được để lại bất kỳ chữ Trung Quốc (汉字) nào. Tất cả phải được dịch hoặc phiên âm Hán Việt
- Tên riêng nhân vật và địa danh: phiên âm Hán Việt
- Những từ chửi bậy cứ dịch thoải mái sao cho đúng ngữ cảnh nhất có thể

VĂN PHONG:
- Sử dụng ngôn ngữ trang trọng, cổ phong, mang âm hưởng kiếm hiệp/tiên hiệp. Tránh dùng từ ngữ hiện đại hoặc quá bình dân
- Câu văn cần có nhịp điệu, mượt mà, dịch thoát ý - không được dịch word-by-word kiểu máy móc
- Viết câu đúng ngữ pháp tiếng Việt, rõ ràng dễ hiểu

ĐẠI TỪ NHÂN XƯNG (quan trọng):
- KHÔNG dùng "Tôi - Bạn" hay "Anh - Em" trừ bối cảnh hiện đại đặc biệt
- Xưng hô phải linh hoạt theo vai vế và địa vị: Ta - Ngươi (ngang hàng), Lão phu - Tiểu hữu (bậc trên - dưới), Bản tọa - Các ngươi (chưởng môn), Sư tôn - Đệ tử, Phụ thân/Cha - Con
- Đồng môn/giang hồ: dùng huynh, đệ, muội, tỷ
- Chúng tôi -> Bọn ta / Chúng ta
- Ngôi thứ 3 kể chuyện: Anh ấy -> Hắn, Cô ấy -> Nàng/Bà (tùy ngữ cảnh)

THUẬT NGỮ:
- Ưu tiên từ Hán Việt cho danh từ riêng, chiêu thức, pháp bảo, địa danh, thuật ngữ tu luyện (VD: "Trúc Cơ", "Kim Đan", "Phi Kiếm", "Tông môn")
- Giữ nguyên cấp bậc tu luyện chuẩn: Luyện Khí, Trúc Cơ, Kết Đan, Nguyên Anh,...
- Nhất quán: một thuật ngữ/tên phải dịch giống nhau xuyên suốt (không đổi qua lại giữa các cách dịch khác nhau)

HỘI THOẠI:
- Lời thoại đặt trong dấu ngoặc kép "..."
- Mỗi lượt thoại của nhân vật khác nhau xuống dòng mới

- Chỉ trả về bản dịch, không giải thích gì thêm`;

const LINE_BREAK_INSTRUCTION = `
- Tự động ngắt đoạn văn hợp lý: thêm dòng trống giữa các đoạn khi chuyển cảnh, chuyển ý, hoặc chuyển lời thoại. KHÔNG ngắt dòng mỗi câu.`;

function getSystemPrompt(lang: string): string {
  const base = lang === "zh" ? ZH_PROMPT : VI_PROMPT;
  return base + LINE_BREAK_INSTRUCTION;
}

function getProvider(model: string): "openai" | "gemini" | "claude" | "openrouter" {
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "claude";
  if (model.includes("/")) return "openrouter";
  return "openai";
}

type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

const OUTPUT_LIMIT_ERROR =
  "The model hit its output limit before finishing the chapter. Try again, lower the reasoning effort, or use a model with a larger output limit.";
const stoppedError = (reason: string) => `The model stopped before finishing the chapter (${reason}).`;
const REFUSAL_ERROR = "The model refused to translate this chapter.";

interface ProviderRequest {
  apiKey: string;
  model: string;
  text: string;
  systemPrompt: string;
  effort: ReasoningEffort;
  signal?: AbortSignal;
  // Authenticates the stream's terminal record (see app/lib/stream.ts)
  nonce: string;
}

interface StreamState {
  usage: TokenUsage;
  // The provider reported a normal finish
  finished: boolean;
  // The model stopped early (output limit, refusal, provider error)
  error: string | null;
}

// Provider-specific JSON payload of one SSE event
type SseEvent = any;

async function readProviderError(res: Response, provider: string): Promise<Error> {
  const err = await res.json().catch(() => null);
  return new Error(err?.error?.message || `${provider} error: ${res.status}`);
}

// Incremental Server-Sent Events parser (WHATWG spec): lines end in LF, CRLF or
// CR; an event is dispatched at a blank line and its `data:` fields (optional
// space after the colon) are joined with "\n". Other fields are ignored.
class SseParser {
  private buffer = "";
  private data: string[] = [];
  private afterCR = false;

  constructor(private onData: (data: string) => void) {}

  push(chunk: string) {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      // LF right after a CR completes a CRLF line ending already handled
      if (this.afterCR) {
        this.afterCR = false;
        if (c === 10) {
          start = i + 1;
          continue;
        }
      }
      if (c === 10 || c === 13) {
        this.line(this.buffer + chunk.slice(start, i));
        this.buffer = "";
        start = i + 1;
        this.afterCR = c === 13;
      }
    }
    this.buffer += chunk.slice(start);
  }

  // The stream ended; dispatch an event that was not followed by a blank line
  end() {
    if (this.buffer) this.line(this.buffer);
    this.buffer = "";
    this.dispatch();
  }

  private line(line: string) {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
  }

  private dispatch() {
    if (this.data.length === 0) return;
    const data = this.data.join("\n");
    this.data = [];
    this.onData(data);
  }
}

// Re-emits a provider's SSE response as plain text followed by the terminal
// record (see app/lib/stream.ts). A response that does not finish normally
// always ends with an error in that record, so a cut-off chapter is never
// mistaken for a complete one.
function sseToTextStream(
  res: Response,
  nonce: string,
  onEvent: (event: SseEvent, emit: (text: string) => void, state: StreamState) => void
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (text: string) => controller.enqueue(encoder.encode(text));
      const state: StreamState = { usage: { input: 0, output: 0 }, finished: false, error: null };
      const parser = new SseParser((data) => {
        if (data === "[DONE]") return;
        let event: SseEvent;
        try {
          event = JSON.parse(data);
        } catch {
          return;
        }
        onEvent(event, emit, state);
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.end();
      } catch {
        // A connection drop after the provider already reported its finish is harmless
        if (!state.finished) state.error ??= STREAM_ENDED_EARLY_ERROR;
      }

      if (!state.error && !state.finished) state.error = STREAM_ENDED_EARLY_ERROR;
      emit(endRecord(nonce, state.usage, state.error));
      controller.close();
    },
  });
}

async function streamOpenAIResponses({ apiKey, model, text, systemPrompt, effort, signal, nonce }: ProviderRequest) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: systemPrompt,
      input: text,
      stream: true,
      reasoning: { effort },
    }),
    signal,
  });

  if (!res.ok) throw await readProviderError(res, "OpenAI");

  return sseToTextStream(res, nonce, (event, emit, state) => {
    switch (event.type) {
      case "response.output_text.delta":
        if (event.delta) emit(event.delta);
        break;
      case "response.refusal.delta":
      case "response.refusal.done":
        state.error = REFUSAL_ERROR;
        break;
      case "response.completed":
        state.finished = true;
        break;
      case "response.incomplete": {
        const reason = event.response?.incomplete_details?.reason;
        state.error = reason === "max_output_tokens" ? OUTPUT_LIMIT_ERROR : stoppedError(reason || "incomplete");
        break;
      }
      case "response.failed":
        state.error = event.response?.error?.message || stoppedError("failed");
        break;
      case "error":
        state.error = event.message || stoppedError("error");
        break;
    }
    const usage = event.response?.usage;
    if (usage) state.usage = { input: usage.input_tokens || 0, output: usage.output_tokens || 0 };
  });
}

async function streamOpenAI(
  { apiKey, model, text, systemPrompt, signal, nonce }: ProviderRequest,
  baseUrl = "https://api.openai.com/v1",
  extraBody: Record<string, unknown> = {}
) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      ...extraBody,
    }),
    signal,
  });

  if (!res.ok) throw await readProviderError(res, "OpenAI");

  return sseToTextStream(res, nonce, (event, emit, state) => {
    const choice = event.choices?.[0];
    if (choice?.delta?.content) emit(choice.delta.content);
    if (choice?.delta?.refusal) state.error = REFUSAL_ERROR;
    const reason = choice?.finish_reason;
    if (reason === "length") state.error = OUTPUT_LIMIT_ERROR;
    else if (reason === "content_filter") state.error = stoppedError(reason);
    else if (reason) state.finished = true;
    // OpenRouter reports provider failures mid-stream as an error object
    if (event.error) state.error = event.error.message || stoppedError("error");
    if (event.usage) {
      state.usage = { input: event.usage.prompt_tokens || 0, output: event.usage.completion_tokens || 0 };
    }
  });
}

function geminiThinkingBudget(effort: ReasoningEffort): number {
  switch (effort) {
    case "low": return 1024;
    case "medium": return 8192;
    case "high": return 24576;
    case "xhigh": return 32768;
  }
}

async function streamGemini({ apiKey, model, text, systemPrompt, effort, signal, nonce }: ProviderRequest) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: geminiThinkingBudget(effort) },
      },
    }),
    signal,
  });

  if (!res.ok) throw await readProviderError(res, "Gemini");

  return sseToTextStream(res, nonce, (event, emit, state) => {
    const candidate = event.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.text && !part.thought) emit(part.text);
    }
    const reason = candidate?.finishReason;
    if (reason === "MAX_TOKENS") state.error = OUTPUT_LIMIT_ERROR;
    else if (reason === "STOP") state.finished = true;
    else if (reason) state.error = stoppedError(reason);
    if (event.error) state.error = event.error.message || stoppedError("error");
    if (event.usageMetadata) {
      state.usage = {
        input: event.usageMetadata.promptTokenCount || 0,
        output: event.usageMetadata.candidatesTokenCount || 0,
      };
    }
  });
}

// Anthropic stop reasons that mean the model finished its answer
const CLAUDE_FINISHED = new Set(["end_turn", "stop_sequence"]);

async function streamClaude({ apiKey, model, text, systemPrompt, signal, nonce }: ProviderRequest) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      // Includes the thinking budget; a long chapter needs well over 10k output tokens
      max_tokens: 32000,
      stream: true,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
      thinking: { type: "enabled", budget_tokens: 4000 },
    }),
    signal,
  });

  if (!res.ok) throw await readProviderError(res, "Claude");

  let stopReason: string | null = null;
  return sseToTextStream(res, nonce, (event, emit, state) => {
    switch (event.type) {
      case "content_block_delta":
        if (event.delta?.type === "text_delta" && event.delta.text) emit(event.delta.text);
        break;
      case "message_start":
        state.usage.input = event.message?.usage?.input_tokens || 0;
        break;
      case "message_delta":
        if (event.usage) state.usage.output = event.usage.output_tokens || 0;
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        break;
      case "message_stop":
        // Anything else (max_tokens, refusal, pause_turn from server tools…) is unfinished
        if (stopReason && CLAUDE_FINISHED.has(stopReason)) state.finished = true;
        else if (stopReason === "max_tokens") state.error = OUTPUT_LIMIT_ERROR;
        else if (stopReason === "refusal") state.error = REFUSAL_ERROR;
        else state.error = stoppedError(stopReason || "no stop reason");
        break;
      case "error":
        state.error = event.error?.message || stoppedError("error");
        break;
    }
  });
}

export interface SimplifyParams {
  text: string;
  apiKey: string;
  model?: string;
  lang?: string;
  customPrompt?: string;
  // The novel's glossary; the names appearing in `text` are added to the prompt
  glossary?: GlossaryTerm[];
  reasoningEffort?: string;
  // Aborts the provider request
  signal?: AbortSignal;
}

// Returns a text stream of the rewritten chapter followed by the terminal record
// (see app/lib/stream.ts), and the nonce that authenticates that record
export interface SimplifyStream {
  stream: ReadableStream;
  // Pass to parseTranslationStream to authenticate the terminal record
  nonce: string;
}

export async function createSimplifyStream({
  text,
  apiKey,
  model,
  lang,
  customPrompt,
  glossary,
  reasoningEffort,
  signal,
}: SimplifyParams): Promise<SimplifyStream> {
  const resolvedModel = model || DEFAULT_AI_MODEL;
  const provider = getProvider(resolvedModel);
  const validEfforts: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
  const effort: ReasoningEffort = validEfforts.includes(reasoningEffort as ReasoningEffort)
    ? (reasoningEffort as ReasoningEffort)
    : (lang === "vi" ? "low" : "medium");
  let systemPrompt = getSystemPrompt(lang || "vi");
  if (customPrompt && typeof customPrompt === "string") {
    systemPrompt += "\n" + customPrompt.trim();
  }
  if (glossary) systemPrompt += glossaryPrompt(glossary, text);

  const nonce = newStreamNonce();
  const request: ProviderRequest = { apiKey, model: resolvedModel, text, systemPrompt, effort, signal, nonce };
  let stream: ReadableStream;
  switch (provider) {
    case "gemini":
      stream = await streamGemini(request);
      break;
    case "claude":
      stream = await streamClaude(request);
      break;
    case "openrouter":
      stream = await streamOpenAI(request, "https://openrouter.ai/api/v1", { reasoning: { effort } });
      break;
    default:
      stream = isOpenAIReasoningModel(resolvedModel) ? await streamOpenAIResponses(request) : await streamOpenAI(request);
  }
  return { stream, nonce };
}
