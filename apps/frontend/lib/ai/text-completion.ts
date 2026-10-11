import { parseApiKeys, type IProvider } from "./core";
import { inferProviderApiProtocolFromPlatform } from "./core/providers/types";
import { describeFetchError } from "./fetch-error";
import {
  buildGeminiCompatibleEndpoint,
  buildOpenAICompatibleEndpoint,
  type ModelTestProtocol,
} from "./model-test";

export interface TextCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TextCompletionRequest {
  provider: Pick<IProvider, "id" | "platform" | "name" | "baseUrl" | "apiKey" | "model" | "apiProtocol">;
  model: string;
  messages: TextCompletionMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 整体调用超时，穿透 SDK 与 HTTP 回退两层；缺省各层走自己的默认。 */
  timeoutMs?: number;
}

export interface TextCompletionAttempt {
  protocol: ModelTestProtocol;
  label: string;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface PreparedTextCompletion {
  success: true;
  attempts: TextCompletionAttempt[];
}

export interface FailedTextCompletionPreparation {
  success: false;
  error: string;
}

export type PreparedTextCompletionRequest = PreparedTextCompletion | FailedTextCompletionPreparation;

export interface TextCompletionAttemptResult {
  protocol: ModelTestProtocol;
  label: string;
  endpoint: string;
  success: boolean;
  elapsedMs: number;
  status?: number;
  error?: string;
}

/**
 * 结构化终态停止原因(1011 thinking 进流改造):
 * stop=自然结束;length=max_tokens 截断;error=调用失败;timeout=整体预算耗尽;
 * aborted=调用方主动中止(当前链路暂无用户中止入口,预留给 UI 停止按钮)。
 */
export type TextCompletionStopReason = "stop" | "length" | "error" | "aborted" | "timeout";

/** 结构化终态 token 用量(1011):输入/输出各一,取不到的腿不填。 */
export interface TextCompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TextCompletionResult {
  success: boolean;
  text?: string;
  error?: string;
  elapsedMs?: number;
  status?: number;
  protocol?: ModelTestProtocol;
  attempts?: TextCompletionAttemptResult[];
  /** 结构化终态(1011):SDK 流式取 stream.finishReason/usage,HTTP 路按响应/错误分类;缺省腿不填。 */
  stopReason?: TextCompletionStopReason;
  usage?: TextCompletionUsage;
}

/** 预算内中止(AbortError/TimeoutError)判超时,其余网络/解析失败判 error;供 HTTP 两路终态分类共用。 */
function classifyHttpErrorStopReason(error: unknown): TextCompletionStopReason {
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || name === "TimeoutError" ? "timeout" : "error";
}

type TextCompletionFetch = (input: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<Response>;

export function prepareTextCompletionRequest(payload: TextCompletionRequest): PreparedTextCompletionRequest {
  const keys = parseApiKeys(payload.provider.apiKey);
  if (keys.length === 0) return { success: false, error: "缺少 API Key" };

  const baseUrl = payload.provider.baseUrl?.trim();
  if (!baseUrl) return { success: false, error: "缺少 Base URL" };

  const model = payload.model?.trim();
  if (!model) return { success: false, error: "缺少模型" };

  const messages = payload.messages.filter((message) => message.content.trim());
  if (!messages.length) return { success: false, error: "缺少消息内容" };

  const attempts = buildTextCompletionAttempts({
    baseUrl,
    apiKey: keys[0]!,
    model,
    messages,
    temperature: payload.temperature,
    maxTokens: payload.maxTokens ?? 2048,
  });

  const protocol = resolveRuntimeTextProtocol(payload.provider);
  return {
    success: true,
    attempts: protocol ? attempts.filter((attempt) => attempt.protocol === protocol) : attempts,
  };
}

/**
 * 运行时一次性腿协议路由(1011 欠账④收敛):平台推断改吃 types.ts 单源表
 * inferProviderApiProtocolFromPlatform(其补齐 memefast 后与下方旧平台清单等价)。
 * 语义钉死不许静默改行为:custom 在单源表里不可推断(undefined),但历史运行时
 * 把它钉在 openai 兼容——1011 断点D 前的存量条目几乎全走 OpenAI 口,此处显式
 * 保留原行为,不放宽成全协议尝试;真未知平台返回 undefined → 不过滤 attempts,
 * 保持全协议尝试链(UI 层 resolveProviderApiProtocol 兜 'openai-compatible' 仅作
 * 展示,两处语义不同,勿合)。
 */
function resolveRuntimeTextProtocol(
  provider: Pick<IProvider, "platform" | "apiProtocol">,
): ModelTestProtocol | undefined {
  if (provider.apiProtocol) return provider.apiProtocol;
  if (provider.platform === "custom") return "openai-compatible";
  return inferProviderApiProtocolFromPlatform(provider.platform);
}

export async function runTextCompletionRequest(
  payload: TextCompletionRequest,
  fetcher: TextCompletionFetch = fetch,
  timeoutMs = 300000,
): Promise<TextCompletionResult> {
  const prepared = prepareTextCompletionRequest(payload);
  if (!prepared.success) return { success: false, error: prepared.error, stopReason: "error" };
  if (!prepared.attempts.length) return { success: false, error: "没有可用的接口协议", stopReason: "error" };

  const attempts: TextCompletionAttemptResult[] = [];
  // 末次失败的终态分类(1011 结构化终态):预算中止/超时→timeout,其余→error;全败时带回。
  let lastStopReason: TextCompletionStopReason = "error";
  // timeoutMs 是「SDK+HTTP 回退」共享的整体预算(TextCompletionRequest 契约):
  // 各协议按剩余时间分摊,不再每个协议各吃一份满额超时,半死不活的网络下也不至于等出 3 倍时长。
  const deadline = Date.now() + timeoutMs;
  for (const attempt of prepared.attempts) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 1000) {
      lastStopReason = "timeout";
      attempts.push({
        protocol: attempt.protocol,
        label: attempt.label,
        endpoint: attempt.endpoint,
        success: false,
        elapsedMs: 0,
        error: `文本模型调用总超时 (${Math.round(timeoutMs / 1000)}s),后续协议未再尝试`,
      });
      break;
    }
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    try {
      const response = await fetcher(attempt.endpoint, {
        method: "POST",
        headers: attempt.headers,
        body: JSON.stringify(attempt.body),
        signal: controller.signal,
      });
      const elapsedMs = Date.now() - startedAt;
      const text = await response.text();
      if (!response.ok) {
        attempts.push({
          protocol: attempt.protocol,
          label: attempt.label,
          endpoint: attempt.endpoint,
          success: false,
          status: response.status,
          elapsedMs,
          error: `文本模型调用失败 (${response.status}) ${text.slice(0, 240)}`,
        });
        continue;
      }

      const content = parseTextCompletionSuccess(attempt.protocol, text);
      if (!content) {
        attempts.push({
          protocol: attempt.protocol,
          label: attempt.label,
          endpoint: attempt.endpoint,
          success: false,
          status: response.status,
          elapsedMs,
          error: "模型响应中缺少文本内容",
        });
        continue;
      }

      return {
        success: true,
        text: content,
        protocol: attempt.protocol,
        status: response.status,
        elapsedMs,
        // HTTP 一次性成功:响应 JSON 无 finish_reason 解析位,终态按自然结束填 stop(1011)。
        stopReason: "stop",
        attempts: [
          ...attempts,
          {
            protocol: attempt.protocol,
            label: attempt.label,
            endpoint: attempt.endpoint,
            success: true,
            status: response.status,
            elapsedMs,
          },
        ],
      };
    } catch (error) {
      lastStopReason = classifyHttpErrorStopReason(error);
      attempts.push({
        protocol: attempt.protocol,
        label: attempt.label,
        endpoint: attempt.endpoint,
        success: false,
        elapsedMs: Date.now() - startedAt,
        error: describeFetchError(error, {
          timeoutLabel: "文本模型调用",
          timeoutMs: remainingMs,
          endpoint: attempt.endpoint,
        }),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  return {
    success: false,
    attempts,
    stopReason: lastStopReason,
    protocol: lastAttempt?.protocol,
    status: lastAttempt?.status,
    elapsedMs: attempts.reduce((sum, attempt) => sum + attempt.elapsedMs, 0),
    error: attempts.map((attempt) => `${attempt.label}: ${attempt.error || attempt.status || "失败"}`).join("；"),
  };
}

/** Anthropic 兼容 attempt 构造：一次性(runTextCompletionRequest)与流式(SSE)共用同一份端点/头/体。 */
function buildAnthropicTextAttempt(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: TextCompletionMessage[];
  temperature?: number;
  maxTokens: number;
}): TextCompletionAttempt {
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const nonSystemMessages = input.messages.filter((message) => message.role !== "system");
  return {
    protocol: "anthropic-compatible",
    label: "Anthropic 兼容",
    endpoint: buildOpenAICompatibleEndpoint(input.baseUrl, "messages"),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: input.model,
      system: system || undefined,
      max_tokens: input.maxTokens,
      temperature: input.temperature ?? 0.2,
      messages: normalizeAnthropicMessages(nonSystemMessages),
    },
  };
}

function buildTextCompletionAttempts(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: TextCompletionMessage[];
  temperature?: number;
  maxTokens: number;
}): TextCompletionAttempt[] {
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const nonSystemMessages = input.messages.filter((message) => message.role !== "system");
  return [
    {
      protocol: "openai-compatible",
      label: "OpenAI 兼容",
      endpoint: buildOpenAICompatibleEndpoint(input.baseUrl, "chat/completions"),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: {
        model: input.model,
        messages: input.messages,
        max_tokens: input.maxTokens,
        temperature: input.temperature ?? 0.2,
      },
    },
    buildAnthropicTextAttempt(input),
    {
      protocol: "gemini-compatible",
      label: "Gemini 兼容",
      endpoint: buildGeminiCompatibleEndpoint(input.baseUrl, input.model),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: {
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: nonSystemMessages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          maxOutputTokens: input.maxTokens,
          temperature: input.temperature ?? 0.2,
        },
      },
    },
  ];
}

function normalizeAnthropicMessages(messages: TextCompletionMessage[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  }));
}

function parseTextCompletionSuccess(protocol: ModelTestProtocol, text: string): string | undefined {
  const data = JSON.parse(text);
  if (protocol === "anthropic-compatible") {
    return data.content
      ?.map((item: { text?: string }) => item.text?.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (protocol === "gemini-compatible") {
    return data.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text?.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return data.choices?.[0]?.message?.content?.trim();
}

interface SseDeltaResult {
  delta?: string;
  /** thinking 增量(1011 进流):anthropic thinking_delta / openai reasoning_content 增量。 */
  thinking?: string;
  error?: string;
  /** 流内停止原因:openAI finish_reason / anthropic message_delta.stop_reason 归一后的枚举。 */
  stopReason?: TextCompletionStopReason;
  /** 流内 usage 半场(1011 欠账③):anthropic message_start 送输入、message_delta 送输出;
   * openai include_usage 尾块一次送齐——由流循环合并成完整 usage,只带取到的字段。 */
  usage?: Partial<TextCompletionUsage>;
}

/** SSE 流内 finish/stop 原因 → 结构化终态枚举;只认 stop/length,其余保持 undefined 由兜底填。 */
function normalizeSseStopReason(raw: string | undefined): TextCompletionStopReason | undefined {
  if (raw === "stop" || raw === "end_turn" || raw === "stop_sequence") return "stop";
  if (raw === "length" || raw === "max_tokens") return "length";
  return undefined;
}

function extractOpenAiSseDelta(json: unknown): SseDeltaResult {
  const parsed = json as {
    choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = parsed?.choices?.[0];
  const delta = choice?.delta?.content;
  // openai 兼容口的思考增量字段名是 reasoning_content(部分网关也走 content 内混排,那类无法可靠切分,不硬造)
  const thinking = choice?.delta?.reasoning_content;
  const stopReason = normalizeSseStopReason(choice?.finish_reason);
  // 1011 欠账③:请求体开 stream_options.include_usage 后,收尾块(choices 为空)带 usage;
  // openai 字段名 prompt_tokens/completion_tokens → 内部 inputTokens/outputTokens 半场。
  const usage: Partial<TextCompletionUsage> = {
    ...(typeof parsed?.usage?.prompt_tokens === "number" ? { inputTokens: parsed.usage.prompt_tokens } : {}),
    ...(typeof parsed?.usage?.completion_tokens === "number" ? { outputTokens: parsed.usage.completion_tokens } : {}),
  };
  return {
    ...(typeof delta === "string" && delta ? { delta } : {}),
    ...(typeof thinking === "string" && thinking ? { thinking } : {}),
    ...(stopReason ? { stopReason } : {}),
    ...(usage.inputTokens !== undefined || usage.outputTokens !== undefined ? { usage } : {}),
  };
}

/** anthropic SSE：content_block_delta 按子类型分流——text_delta 为可见文本,thinking_delta 为思考增量(1011);
 * message_delta.stop_reason 归一终态;error 事件触发一次性回退。
 * 1011 欠账③:官方契约 message_start 事件 message.usage.input_tokens 与 message_delta 事件
 * usage.output_tokens 必带——此前可得未取,现各解析成 usage 半场由流循环聚合。 */
function extractAnthropicSseDelta(json: unknown): SseDeltaResult {
  const parsed = json as {
    type?: string;
    delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string; usage?: { output_tokens?: number } };
    message?: { usage?: { input_tokens?: number } };
    error?: { message?: string };
  };
  if (parsed?.type === "error") {
    return { error: parsed.error?.message ?? "anthropic 流式返回 error 事件" };
  }
  if (parsed?.type === "message_start") {
    const inputTokens = parsed.message?.usage?.input_tokens;
    return typeof inputTokens === "number" ? { usage: { inputTokens } } : {};
  }
  if (parsed?.type === "message_delta") {
    const outputTokens = parsed.delta?.usage?.output_tokens;
    return {
      ...(normalizeSseStopReason(parsed.delta?.stop_reason)
        ? { stopReason: normalizeSseStopReason(parsed.delta?.stop_reason)! }
        : {}),
      ...(typeof outputTokens === "number" ? { usage: { outputTokens } } : {}),
    };
  }
  if (parsed?.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
    return typeof parsed.delta.text === "string" && parsed.delta.text ? { delta: parsed.delta.text } : {};
  }
  if (parsed?.type === "content_block_delta" && parsed.delta?.type === "thinking_delta") {
    // 官方 schema 增量在 delta.thinking;个别网关塞 delta.text,顺手容错不硬造
    const thinking = parsed.delta.thinking ?? parsed.delta.text;
    return typeof thinking === "string" && thinking ? { thinking } : {};
  }
  return {};
}

/**
 * 流式协议分派(1011 欠账④收敛):改吃 types.ts 单源推断表,不再自持只特判
 * anthropic/gemini 的平行表。anthropic → anthropic SSE;gemini → 一次性回退
 * (undefined);openai 系与未知平台 → openai SSE——未知平台流式失败仍由
 * fallbackOneShot 走全协议尝试链,运行时行为不变。
 * (收敛前的漂移:未声明协议的 gemini 平台会先盲试 openai SSE 再回退一次性;
 * 收敛后与显式声明 gemini-compatible 的路径一致,直接走一次性。)
 */
function resolveStreamSseProtocol(
  provider: Pick<IProvider, "platform" | "apiProtocol">,
): "openai-compatible" | "anthropic-compatible" | undefined {
  const protocol = provider.apiProtocol ?? inferProviderApiProtocolFromPlatform(provider.platform);
  if (protocol === "anthropic-compatible") return "anthropic-compatible";
  if (protocol === "gemini-compatible") return undefined;
  return "openai-compatible";
}

/**
 * 流式文本补全（SSE）。每收到一段增量调用 onDelta(delta, kind)——kind 区分正文与
 * thinking(1011 进流改造:glm-5.3 等思考型模型思考期数分钟,增量不上屏 UI 就是干等);
 * 返回完整正文文本(thinking 不混入返回值)。
 * OpenAI 兼容协议按 chat/completions SSE 解析;anthropic 兼容协议按 messages SSE
 * （event: content_block_delta 的 text_delta/thinking_delta）解析——此前 anthropic 一律降级一次性，
 * 39k 级 prompt 一次性生成超 300s 直接超时（10-11 GLM 实弹）。gemini 及未识别协议
 * 回退到一次性，并把整段作为一个增量回调。
 */
export async function runTextCompletionStreamRequest(
  payload: TextCompletionRequest,
  onDelta: (delta: string, kind: "text" | "thinking") => void,
  fetcher: TextCompletionFetch = fetch,
  timeoutMs = 300000,
): Promise<TextCompletionResult> {
  const streamProtocol = resolveStreamSseProtocol(payload.provider);
  if (!streamProtocol) {
    const result = await runTextCompletionRequest(payload, fetcher, timeoutMs);
    if (result.success && result.text) onDelta(result.text, "text");
    return result;
  }

  const keys = parseApiKeys(payload.provider.apiKey);
  if (keys.length === 0) return { success: false, error: "缺少 API Key", stopReason: "error" };
  const baseUrl = payload.provider.baseUrl?.trim();
  if (!baseUrl) return { success: false, error: "缺少 Base URL", stopReason: "error" };
  const model = payload.model?.trim();
  if (!model) return { success: false, error: "缺少模型", stopReason: "error" };
  const messages = payload.messages.filter((message) => message.content.trim());
  if (!messages.length) return { success: false, error: "缺少消息内容", stopReason: "error" };

  const isAnthropicStream = streamProtocol === "anthropic-compatible";
  const anthropicAttempt = isAnthropicStream
    ? buildAnthropicTextAttempt({
        baseUrl,
        apiKey: keys[0]!,
        model,
        messages,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens ?? 2048,
      })
    : undefined;
  const endpoint = anthropicAttempt
    ? anthropicAttempt.endpoint
    : buildOpenAICompatibleEndpoint(baseUrl, "chat/completions");
  const extractDelta = isAnthropicStream ? extractAnthropicSseDelta : extractOpenAiSseDelta;
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let full = "";
  // 流式失败（服务器拒绝 stream / 空响应 / 网络中断等）时回退到一次性请求；仅当尚未流出任何内容时才补发整段，避免重复。
  // 回退只吃整体预算的剩余部分,流式已耗的时间计入。
  const fallbackOneShot = async (reason: string): Promise<TextCompletionResult> => {
    console.warn(`[text-stream] 流式失败(${reason}) → 回退一次性`);
    const r = await runTextCompletionRequest(payload, fetcher, Math.max(1000, deadline - Date.now()));
    if (r.success && r.text && !full) onDelta(r.text, "text");
    return r;
  };
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: anthropicAttempt
        ? anthropicAttempt.headers
        : { "Content-Type": "application/json", Authorization: `Bearer ${keys[0]!}` },
      body: JSON.stringify(
        anthropicAttempt
          ? { ...anthropicAttempt.body, stream: true }
          : {
              model,
              messages,
              max_tokens: payload.maxTokens ?? 2048,
              temperature: payload.temperature ?? 0.2,
              stream: true,
              // 1011 欠账③:让 openai 兼容口在收尾块回 usage(prompt/completion_tokens),
              // 腿内聚合成结构化用量;不认该字段的网关若拒收,流失败自动回退一次性(不带此字段)。
              stream_options: { include_usage: true },
            },
      ),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return await fallbackOneShot(`status ${response.status}: ${errText.slice(0, 120)}`);
    }
    const body = response.body as ReadableStream<Uint8Array> | null;
    if (!body) return await fallbackOneShot("无数据流");

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstByteAt = 0;
    // 流内终态(1011):finish_reason/stop_reason 事件归一;收不到时兜底 stop。
    let streamStopReason: TextCompletionStopReason | undefined;
    // 流内 usage 聚合(1011 欠账③):anthropic 两事件与 openai include_usage 尾块各送半场,合并成完整用量。
    let streamUsage: Partial<TextCompletionUsage> = {};
    // 首字节看门狗：30s 内无任何字节则判定流式不通，中止→回退一次性。
    const fbTimer = setTimeout(() => { if (!firstByteAt) controller.abort(); }, 30000);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!firstByteAt && (value?.length ?? 0) > 0) { firstByteAt = Date.now(); clearTimeout(fbTimer); }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            // 跳过不完整/非 JSON 片段
            continue;
          }
          const extracted = extractDelta(json);
          if (extracted.error) throw new Error(extracted.error);
          if (extracted.stopReason) streamStopReason = extracted.stopReason;
          if (extracted.usage) streamUsage = { ...streamUsage, ...extracted.usage };
          if (extracted.delta) { full += extracted.delta; onDelta(extracted.delta, "text"); }
          if (extracted.thinking) onDelta(extracted.thinking, "thinking");
        }
      }
    } finally {
      clearTimeout(fbTimer);
    }
    if (!full.trim()) return await fallbackOneShot("流式空响应");
    // usage 终态(1011 欠账③):取到任一半才填,缺的那半记 0(接口要求双数字);
    // 网关整场不回 usage 事件时不填,保持「取不到的腿不填」契约。
    const hasStreamUsage = streamUsage.inputTokens !== undefined || streamUsage.outputTokens !== undefined;
    return {
      success: true,
      text: full,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      stopReason: streamStopReason ?? "stop",
      ...(hasStreamUsage
        ? { usage: { inputTokens: streamUsage.inputTokens ?? 0, outputTokens: streamUsage.outputTokens ?? 0 } }
        : {}),
    };
  } catch (error) {
    return await fallbackOneShot(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}
