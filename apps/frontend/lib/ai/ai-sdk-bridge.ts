/**
 * AI SDK Bridge — MYStudio IProvider → Vercel AI SDK Provider 实例映射
 * 双进程共用：主进程 IPC handler 和渲染进程 feature-router 均导入此模块。
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createXai } from "@ai-sdk/xai";
import { createQwen } from "qwen-ai-provider-v5";
import { createZhipu } from "zhipu-ai-provider";
import { createMinimax } from "vercel-minimax-ai-provider";
import { generateText, streamText } from "ai";
import type { IProvider } from "@/lib/api-key-manager";
import type { ProviderOptions } from "@ai-sdk/provider-utils";

export interface ProviderInstanceParams {
  baseUrl?: string;
  apiKey: string;
  platform: string;
  name?: string;
}

// 按 platform 创建对应的 AI SDK Provider 实例
export function createProviderInstance(params: ProviderInstanceParams) {
  const { baseUrl, apiKey, platform, name } = params;
  const safeName = name || platform || 'default';
  const safeBaseURL = baseUrl || '';

  switch (platform) {
    case "openai":
      return createOpenAI({ baseURL: safeBaseURL || undefined, apiKey });

    case "openai-compatible":
      return createOpenAICompatible({
        name: safeName,
        baseURL: safeBaseURL,
        apiKey,
      });

    case "anthropic-compatible":
      return createAnthropic({ baseURL: safeBaseURL || undefined, apiKey });

    case "gemini-compatible":
      return createGoogleGenerativeAI({
        baseURL: safeBaseURL,
        apiKey,
      });

    case "deepseek":
      return createDeepSeek({ baseURL: safeBaseURL || undefined, apiKey });

    case "minimax":
      return createMinimax({ apiKey });

    // 以下供应商 LLM 文本调用均走 OpenAI 兼容协议
    case "klingai":
    case "volcengine":
    case "vidu":
    case "runninghub":
    case "tts-compatible":
    case "custom":
      return createOpenAICompatible({
        name: platform,
        baseURL: safeBaseURL,
        apiKey,
      });

    default:
      return createOpenAICompatible({
        name: platform,
        baseURL: safeBaseURL,
        apiKey,
      });
  }
}

// 从 provider 信息获取 AI SDK LanguageModel 实例
export function getLanguageModel(
  provider: Pick<IProvider, "baseUrl" | "apiKey" | "platform" | "name">,
  modelName: string,
) {
  const instance = createProviderInstance(provider);
  // OpenAI 系: .chat(); OpenAI-compatible 系: .chatModel(); 其他: 直接调用
  if ("chat" in instance) return (instance as any).chat(modelName);
  if ("chatModel" in instance) return (instance as any).chatModel(modelName);
  return (instance as any)(modelName);
}

// 统一文本生成（非流式）
export async function sdkGenerateText(options: {
  provider: Pick<IProvider, "baseUrl" | "apiKey" | "platform" | "name">;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  providerOptions?: ProviderOptions;
}): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const model = getLanguageModel(options.provider, options.model);
    const result = await generateText({
      model,
      messages: options.messages,
      ...(options.temperature != null && { temperature: options.temperature }),
      ...(options.maxTokens != null && { maxOutputTokens: options.maxTokens }),
      ...(options.providerOptions && { providerOptions: options.providerOptions }),
    });
    return { success: true, text: result.text };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

// 统一文本生成（流式），返回 fullStream 供调用方消费
export async function sdkStreamText(options: {
  provider: Pick<IProvider, "baseUrl" | "apiKey" | "platform" | "name">;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}) {
  const model = getLanguageModel(options.provider, options.model);
  const result = streamText({
    model,
    messages: options.messages,
    ...(options.temperature != null && { temperature: options.temperature }),
    ...(options.maxTokens != null && { maxOutputTokens: options.maxTokens }),
    ...(options.abortSignal && { abortSignal: options.abortSignal }),
  });
  return result;
}
