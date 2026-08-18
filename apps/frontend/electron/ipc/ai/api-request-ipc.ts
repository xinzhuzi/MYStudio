import { ipcMain } from "electron";
import { observedFetch, type ObservedFetchMeta } from "../../../lib/diagnostics/network";
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
        fetcher: fetch as typeof fetch,
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
        },
        error,
      });
      throw error;
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
            context: { providerName: provider.name, model: textModel },
          });
          return { success: true, text: result.text };
        }
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
    const result = await runTextCompletionRequest(payload, createDiagnosticsFetch({
      operationId,
      endpointFamily: "text-completion",
      providerId: payload.provider.id,
      providerName: payload.provider.name,
      model: payload.model,
      timeoutMs: textTimeoutMs,
    }), textTimeoutMs);
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
    const provider = args.payload.provider;
    if (provider.platform && provider.apiKey) {
      try {
        const textModel = args.payload.model || provider.model?.[0] || "";
        const stream = await sdkStreamText({
          provider: {
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            platform: provider.platform,
            name: provider.name,
          },
          model: textModel,
          messages: args.payload.messages,
          temperature: args.payload.temperature,
          maxTokens: args.payload.maxTokens,
        });
        let fullText = "";
        for await (const chunk of stream.fullStream) {
          if (chunk.type === "text-delta") {
            fullText += chunk.text;
            if (!event.sender.isDestroyed()) {
              event.sender.send(`api-text-stream:${args.streamId}`, chunk.text);
            }
          }
        }
        if (fullText.trim()) {
          writeDiagnosticsLog({
            level: "info",
            category: "ai",
            operationId,
            message: "Text completion stream completed through AI SDK",
            context: { streamId: args.streamId, textLength: fullText.length },
          });
          return { success: true, text: fullText };
        }
        writeDiagnosticsLog({
          level: "warn",
          category: "ai",
          operationId,
          message: "AI SDK text stream returned empty, falling back to HTTP",
          context: { streamId: args.streamId, textLength: fullText.length },
        });
      } catch (error) {
        writeDiagnosticsLog({
          level: "warn",
          category: "ai",
          operationId,
          message: "AI SDK text stream failed, falling back to HTTP",
          context: { streamId: args.streamId },
          error,
        });
      }
    }
    const result = await runTextCompletionStreamRequest(args.payload, (delta) => {
      if (!event.sender.isDestroyed()) event.sender.send(`api-text-stream:${args.streamId}`, delta);
    }, createDiagnosticsFetch({
      operationId,
      endpointFamily: "text-completion-stream",
      providerId: args.payload.provider.id,
      providerName: args.payload.provider.name,
      model: args.payload.model,
      timeoutMs: 300000,
    }));
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
      },
    });
    return result;
  });
}
