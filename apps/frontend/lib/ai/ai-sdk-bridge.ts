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
import { generateImage, generateText, streamText } from "ai";
import type { IProvider } from "../api-key-manager";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { observedFetch, type ObservedFetchMeta } from "../diagnostics/network";
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_RESOLUTION,
  resolveGptImageSize,
  validateGptImageSize,
  type ImageRequestTemplateName,
} from "./image-size-presets";

export { resolveGptImageSize, validateGptImageSize } from "./image-size-presets";

export interface ProviderInstanceParams {
  baseUrl?: string;
  apiKey: string;
  platform: string;
  name?: string;
  fetch?: typeof fetch;
}

// 按 platform 创建对应的 AI SDK Provider 实例
export function createProviderInstance(params: ProviderInstanceParams) {
  const { baseUrl, apiKey, platform, name } = params;
  const safeName = name || platform || 'default';
  const safeBaseURL = baseUrl || '';
  const fetchOption = params.fetch ? { fetch: params.fetch as any } : {};

  switch (platform) {
    case "openai":
      return createOpenAI({ baseURL: safeBaseURL || undefined, apiKey, ...fetchOption });

    case "openai-compatible":
      return createOpenAICompatible({
        name: safeName,
        baseURL: safeBaseURL,
        apiKey,
        ...fetchOption,
      });

    case "anthropic-compatible":
      return createAnthropic({ baseURL: safeBaseURL || undefined, apiKey, ...fetchOption });

    case "gemini-compatible":
      return createGoogleGenerativeAI({
        baseURL: safeBaseURL,
        apiKey,
        ...fetchOption,
      });

    case "deepseek":
      return createDeepSeek({ baseURL: safeBaseURL || undefined, apiKey, ...fetchOption });

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
        ...fetchOption,
      });

    default:
      return createOpenAICompatible({
        name: platform,
        baseURL: safeBaseURL,
        apiKey,
        ...fetchOption,
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

export interface ResolveImageSizeInput {
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
}

export interface BuildImageRequestBodyInput extends ResolveImageSizeInput {
  prompt: string;
  n?: number;
  quality?: string;
  outputFormat?: string;
  outputCompression?: number;
  negativePrompt?: string;
  referenceImages?: string[];
  extraParams?: Record<string, unknown>;
}

export interface BuiltImageRequestBody {
  body: Record<string, unknown>;
  templateName: ImageRequestTemplateName;
}

export interface ImageGenerationResultExtraction {
  imageUrl?: string;
  taskId?: string;
}

export interface SdkGenerateImageOptions extends BuildImageRequestBodyInput {
  provider: Pick<IProvider, "id" | "baseUrl" | "apiKey" | "platform" | "name">;
  model: string;
  operationId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
  endpointFamily?: string;
  providerOptions?: ProviderOptions;
  fetcher?: typeof fetch;
}

export interface SdkGenerateImageResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
  status?: number;
  size?: string;
  templateName: ImageRequestTemplateName;
}

const CLEAN_IMAGE_PROMPT_TERMS = [
  "clean image",
  "low visual noise",
  "denoised details",
  "clear readable surfaces",
  "clean paper texture",
  "controlled ink wash",
];
const DENOISE_NEGATIVE_PROMPT_TERMS = [
  "visual noise",
  "dirty texture",
  "muddy texture",
  "jpeg artifacts",
  "muddy details",
  "compression artifacts",
  "oversharpening halos",
  "random stains",
  "illegible text",
  "watermark",
  "signature",
  "unwanted calligraphy",
  "messy lineart",
];

export function isGptImageModel(model?: string) {
  return /(^|[-_:/])gpt[-_]?image/i.test(model ?? "");
}

function assignIfDefined(target: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined && value !== null && value !== "") target[key] = value;
}

function appendUniqueTerms(value: string | undefined, terms: string[]) {
  const base = value?.trim() ?? "";
  const lower = base.toLowerCase();
  const missing = terms.filter((term) => !lower.includes(term.toLowerCase()));
  return [base, ...missing].filter(Boolean).join(", ");
}

export function normalizeImagePromptForGeneration(input: {
  prompt: string;
  negativePrompt?: string;
}): { prompt: string; negativePrompt: string } {
  return {
    prompt: appendUniqueTerms(input.prompt, CLEAN_IMAGE_PROMPT_TERMS),
    negativePrompt: appendUniqueTerms(input.negativePrompt, DENOISE_NEGATIVE_PROMPT_TERMS),
  };
}

function buildSdkImagePromptText(prompt: string, negativePrompt: string) {
  if (!negativePrompt.trim()) return prompt;
  return `${prompt}\nNegative constraints: ${negativePrompt}`;
}

export function buildProviderExtensionImageRequestBody(input: BuildImageRequestBodyInput): BuiltImageRequestBody {
  const normalizedPrompt = normalizeImagePromptForGeneration(input);
  const body: Record<string, unknown> = { model: input.model, prompt: normalizedPrompt.prompt, n: input.n ?? 1, stream: false };
  assignIfDefined(body, "aspect_ratio", input.aspectRatio ?? DEFAULT_IMAGE_ASPECT_RATIO);
  assignIfDefined(body, "resolution", input.resolution ?? DEFAULT_IMAGE_RESOLUTION);
  assignIfDefined(body, "width", input.width);
  assignIfDefined(body, "height", input.height);
  assignIfDefined(body, "negative_prompt", normalizedPrompt.negativePrompt);
  if (input.referenceImages?.length) body.image_urls = input.referenceImages;
  Object.assign(body, input.extraParams ?? {});
  return { body, templateName: "provider-extension" };
}

export function buildOpenAIImageRequestBody(input: BuildImageRequestBodyInput): BuiltImageRequestBody {
  if (!isGptImageModel(input.model)) return buildProviderExtensionImageRequestBody(input);
  const { size, templateName } = resolveGptImageSize(input);
  const normalizedPrompt = normalizeImagePromptForGeneration(input);
  const body: Record<string, unknown> = { model: input.model, prompt: normalizedPrompt.prompt, n: input.n ?? 1, size };
  assignIfDefined(body, "quality", input.quality);
  assignIfDefined(body, "output_format", input.outputFormat);
  assignIfDefined(body, "output_compression", input.outputCompression);
  assignIfDefined(body, "negative_prompt", normalizedPrompt.negativePrompt);
  if (input.referenceImages?.length) body.image_urls = input.referenceImages;
  Object.assign(body, input.extraParams ?? {});
  return { body, templateName };
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) return firstString(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstString(record.url) ?? firstString(record.image_url) ?? firstString(record.output_url);
  }
  return undefined;
}

function toDataImageUrl(b64: unknown, format?: unknown): string | undefined {
  if (typeof b64 !== "string" || !b64.trim()) return undefined;
  if (b64.startsWith("data:image/")) return b64;
  const rawFormat = typeof format === "string" ? format.toLowerCase().replace(/[^a-z0-9.+-]/g, "") : "";
  const imageFormat = rawFormat === "jpg" ? "jpeg" : rawFormat || "png";
  return `data:image/${imageFormat};base64,${b64}`;
}

function extractImageFromText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/)?.[1]
    ?? value.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/)?.[1]
    ?? value.match(/(https?:\/\/[^\s"']+\.(?:png|jpg|jpeg|webp|gif)[^\s"']*)/i)?.[1];
}

function extractFromChoiceContent(content: unknown): string | undefined {
  if (typeof content === "string") return extractImageFromText(content);
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    const direct = firstString(record.image_url) ?? firstString(record.image) ?? firstString(record.url);
    if (direct) return direct;
    const base64 = toDataImageUrl(record.data ?? (record.image as Record<string, unknown> | undefined)?.data);
    if (base64) return base64;
  }
  return undefined;
}

export function extractImageGenerationResult(data: unknown): ImageGenerationResultExtraction {
  if (!data || typeof data !== "object") return {};
  const record = data as Record<string, unknown>;
  const dataField = record.data;
  const firstItem = Array.isArray(dataField) ? dataField[0] : dataField;
  const firstRecord = firstItem && typeof firstItem === "object" ? firstItem as Record<string, unknown> : undefined;
  const imageUrl = firstString(firstRecord?.url)
    ?? firstString(firstRecord?.image_url)
    ?? firstString(firstRecord?.output_url)
    ?? toDataImageUrl(firstRecord?.b64_json, firstRecord?.output_format ?? record.output_format)
    ?? firstString(record.url)
    ?? firstString(record.image_url)
    ?? firstString(record.output_url)
    ?? toDataImageUrl(record.b64_json, record.output_format)
    ?? firstString((record.output as Record<string, unknown> | undefined)?.url)
    ?? (typeof record.output === "string" ? firstString(record.output) : undefined)
    ?? (Array.isArray(record.output) ? firstString(record.output[0]) : undefined);
  if (imageUrl) return { imageUrl };
  const choice = Array.isArray(record.choices) ? record.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  const choiceImage = extractFromChoiceContent(message?.content);
  if (choiceImage) return { imageUrl: choiceImage };
  const taskId = firstRecord?.task_id?.toString()
    ?? firstRecord?.id?.toString()
    ?? record.task_id?.toString()
    ?? record.taskId?.toString()
    ?? record.id?.toString();
  return taskId ? { taskId } : {};
}

export function getImageModel(
  provider: Pick<IProvider, "baseUrl" | "apiKey" | "platform" | "name">,
  modelName: string,
  fetcher?: typeof fetch,
) {
  const instance = createProviderInstance({ ...provider, fetch: fetcher });
  if ("imageModel" in instance) return (instance as any).imageModel(modelName);
  if ("image" in instance) return (instance as any).image(modelName);
  throw new Error(`供应商 ${provider.name || provider.platform} 不支持 AI SDK 图片模型`);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseImageSdkHttpError(status: number, errorText: string) {
  let message = `图片生成 API 错误: ${status}`;
  try {
    const data = JSON.parse(errorText);
    message = data?.error?.message || data?.message || data?.msg || message;
  } catch {
    if (errorText && errorText.length < 500) message = errorText;
  }
  const text = `${message}\n${errorText}`.toLowerCase();
  if (status === 401) {
    return `API Key 无效或已过期，请前往「设置」检查图片生成服务的 API Key 配置（原始信息：${message}）`;
  }
  if (status === 403 && (
    text.includes("insufficient_user_quota")
    || text.includes("insufficient quota")
    || text.includes("subscription quota")
    || text.includes("quota insufficient")
    || text.includes("额度不足")
    || text.includes("未配置订阅")
  )) {
    return `图片生成额度不足或订阅未配置：${message}`;
  }
  if (status === 403) return `图片生成服务拒绝请求（403）：${message}`;
  return message;
}

function createImageSdkHttpError(status: number, errorText: string) {
  const error = new Error(parseImageSdkHttpError(status, errorText)) as Error & { status?: number };
  error.status = status;
  return error;
}

function getErrorStatus(error: unknown) {
  const status = (error as { status?: unknown } | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

async function normalizeSdkFetchResponse(response: Response): Promise<Response> {
  if (response.headers && typeof response.headers[Symbol.iterator] === "function") {
    return response;
  }
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: { "content-type": "application/json" },
  });
}

export async function sdkGenerateImage(options: SdkGenerateImageOptions): Promise<SdkGenerateImageResult> {
  const builtRequest = buildOpenAIImageRequestBody(options);
  const size = typeof builtRequest.body.size === "string" ? builtRequest.body.size : undefined;
  const templateName = builtRequest.templateName;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("API 请求超时", "TimeoutError")), timeoutMs);
  const onAbort = () => controller.abort(options.abortSignal?.reason || new Error("用户已取消"));
  if (options.abortSignal) {
    if (options.abortSignal.aborted) return { success: false, error: "用户已取消", templateName, size };
    options.abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  const fetcher: typeof fetch = async (input, init) => {
    const response = await observedFetch(input, init, {
      operationId: options.operationId,
      endpointFamily: options.endpointFamily ?? "ai-sdk-images-generations",
      providerId: options.provider.id,
      providerName: options.provider.name,
      model: options.model,
      timeoutMs,
      templateName,
      fetcher: options.fetcher,
    } satisfies ObservedFetchMeta);
    if (!response.ok) {
      const text = await response.clone().text().catch(() => "");
      throw createImageSdkHttpError(response.status, text);
    }
    return normalizeSdkFetchResponse(response);
  };

  try {
    const imageModel = getImageModel(options.provider, options.model, fetcher);
    const normalizedPrompt = normalizeImagePromptForGeneration(options);
    const sdkPromptText = buildSdkImagePromptText(normalizedPrompt.prompt, normalizedPrompt.negativePrompt);
    const prompt = options.referenceImages?.length
      ? { text: sdkPromptText, images: options.referenceImages as any[] }
      : sdkPromptText;
    const result = await generateImage({
      model: imageModel,
      prompt,
      n: options.n ?? 1,
      ...(size ? { size: size as `${number}x${number}` } : {}),
      ...(!size && options.aspectRatio ? { aspectRatio: options.aspectRatio as `${number}:${number}` } : {}),
      ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
      maxRetries: options.maxRetries ?? 2,
      abortSignal: controller.signal,
    });
    return {
      success: true,
      imageUrl: `data:${result.image.mediaType || "image/png"};base64,${result.image.base64}`,
      size,
      templateName,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      const message = reason instanceof Error ? reason.message : getErrorMessage(error);
      return { success: false, error: message, status: getErrorStatus(error), size, templateName };
    }
    return { success: false, error: getErrorMessage(error), status: getErrorStatus(error), size, templateName };
  } finally {
    clearTimeout(timeout);
    options.abortSignal?.removeEventListener("abort", onAbort);
  }
}
