// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 全应用生图引擎(多 provider 兜底链 + 智能路由 + 渠道适配)。
 *
 * 分层定位(2026-08-29 迁自 lib/assist/freedom-api.ts,Trellis
 * 08-28-freedom-image-engine-rename 批次 A):渠道/引擎层,与 image-generator
 * (资产链)/mikoto-async 同层。消费方:ai-manager 门面 → 自由面板/分镜批量/
 * 画布节点生图。ai-manager 门面直接导入 generateImage(批次 C 已正名,
 * freedom-api 的旧名再导出已移除)。
 *
 * 引擎职责:收集 freedom_image/character_generation/scene_generation 绑定组
 * 兜底链(≤2 家)→ mikoto 异步拦截 → 智能路由(images/chat/mj/ideogram/kling/
 * replicate)→ 坏点记忆 → 付费边界(ambiguous 停链)。行为零变更,纯迁移。
 */

import {
  getAllFeatureConfigs,
  getFeatureNotConfiguredMessage,
  type FeatureConfig,
} from '@/lib/ai/feature-router';
import {
  buildOpenAIImageRequestBody,
  buildProviderExtensionImageRequestBody,
  extractImageGenerationResult,
  isGptImageModel,
  normalizeImagePromptForGeneration,
  sdkGenerateImage,
} from '@/lib/ai/ai-sdk-bridge';
import { createOperationId, logEvent } from '@/lib/diagnostics/logger';
import { createDescribedFetchError, isNetworkFailureError, type NetworkFailureFlags } from '@/lib/ai/fetch-error';
import { getModelEndpointTypes } from '@/lib/ai/config/store-adapter';
import { useAppSettingsStore } from '@/stores/app/app-settings-store';
import { isLocalImageProvider } from '@/stores/ai/api-config-provider-helpers';
import { getImageSizeLabel } from '@/lib/ai/image-size-presets';
import {
  buildCompatibilityImagePrompt,
  shouldRetryImageCompatibility,
} from '@/lib/ai/image-compatibility';
import { prepareReferenceImagesForTransfer } from '@/lib/ai/image-transfer';
import { toast } from 'sonner';
import { freedomRetry } from './generation-retry';
import {
  buildFreedomEndpoint as _buildEndpoint,
  extractFreedomImageUrl as extractImageUrl,
  freedomObservedFetch,
  getFreedomRootBaseUrl as getRootBaseUrl,
  pollForFreedomResult as pollForResult,
} from './generation-transport';
import { DEFAULT_IMAGE_ENDPOINT, detectFreedomImageRoute, getImageEndpointPaths } from './image-routing';
import { resolveFreedomFeatureConfig } from './generation-feature-config';
import { generateFreedomImageViaChat } from './image-channel-chat';
import { generateMikotoImageViaAsync } from '@/lib/ai/mikoto-async';
import {
  clearImagesEndpointPoison,
  isImagesEndpointPoisoned,
  markImagesEndpointPoisoned,
} from './image-endpoint-memory';
import { isMikotoImageProvider } from '@/lib/ai/image-generator';
import { isAmbiguousPaidImageError } from '@/lib/ai/image-generation-errors';
import {
  generateViaIdeogramEndpoint,
  generateViaKlingImageEndpoint,
  generateViaMidjourneyEndpoint,
  generateViaReplicateImageEndpoint,
} from './image-channel-adapters';
import { saveFreedomImage, saveToMediaLibrary } from './generation-media';

/** 媒体库落库闭包:persistMedia=false(分镜/资产自存项目真源)时跳过双写。 */
function mediaSaverFor(persistMedia: boolean | undefined) {
  return persistMedia === false
    ? undefined
    : (url: string, prompt: string) => saveToMediaLibrary(url, prompt, 'ai-image');
}
import type { FreedomImageParams, GenerationResult } from './generation-types';

export type { FreedomImageParams, GenerationResult } from './generation-types';

// ==================== Constants ====================

const IMAGE_POLL_INTERVAL = 2000;
const IMAGE_POLL_MAX_ATTEMPTS = 60;

// ==================== Retry Logic ====================

function throwImageSdkError(
  result: { error?: string; status?: number; networkFailure?: boolean; timeoutFailure?: boolean },
  fallbackMessage: string,
): never {
  const message = result.error || fallbackMessage;
  if (typeof result.status === 'number') {
    const err = toHttpError(message, result.status, message);
    err.networkFailure = result.networkFailure || undefined;
    err.timeoutFailure = result.timeoutFailure || undefined;
    throw err;
  }
  const err = new Error(message) as Error & NetworkFailureFlags;
  err.networkFailure = result.networkFailure || undefined;
  err.timeoutFailure = result.timeoutFailure || undefined;
  throw err;
}

/**
 * images 端点网关性失败判定(→ chat 形态回退的门槛): 仅网关/上游类瞬时故障
 * (5xx 网关、非 JSON 错误体、超时、连接重置)才值得换端点重试;鉴权/参数等
 * 确定性错误不回退,维持原语义免无效等待。08-24 实证:部分中转站(如 qkmss)
 * 的 gpt-image 系在 /v1/images/generations 稳定 502,而 chat/completions
 * 返回 markdown 内嵌 base64 图——同模型名在不同供应商的可用端点不同,
 * 回退按「同渠道同 key 同模型」进行,不影响 images 端点健康的供应商。
 */
function isImagesEndpointGatewayFailure(error: unknown): boolean {
  // 传输层网络失败(结构化标记/稳定前缀)直接判定可回退,与文案措辞解耦
  if (isNetworkFailureError(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /invalid json|bad gateway|service unavailable|gateway time-?out|timed? out|etimedout|econnreset|econnrefused|socket hang up|network error|fetch failed|网络请求失败|enotfound|\b50[234]\b/i.test(message);
}

function withGlobalImageSizeDefaults(params: FreedomImageParams): FreedomImageParams {
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  return {
    ...params,
    aspectRatio: params.aspectRatio || imageSettings.defaultAspectRatio,
    resolution: params.resolution || imageSettings.defaultResolution,
  };
}

// ==================== Image Generation ====================

/** 兜底链失败摘要:按尝试顺序列出各家原因(截断),供最终错误拼接。 */
function buildAttemptChainSummary(attempts: Array<{ name: string; error: string }>): string {
  return attempts
    .map((attempt, index) => `${index + 1}. ${attempt.name}:${attempt.error.slice(0, 90)}`)
    .join(';');
}

export async function generateImage(
  params: FreedomImageParams
): Promise<GenerationResult> {
  const operationId = createOperationId('freedom-image');
  const normalizedPrompt = normalizeImagePromptForGeneration({
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    promptPolicy: params.promptPolicy,
  });
  const generationParams: FreedomImageParams = {
    ...params,
    prompt: normalizedPrompt.prompt,
    negativePrompt: normalizedPrompt.negativePrompt,
    referenceImages: await prepareReferenceImagesForTransfer(params.referenceImages),
  };
  // 收集所有图片相关功能绑定的 provider，合并去重。
  // 内存护栏:fallback 不设上限时,配了 N 个 provider 就会把同一份 base64
  // 参考图序列化 N 次经 IPC 发给主进程,每次响应又是 MB 级 base64 字符串——
  // N 个全挂时单次生图在渲染进程同时挂 N×MB 字符串,GC 前堆瞬时翻倍。
  // 兜底 2 个已能覆盖「主通道挂→备用顶上」,超出的 provider 不再进链。
  const MAX_FALLBACK_PROVIDERS = 2;
  const seen = new Set<string>();
  const fallbackConfigs: FeatureConfig[] = [];
  for (const feature of ['freedom_image', 'character_generation', 'scene_generation'] as const) {
    for (const cfg of getAllFeatureConfigs(feature)) {
      if (fallbackConfigs.length >= MAX_FALLBACK_PROVIDERS) break;
      const key = cfg.provider.id + ':' + cfg.baseUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      fallbackConfigs.push(cfg);
    }
    if (fallbackConfigs.length >= MAX_FALLBACK_PROVIDERS) break;
  }

  if (fallbackConfigs.length === 0) {
    throw new Error('图片生成未配置：请在设置中配置服务');
  }

  let lastError: Error | null = null;
  let lastBaseUrl: string | undefined;
  const attempts: Array<{ name: string; error: string }> = [];
  for (const cfg of fallbackConfigs) {
    // mikoto 专用:异步模块内部自带付费纪律,外层跳过 freedomRetry——
    // 否则提交层 5xx 报错文案里的状态码会触发重试,违背「结果不确定不重烧」
    const mikotoBoundary = isMikotoImageProvider(cfg.baseUrl);
    try {
      return await (mikotoBoundary
        ? _generateFreedomImageInner(generationParams, cfg, operationId)
        : freedomRetry(
            () => _generateFreedomImageInner(generationParams, cfg, operationId),
            'Image generation',
            cfg.keyManager,
          ));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      lastBaseUrl = cfg.baseUrl;
      // 付费结果不确定(请求可能已被受理计费):立即失败,不再换家——换家
      // 若成功等于一张图烧两次钱(08-28 实证:mikoto edits 51s 200 非 JSON
      // 疑似已出图被丢弃,又跟了一次 chat)。前置家的失败原因一并带上,
      // 否则报错又变回「只提最后一家」
      if (isAmbiguousPaidImageError(err)) {
        if (attempts.length > 0) {
          lastError.message = `已依次尝试 ${attempts.length} 家生图服务均失败(${buildAttemptChainSummary(attempts)})最后错误:${lastError.message}`;
        }
        throw lastError;
      }
      attempts.push({ name: cfg.provider.name, error: lastError.message });
      console.warn(`[Freedom] Provider ${cfg.provider.name} (${cfg.baseUrl}) failed:`, lastError.message);
    }
  }

  // 兜底链跑尽才到这;只报最后一家会把前置 provider 的真实失败原因藏掉
  // (08-28 实证:钱咖API 先挂→mikoto 兜底也挂,报错只提 mikoto,用户以为
  // 自己配的渠道被无视)。列出整条链各自的失败原因,最后错误保持原语义。
  const described = createDescribedFetchError(lastError, { endpoint: lastBaseUrl });
  if (attempts.length > 1) {
    described.message = `已依次尝试 ${attempts.length} 家生图服务均失败(${buildAttemptChainSummary(attempts)})最后错误:${described.message}`;
  }
  throw described;
}

/** chat 形态统一入口(统一 saveToMediaLibrary 落库闭包)。mikoto 不在此列:
 * 已在 _generateFreedomImageInner 顶部被异步通道拦截,永不触达 chat。 */
async function generateChatForm(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  operationId?: string,
): Promise<GenerationResult> {
  return generateFreedomImageViaChat(
    params,
    model,
    apiKey,
    baseUrl,
    (url, prompt) => mediaSaverFor(params.persistMedia)!(url, prompt),
    operationId,
  );
}

async function _generateFreedomImageInner(
  params: FreedomImageParams,
  overrideConfig?: FeatureConfig,
  operationId?: string,
): Promise<GenerationResult> {
  params = withGlobalImageSizeDefaults(params);
  let config: FeatureConfig | null;
  if (overrideConfig) {
    config = overrideConfig;
  } else {
    const resolved = resolveFreedomFeatureConfig('freedom_image', 'character_generation', params.model);
    config = resolved.config;
  }
  if (!config) {
    const msg = getFeatureNotConfiguredMessage('character_generation');
    toast.error('自由板块图片生成未配置：请在设置中配置「自由板块-图片」或「图片生成」服务映射');
    throw new Error(msg);
  }

  const { baseUrl, model: defaultModel } = config;
  // 每次重试动态取当前 key（利用 keyManager rotate 后的新 key）
  const apiKey = config.keyManager?.getCurrentKey?.() || config.apiKey;
  // 模型 ID 直接透传：UI 选的就是供应商原始 ID，无需转换
  const model = params.model || defaultModel;
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const mikotoPaidBoundary = isMikotoImageProvider(normalizedBase);

  // mikoto 专用异步通道(用户裁定 2026-08-28:mikoto 必须走异步,同步
  // images/chat 通道暂时关闭)。拦截置于一切路由/transport 之前——包括显式
  // transport=chat 的保存失败重试,确保 mikoto 请求不触达任何同步端点。
  // 付费纪律在异步模块内闭环:提交受理后失败即 ambiguous,不重试不换家。
  if (mikotoPaidBoundary) {
    return await generateMikotoImageViaAsync(
      params,
      model,
      apiKey,
      normalizedBase,
      (url, prompt) => mediaSaverFor(params.persistMedia)!(url, prompt),
      operationId,
    );
  }

  // 显式 chat 传输:绕过智能路由直走 chat 形态(base64 直返,零 CDN 依赖)。
  // 08-24 结构修复——「images 端点成功但 URL 下载 504」曾直接丢图白烧一次
  // 生成;调用方现在可以在保存失败后用该形态无损重试。
  if (params.transport === "chat") {
    return await generateChatForm(params, model, apiKey, normalizedBase, operationId);
  }

  // ── Smart Routing: choose endpoint based on model metadata ──
  const endpointTypes = getModelEndpointTypes(model);
  const route = detectFreedomImageRoute(model, endpointTypes);

  if (route === 'midjourney') {
    return await generateViaMidjourneyEndpoint(params, model, apiKey, normalizedBase, saveFreedomImage);
  }
  if (route === 'ideogram') {
    return await generateViaIdeogramEndpoint(params, model, apiKey, normalizedBase, saveFreedomImage);
  }
  if (route === 'openai_chat') {
    return await generateChatForm(params, model, apiKey, normalizedBase, operationId);
  }
  if (route === 'kling_image') {
    return await generateViaKlingImageEndpoint(
      params,
      model,
      apiKey,
      normalizedBase,
      () => generateViaImagesEndpoint(params, model, apiKey, normalizedBase),
      saveFreedomImage,
    );
  }
  if (route === 'replicate') {
    return await generateViaReplicateImageEndpoint(params, model, apiKey, normalizedBase, saveFreedomImage);
  }

  // 坏点记忆命中:images 端点近期稳定「200 非 JSON」,直接走 chat 形态,
  // 省掉每镜一次的必败请求(mikoto 已在函数顶部被异步通道拦截,不会到这里)
  if (isImagesEndpointPoisoned(config.provider.id, model)) {
    await logEvent({
      level: 'info',
      category: 'ai',
      operationId,
      message: 'Images endpoint poisoned (recent 200 non-JSON), skipping to chat form',
      context: { baseUrl, model, providerId: config.provider.id, providerName: config.provider.name },
    });
    return await generateChatForm(params, model, apiKey, normalizedBase, operationId);
  }

  try {
    const result = await generateViaImagesEndpoint(params, model, apiKey, normalizedBase, endpointTypes, operationId, config.provider);
    clearImagesEndpointPoison(config.provider.id, model);
    return result;
  } catch (error) {
    if (!isImagesEndpointGatewayFailure(error)) throw error;
    // 「200 非 JSON」是服务端稳定损坏(非瞬时故障),记指纹让后续请求跳过
    // images 端点;5xx/超时类瞬时故障不记,保留自愈机会
    if (/invalid json/i.test(error instanceof Error ? error.message : String(error))) {
      markImagesEndpointPoisoned(config.provider.id, model);
    }
    await logEvent({
      level: 'warn',
      category: 'ai',
      operationId,
      message: 'Images endpoint gateway failure, falling back to chat form',
      context: {
        endpointFamily: 'freedom-image',
        baseUrl,
        model,
        reason: error instanceof Error ? error.message : String(error),
      },
    });
    return await generateChatForm(params, model, apiKey, normalizedBase, operationId);
  }
}

/**
 * Generate image via standard /v1/images/generations endpoint
 */
async function generateViaImagesEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  endpointTypes?: string[],
  operationId?: string,
  provider?: Pick<FeatureConfig['provider'], 'id' | 'platform' | 'name' | 'baseUrl' | 'apiKey'>,
): Promise<GenerationResult> {
  const imagePaths = getImageEndpointPaths(endpointTypes || []);
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}${imagePaths.submit}`;
  const usesDefaultImagesEndpoint = imagePaths.submit === DEFAULT_IMAGE_ENDPOINT.submit;
  const builtRequest = usesDefaultImagesEndpoint
    ? buildOpenAIImageRequestBody({
        model,
        prompt: params.prompt,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        width: params.width,
        height: params.height,
        negativePrompt: params.negativePrompt,
        promptPolicy: params.promptPolicy,
        referenceImages: params.referenceImages,
        extraParams: params.extraParams,
      })
    : buildProviderExtensionImageRequestBody({
        model,
        prompt: params.prompt,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        width: params.width,
        height: params.height,
        negativePrompt: params.negativePrompt,
        promptPolicy: params.promptPolicy,
        referenceImages: params.referenceImages,
        extraParams: params.extraParams,
      });
  const body = builtRequest.body;
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  if (provider && isLocalImageProvider(provider) && imageSettings.localImageLoraEnabled) {
    // 本地专业流开关(D5):仅本地 provider 注入,云端请求零影响;
    // Krea2 挂 NSFW LoRA / ComfyUI 桥路由 NSFW 专业流,引擎侧各自消费
    body.use_lora = true;
  }
  if (usesDefaultImagesEndpoint && isGptImageModel(model) && provider) {
    const sdkResult = await sdkGenerateImage({
      provider: { ...provider, apiKey, baseUrl },
      model,
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      width: params.width,
      height: params.height,
      negativePrompt: params.negativePrompt,
      referenceImages: params.referenceImages,
      extraParams: params.extraParams,
      operationId,
      endpointFamily: 'freedom-image',
      abortSignal: params.signal,
      maxRetries: 2,
    });
    if (!sdkResult.success || !sdkResult.imageUrl) {
      if (imageSettings.compatibilityRetryEnabled && shouldRetryImageCompatibility(sdkResult)) {
        const compatibilityPrompt = buildCompatibilityImagePrompt(params.prompt);
        await logEvent({
          level: 'warn',
          category: 'ai',
          operationId,
          message: 'Image generation compatibility retry started',
          context: {
            endpointFamily: 'freedom-image',
            providerId: provider.id,
            providerName: provider.name,
            model,
            reason: sdkResult.error,
            status: sdkResult.status,
            originalSize: sdkResult.size,
            retrySize: getImageSizeLabel({
              aspectRatio: imageSettings.compatibilityRetryAspectRatio,
              resolution: imageSettings.compatibilityRetryResolution,
            }),
            originalPromptLength: params.prompt.length,
            retryPromptLength: compatibilityPrompt.length,
          },
        });
        const compatibilityResult = await sdkGenerateImage({
          provider: { ...provider, apiKey, baseUrl },
          model,
          prompt: compatibilityPrompt,
          aspectRatio: imageSettings.compatibilityRetryAspectRatio,
          resolution: imageSettings.compatibilityRetryResolution,
          negativePrompt: params.negativePrompt,
          referenceImages: params.referenceImages,
          extraParams: params.extraParams,
          operationId,
          endpointFamily: 'freedom-image',
          abortSignal: params.signal,
          maxRetries: 0,
        });
        if (compatibilityResult.success && compatibilityResult.imageUrl) {
          await logEvent({
            level: 'info',
            category: 'ai',
            operationId,
            message: 'Image generation compatibility retry completed',
            context: {
              endpointFamily: 'freedom-image',
              providerId: provider.id,
              providerName: provider.name,
              model,
              retrySize: compatibilityResult.size,
              templateName: compatibilityResult.templateName,
            },
          });
          const mediaId = mediaSaverFor(params.persistMedia)?.(compatibilityResult.imageUrl, params.prompt);
          return { url: compatibilityResult.imageUrl, mediaId };
        }
        await logEvent({
          level: 'warn',
          category: 'ai',
          operationId,
          message: 'Image generation compatibility retry failed',
          context: {
            endpointFamily: 'freedom-image',
            providerId: provider.id,
            providerName: provider.name,
            model,
            status: compatibilityResult.status,
            error: compatibilityResult.error,
          },
        });
      }
      throwImageSdkError(sdkResult, 'AI SDK 图片生成失败');
    }
    const mediaId = mediaSaverFor(params.persistMedia)?.(sdkResult.imageUrl, params.prompt);
    return { url: sdkResult.imageUrl, mediaId };
  }

  const response = await freedomObservedFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  }, {
    operationId,
    endpointFamily: 'freedom-image',
    model,
    templateName: builtRequest.templateName,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw toHttpError('图片生成请求失败', response.status, errText);
  }

  const data = await response.json();

  // Try to get image URL directly
  const extracted = extractImageGenerationResult(data);
  let imageUrl = extracted.imageUrl || extractImageUrl(data);
  const taskId = extracted.taskId || data.task_id;

  // If async task, poll for result
  if (!imageUrl && taskId) {
    const pollUrl = `${rootBase}${imagePaths.poll(String(taskId))}`;
    imageUrl = await pollForResult(
      pollUrl,
      apiKey,
      IMAGE_POLL_INTERVAL,
      IMAGE_POLL_MAX_ATTEMPTS,
      operationId,
      String(taskId),
    );
  }

  if (!imageUrl) {
    throw new Error('接口响应里没有图片地址');
  }

  const mediaId = mediaSaverFor(params.persistMedia)?.(imageUrl, params.prompt);
  return { url: imageUrl, taskId: taskId ? String(taskId) : undefined, mediaId };
}

/**
 * Resolve kling model name for API requests.
 * Composite IDs like 'kling-image-v1-5' → 'kling-v1-5' (MemeFast version ID).
 * Video version IDs (kling-v2-6) pass through unchanged.
 */
function toHttpError(prefix: string, status: number, body: string): Error & { status: number } & NetworkFailureFlags {
  // 前缀(上游 SDK 错误)已含响应体时不再重复拼接,避免 toast 文案复读
  const detail = body && prefix.includes(body) ? "" : ` ${body.slice(0, 240)}`;
  const err = new Error(`${prefix}: ${status}${detail}`) as Error & { status: number } & NetworkFailureFlags;
  err.status = status;
  return err;
}
