import { ipcMain } from "electron";
import { Agent, fetch as undiciFetch } from "undici";
import { observedFetch, type ObservedFetchMeta } from "../../../lib/diagnostics/network";
import { createDescribedFetchError, describeFetchError } from "../../../lib/ai/fetch-error";
import { assertSafeOutboundRequestUrl } from "../../security/request-url-guard";
import {
  getModelTestTimeoutMs,
  runModelTestRequest,
  type ModelTestRequest,
  type ModelTestResult,
} from "../../../lib/ai/model-test";
import {
  runTextCompletionRequest,
  runTextCompletionStreamRequest,
  type TextCompletionRequest,
  type TextCompletionResult,
  type TextCompletionStopReason,
  type TextCompletionUsage,
} from "../../../lib/ai/text-completion";
import { sdkGenerateText, sdkStreamText } from "../../../lib/ai/ai-sdk-bridge";
import type { ImageRequestPayload, ImageRequestResult } from "../../../types/api-image-request";
import type { DiagnosticsLogEntryInput } from "../../../types/diagnostics";

type RegisterApiRequestIpcHandlersContext = {
  createOperationId: (prefix: string) => string;
  writeDiagnosticsLog: (entry: DiagnosticsLogEntryInput) => void;
};

function headersToRecord(headers: Headers) {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => { record[key] = value; });
  return record;
}

function requestInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function validateHttpRequestUrl(rawUrl: string) {
  return assertSafeOutboundRequestUrl(rawUrl);
}

/**
 * ai@7 finishReason(ai FinishReason: 'stop'|'length'|'content-filter'|'tool-calls'|'error'|'other')
 * → TextCompletionStopReason 归一(1011 结构化终态):枚举外的 content-filter/tool-calls/other
 * 走降级语义 stop——上层按「自然结束」处理;真实截断/错误仍有 length/error 可辨。
 */
function mapSdkFinishReason(reason: string | undefined): TextCompletionStopReason {
  if (reason === "length" || reason === "error") return reason;
  return "stop";
}

/** ai@7 LanguageModelUsage(inputTokens/outputTokens 可为 undefined)→ 结构化用量;两值皆缺返回 undefined 不硬造。 */
function mapSdkUsage(usage: { inputTokens?: number; outputTokens?: number } | undefined): TextCompletionUsage | undefined {
  const { inputTokens, outputTokens } = usage ?? {};
  if (typeof inputTokens !== "number" && typeof outputTokens !== "number") return undefined;
  return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
}

/**
 * 图片长任务专用 fetch:本地大模型推理(Krea2 挂 LoRA 首跑=深拷贝+合并+生成)
 * 实测可超 5 分钟,而全局 fetch 的 undici 默认 headersTimeout=300s 会在响应
 * 头到达前掐断(09-01 实弹 301s 处被斩;AbortSignal 给到 900s 也管不到它——
 * music3 LONG_JOB_AGENT 同款坑同款解)。headersTimeout 抬到 IPC 上限之上;
 * 与 undici 自家 fetch 同实例配对,避免跨副本 dispatcher 符号不兼容。实际
 * 时长仍由 handler 的 AbortController(payload.timeoutMs)治理,云端默认
 * 180s 行为零变更。
 */
const IMAGE_LONG_JOB_AGENT = new Agent({
  headersTimeout: 1_800_000,
  bodyTimeout: 0,
});

function imageRequestFetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return undiciFetch(input as never, { ...(init as object), dispatcher: IMAGE_LONG_JOB_AGENT } as never) as unknown as Promise<Response>;
}

export function registerApiRequestIpcHandlers({
  createOperationId,
  writeDiagnosticsLog,
}: RegisterApiRequestIpcHandlersContext) {
  const createDiagnosticsFetch = (params: {
    operationId: string;
    endpointFamily: string;
    providerId?: string;
    providerName?: string;
    model?: string;
    timeoutMs?: number;
  }) => (
    input: RequestInfo | URL,
    init?: RequestInit,
    meta?: Partial<ObservedFetchMeta>,
  ) => observedFetch(
    // model-test / text-completion / text-stream 的目标 baseUrl 同样来自渲染
    // 进程,统一过外发地址守卫(禁 link-local 与云元数据,见 request-url-guard)。
    assertSafeOutboundRequestUrl(requestInputUrl(input)),
    init,
    {
      ...params,
      ...meta,
      requestId: createOperationId("req"),
      fetcher: fetch as typeof fetch,
      logEvent: writeDiagnosticsLog,
    },
  );

  ipcMain.handle("api-image-request", async (
    _event,
    payload: ImageRequestPayload,
  ): Promise<ImageRequestResult> => {
    const operationId = payload.operationId?.trim() || createOperationId("image-request");
    const requestId = payload.requestId?.trim() || createOperationId("req");
    const startedAt = performance.now();
    const timeoutMs = payload.timeoutMs ?? 180_000;
    const url = validateHttpRequestUrl(payload.url);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new DOMException("图片生成请求超时", "TimeoutError")),
      timeoutMs,
    );
    writeDiagnosticsLog({
      level: "info",
      category: "ipc",
      operationId,
      requestId,
      message: "Image request IPC started",
      context: {
        endpointFamily: payload.endpointFamily,
        providerId: payload.providerId,
        providerName: payload.providerName,
        model: payload.model,
        timeoutMs,
        templateName: payload.templateName,
      },
    });
    try {
      const response = await observedFetch(url, {
        method: payload.method ?? "GET",
        headers: payload.headers,
        body: payload.body,
        signal: controller.signal,
      }, {
        operationId,
        requestId,
        endpointFamily: payload.endpointFamily ?? "api-image-request",
        providerId: payload.providerId,
        providerName: payload.providerName,
        model: payload.model,
        timeoutMs,
        attempt: payload.attempt,
        maxRetries: payload.maxRetries,
        retryBackoffMs: payload.retryBackoffMs,
        templateName: payload.templateName,
        taskId: payload.taskId,
        pollAttempt: payload.pollAttempt,
        pollStatus: payload.pollStatus,
        fetcher: imageRequestFetcher as typeof fetch,
        logEvent: writeDiagnosticsLog,
      });
      const body = await response.text();
      const durationMs = Math.round(performance.now() - startedAt);
      writeDiagnosticsLog({
        level: response.ok ? "info" : "error",
        category: "ipc",
        operationId,
        requestId,
        message: response.ok ? "Image request IPC completed" : "Image request IPC failed",
        durationMs,
        context: {
          endpointFamily: payload.endpointFamily,
          status: response.status,
          statusText: response.statusText,
          durationMs,
        },
      });
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: headersToRecord(response.headers),
        body,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      // undici 的真实失败原因(DNS/拒连/超时/证书)只在主进程的 error.cause 里,
      // 跨 IPC 抛回渲染层时 cause 会丢——必须在抛出前翻译成带原因的 message。
      const describedError = describeFetchError(error, {
        timeoutLabel: "图片请求",
        timeoutMs,
        endpoint: url,
      });
      writeDiagnosticsLog({
        level: "error",
        category: "ipc",
        operationId,
        requestId,
        message: "Image request IPC errored",
        durationMs,
        context: {
          endpointFamily: payload.endpointFamily,
          durationMs,
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
          describedError,
        },
        error,
      });
      throw createDescribedFetchError(error, {
        timeoutLabel: "图片请求",
        timeoutMs,
        endpoint: url,
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  ipcMain.handle("api-model-test", async (
    _event,
    payload: ModelTestRequest,
  ): Promise<ModelTestResult> => {
    const operationId = payload.operationId?.trim() || createOperationId("model-test");
    writeDiagnosticsLog({
      level: "info",
      category: "ipc",
      operationId,
      message: "Model test IPC started",
      context: {
        providerId: payload.provider.id,
        providerName: payload.provider.name,
        platform: payload.provider.platform,
        model: payload.model,
        type: payload.type,
      },
    });
    const result = await runModelTestRequest(payload, createDiagnosticsFetch({
      operationId,
      endpointFamily: "model-test",
      providerId: payload.provider.id,
      providerName: payload.provider.name,
      model: payload.model,
      timeoutMs: getModelTestTimeoutMs(payload.type),
    }));
    writeDiagnosticsLog({
      level: result.success ? "info" : "error",
      category: "ipc",
      operationId,
      message: result.success ? "Model test IPC completed" : "Model test IPC failed",
      context: {
        status: result.status,
        protocol: result.protocol,
        elapsedMs: result.elapsedMs,
        error: result.error,
      },
    });
    return result;
  });

  ipcMain.handle("api-text-completion", async (
    _event,
    payload: TextCompletionRequest,
  ): Promise<TextCompletionResult> => {
    const operationId = createOperationId("text-completion");
    // 调用方可指定整体超时（如记忆库抽取要快速失败）；缺省 300s。
    const textTimeoutMs = payload.timeoutMs ?? 300_000;
    writeDiagnosticsLog({
      level: "info",
      category: "ipc",
      operationId,
      message: "Text completion IPC started",
      context: {
        providerId: payload.provider.id,
        providerName: payload.provider.name,
        platform: payload.provider.platform,
        model: payload.model,
        messageCount: payload.messages.length,
        timeoutMs: textTimeoutMs,
      },
    });
    const textStartedAt = Date.now();
    const provider = payload.provider;
    if (provider.platform && provider.apiKey) {
      try {
        const textModel = payload.model || provider.model?.[0] || "";
        const result = await sdkGenerateText({
          provider: {
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            platform: provider.platform,
            name: provider.name,
            apiProtocol: provider.apiProtocol,
          },
          model: textModel,
          messages: payload.messages,
          temperature: payload.temperature,
          maxTokens: payload.maxTokens,
          timeoutMs: textTimeoutMs,
        });
        if (result.success) {
          writeDiagnosticsLog({
            level: "info",
            category: "ai",
            operationId,
            message: "Text completion completed through AI SDK",
            context: { providerName: provider.name, model: textModel, stopReason: "stop" },
          });
          // sdkGenerateText 桥不透出 finishReason/usage,非流式 SDK 成功路终态降级填 stop(1011)。
          return { success: true, text: result.text, stopReason: "stop" };
        }
        // SDK 非异常失败（错误已被 sdkGenerateText 捕获转 {success:false}）此前零留痕，
        // 回退 HTTP 后无从归因（10-11 GLM 根因隐形 4 天的同款哑弹）；此处补记失败原因。
        writeDiagnosticsLog({
          level: "warn",
          category: "ai",
          operationId,
          message: "AI SDK text completion failed, falling back to HTTP",
          context: {
            providerName: provider.name,
            model: textModel,
            error: result.error,
            networkFailure: result.networkFailure,
            timeoutFailure: result.timeoutFailure,
          },
        });
      } catch (error) {
        writeDiagnosticsLog({
          level: "warn",
          category: "ai",
          operationId,
          message: "AI SDK text completion failed, falling back to HTTP",
          error,
        });
      }
    }
    // 整体预算=textTimeoutMs,SDK 阶段已消耗的部分从 HTTP 回退中扣除;耗尽则快速失败。
    const textRemainingMs = textTimeoutMs - (Date.now() - textStartedAt);
    if (textRemainingMs <= 2000) {
      writeDiagnosticsLog({
        level: "error",
        category: "ipc",
        operationId,
        message: "Text completion budget exhausted after AI SDK attempt",
        context: { elapsedMs: Date.now() - textStartedAt, timeoutMs: textTimeoutMs },
      });
      return {
        success: false,
        error: `文本模型调用总超时 (${Math.round(textTimeoutMs / 1000)}s),HTTP 回退未再尝试`,
        elapsedMs: Date.now() - textStartedAt,
        stopReason: "timeout",
      };
    }
    const result = await runTextCompletionRequest(payload, createDiagnosticsFetch({
      operationId,
      endpointFamily: "text-completion",
      providerId: payload.provider.id,
      providerName: payload.provider.name,
      model: payload.model,
      timeoutMs: textRemainingMs,
    }), textRemainingMs);
    writeDiagnosticsLog({
      level: result.success ? "info" : "error",
      category: "ipc",
      operationId,
      message: result.success ? "Text completion IPC completed" : "Text completion IPC failed",
      context: {
        status: result.status,
        protocol: result.protocol,
        elapsedMs: result.elapsedMs,
        error: result.error,
        stopReason: result.stopReason,
      },
    });
    return result;
  });

  ipcMain.handle("api-text-completion-stream", async (
    event,
    args: { payload: TextCompletionRequest; streamId: string },
  ): Promise<TextCompletionResult> => {
    const operationId = createOperationId("text-stream");
    writeDiagnosticsLog({
      level: "info",
      category: "ipc",
      operationId,
      message: "Text completion stream IPC started",
      context: {
        providerId: args.payload.provider.id,
        providerName: args.payload.provider.name,
        platform: args.payload.provider.platform,
        model: args.payload.model,
        streamId: args.streamId,
      },
    });
    const streamStartedAt = Date.now();
    const streamBudgetMs = args.payload.timeoutMs ?? 300_000;
    const provider = args.payload.provider;
    // 1011 thinking 进流:渲染层流通道改结构化信封 {kind:'text'|'thinking', delta}——
    // text-delta→text,reasoning-delta→thinking(ai@7 fullStream 两种 part 的字段名都是 text,
    // 见 node_modules/ai/dist/index.d.ts TextStreamTextDeltaPart/TextStreamReasoningDeltaPart)。
    // 首个思考/首个正文计时(相对 streamStartedAt)供完成诊断归因「思考期等了多久」。
    let firstThinkingMs: number | undefined;
    let firstTextMs: number | undefined;
    const sendStreamChunk = (kind: "text" | "thinking", delta: string) => {
      if (event.sender.isDestroyed()) return;
      if (kind === "thinking" && firstThinkingMs === undefined) firstThinkingMs = Date.now() - streamStartedAt;
      if (kind === "text" && firstTextMs === undefined) firstTextMs = Date.now() - streamStartedAt;
      event.sender.send(`api-text-stream:${args.streamId}`, { kind, delta });
    };
    // SDK 腿落空(异常/空文本)走 HTTP 回退的路标:预算中止→timeout,异常→error(1011 结构化终态)。
    let sdkFallbackStopReason: TextCompletionStopReason | undefined;
    if (provider.platform && provider.apiKey) {
      // SDK 流式此前无任何超时,上游挂住时 IPC 永不返回;这里给整体预算内的中止信号。
      // (声明在 try 外:catch 里要读 signal.aborted 判 timeout 路标)
      const sdkStreamController = new AbortController();
      try {
        const textModel = args.payload.model || provider.model?.[0] || "";
        const sdkStreamTimer = setTimeout(
          () => sdkStreamController.abort(new DOMException("流式调用超时,回退一次性请求", "TimeoutError")),
          streamBudgetMs,
        );
        let stream: Awaited<ReturnType<typeof sdkStreamText>>;
        let fullText = "";
        // 1011 复审修:ai@7 的中止以流内 {type:'abort'; reason?} part 收尾而非抛错
        // (见 node_modules/ai/dist/index.d.ts TextStreamAbortPart)——for-await 会正常走完,
        // fullText 非空照进成功路,此前无分支静默丢弃→截断正文被误报自然结束保存。
        let streamAbortSeen = false;
        let streamAbortReason: string | undefined;
        try {
          stream = await sdkStreamText({
            provider: {
              baseUrl: provider.baseUrl,
              apiKey: provider.apiKey,
              platform: provider.platform,
              name: provider.name,
              apiProtocol: provider.apiProtocol,
            },
            model: textModel,
            messages: args.payload.messages,
            temperature: args.payload.temperature,
            maxTokens: args.payload.maxTokens,
            abortSignal: sdkStreamController.signal,
          });
          for await (const chunk of stream.fullStream) {
            if (chunk.type === "text-delta") {
              fullText += chunk.text;
              sendStreamChunk("text", chunk.text);
            } else if (chunk.type === "reasoning-delta") {
              // 1011 thinking 进流:思考增量原样转发渲染层(glm-5.3 思考期数分钟,不上屏=UI 干等);
              // 只转发不进 fullText——终态 text 恒为正文,思考不落盘。
              sendStreamChunk("thinking", chunk.text);
            } else if (chunk.type === "error") {
              // AI SDK 的 error part 此前被静默丢弃→fullText 空→「流秒回空」哑弹
              // （10-11 GLM 根因隐形 4 天正是此处无留痕）；务必落诊断日志再走回退。
              const streamError = chunk.error instanceof Error ? chunk.error : undefined;
              writeDiagnosticsLog({
                level: "error",
                category: "ai",
                operationId,
                message: "AI SDK text stream errored part",
                context: {
                  streamId: args.streamId,
                  textLength: fullText.length,
                  errorName: streamError?.name,
                  errorMessage: streamError?.message ?? String(chunk.error),
                },
              });
            } else if (chunk.type === "abort") {
              // 1011 复审修:预算中止打断流的收尾 part,只记不发——终态在成功路口判,
              // 拒绝把「带部分正文的截断」当自然结束。
              streamAbortSeen = true;
              streamAbortReason = chunk.reason;
            }
          }
        } finally {
          clearTimeout(sdkStreamTimer);
        }
        if (fullText.trim()) {
          if (streamAbortSeen || sdkStreamController.signal.aborted) {
            // 1011 复审修:中止打断已有正文——截断文本不得当自然结束保存,也不再走 HTTP
            // 回退(正文已上屏,回退一次性会整段重发造成 UI 双份)。自家预算中止→timeout;
            // 外来中止→aborted('aborted' 枚举的首个生产点)。
            const stopReason: TextCompletionStopReason = sdkStreamController.signal.aborted ? "timeout" : "aborted";
            writeDiagnosticsLog({
              level: "error",
              category: "ai",
              operationId,
              message: "AI SDK text stream aborted mid-text",
              context: {
                streamId: args.streamId,
                textLength: fullText.length,
                firstThinkingMs,
                firstTextMs,
                stopReason,
                abortReason: streamAbortReason,
              },
            });
            return {
              success: false,
              error: stopReason === "timeout"
                ? `流式调用超时(${Math.round(streamBudgetMs / 1000)}s),正文被截断(${fullText.length} 字),已丢弃未保存`
                : `AI SDK 流式被中止,正文被截断(${fullText.length} 字),已丢弃未保存`,
              stopReason,
            };
          }
          // 结构化终态(1011):ai@7 streamText 的 finishReason/usage 是 awaitable PromiseLike,
          // 流消费完后取真实值;error part 已被吞或上游没给时取不到→降级 stop。
          let stopReason: TextCompletionStopReason = "stop";
          let usage: TextCompletionUsage | undefined;
          try {
            stopReason = mapSdkFinishReason(await stream.finishReason);
            usage = mapSdkUsage(await stream.usage);
          } catch {
            // 取不到真实终态(流异常收尾时 Promise 可能 reject):降级 stop,不阻断返回
          }
          writeDiagnosticsLog({
            level: "info",
            category: "ai",
            operationId,
            message: "Text completion stream completed through AI SDK",
            context: {
              streamId: args.streamId,
              textLength: fullText.length,
              firstThinkingMs,
              firstTextMs,
              stopReason,
              usage,
            },
          });
          return { success: true, text: fullText, stopReason, usage };
        }
        sdkFallbackStopReason = sdkStreamController.signal.aborted
          ? "timeout"
          : streamAbortSeen ? "aborted" : undefined;
        writeDiagnosticsLog({
          level: "warn",
          category: "ai",
          operationId,
          message: "AI SDK text stream returned empty, falling back to HTTP",
          context: {
            streamId: args.streamId,
            textLength: fullText.length,
            firstThinkingMs,
            firstTextMs,
            stopReason: sdkFallbackStopReason,
          },
        });
      } catch (error) {
        sdkFallbackStopReason = sdkStreamController.signal.aborted ? "timeout" : "error";
        writeDiagnosticsLog({
          level: "warn",
          category: "ai",
          operationId,
          message: "AI SDK text stream failed, falling back to HTTP",
          context: { streamId: args.streamId, firstThinkingMs, firstTextMs, stopReason: sdkFallbackStopReason },
          error,
        });
      }
    }
    // 回退只吃整体预算的剩余部分(SDK 流式阶段已消耗的计入)
    const streamRemainingMs = streamBudgetMs - (Date.now() - streamStartedAt);
    const fallbackResult = await runTextCompletionStreamRequest(args.payload, (delta, kind) => {
      sendStreamChunk(kind, delta);
    }, createDiagnosticsFetch({
      operationId,
      endpointFamily: "text-completion-stream",
      providerId: args.payload.provider.id,
      providerName: args.payload.provider.name,
      model: args.payload.model,
      timeoutMs: Math.max(1000, streamRemainingMs),
    }), Math.max(1000, streamRemainingMs));
    // 回退腿终态(1011):HTTP 路自填优先;没填时按 SDK 落空路标兜底,再不行按成败兜 stop/error。
    const result: TextCompletionResult = {
      ...fallbackResult,
      stopReason: fallbackResult.stopReason ?? sdkFallbackStopReason ?? (fallbackResult.success ? "stop" : "error"),
    };
    writeDiagnosticsLog({
      level: result.success ? "info" : "error",
      category: "ipc",
      operationId,
      message: result.success ? "Text completion stream IPC completed" : "Text completion stream IPC failed",
      context: {
        status: result.status,
        protocol: result.protocol,
        elapsedMs: result.elapsedMs,
        error: result.error,
        streamId: args.streamId,
        firstThinkingMs,
        firstTextMs,
        stopReason: result.stopReason,
      },
    });
    return result;
  });
}
