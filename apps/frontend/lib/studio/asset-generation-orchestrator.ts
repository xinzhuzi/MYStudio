import { aiManager } from "@/lib/ai/ai-manager";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { DEFAULT_IMAGE_ASPECT_RATIO } from "@/lib/ai/image-size-presets";
import { type ImageCategory } from "@/lib/media/image-storage";
import type { ImageAspectRatio, ImageResolution } from "@/lib/ai/image-size-presets";
export type { AssetType } from "@/lib/ai/prompt-polisher";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { DaojiePromptContractError, compileDaojiePrompt, lintDaojieSubjectRisks } from "@/lib/ai/daojie-prompt-contract";
import { EXTENDED_VISUAL_MANUAL_SEED_ID } from "@/lib/studio/visual-manual-classification";
import { AssetType, PolishRequest, PolishResult, batchPolishAssetPrompts, polishAssetPrompt, sanitizeExtendedManualPrompt, selectDaojiePaletteSchemeForAsset } from "@/lib/ai/prompt-polisher";
import { applyMatchedAssets, collectAndMatchAssets, markAssetsPolishing, saveGeneratedAssetImage, updateStoreWithResult, writePolishErrorToStore, writePolishResultToStore } from "./asset-generation-store-writers";

// ─── 类型定义 ───

/**
 * 按资产类型建议的默认画幅。优先级:task 显式指定 > 用户自定义的全局默认 > 本建议 > 全局出厂默认。
 * 即仅当全局默认仍为出厂值（16:9）时,四视图/四宫格类资产才采用手册建议画幅;
 * character：四视图设定图需要横向长画幅（手册建议 21:9，模型支持的最宽比例）；
 * prop：四宫格（2×2）设定图为正方形；scene：跟随全局默认，不做覆盖。
 */
export const SUGGESTED_ASSET_ASPECT_RATIOS: Record<AssetType, ImageAspectRatio | undefined> = {
  character: "21:9",
  prop: "1:1",
  scene: undefined,
};

function suggestedAssetAspectRatio(assetType: AssetType): ImageAspectRatio | undefined {
  return SUGGESTED_ASSET_ASPECT_RATIOS[assetType];
}

export interface AssetGenerationTask {
  /** 资产 ID（Store 中的 id） */
  assetId: string;
  /** 当前项目 ID；存在时图片保存到 _p/{projectId}/workflow-images/... */
  projectId?: string;
  /** 资产类型 */
  assetType: AssetType;
  /** 资产名称 */
  name: string;
  /** 资产描述 */
  description: string;
  /** 是否衍生资产 */
  isDerivative: boolean;
  /** 衍生资产的章节归属(chapterId);仅衍生资产生效——
   *  图片落 workflow-images/assets/<chapterId>/<assetType>/,基类资产留共享目录 */
  chapterId?: string;
  /** 视觉手册 ID */
  visualManualId: string;
  /** 身份锚点（仅角色） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  identityAnchors?: any;
  /** 现有负面提示词 */
  negativePrompt?: string;

  // ── 生成配置 ──
  /** 分辨率，未设置时读取全局图片规格 */
  resolution?: ImageResolution;
  /** 宽高比，未设置时读取全局图片规格 */
  aspectRatio?: ImageAspectRatio;
  /** 参考图（base64 或 local-image://） */
  referenceImages?: string[];
  /** 已有图片工作流 ID；衍生资产重新生成时复用 */
  imageWorkflowId?: string;
  /** 是否跳过润色（已有 prompt 时） */
  skipPolish?: boolean;
  /** 已有的提示词（skipPolish=true 时使用） */
  existingPrompt?: string;
  /** 显式指定三轨配色方案(ma-gongbi-palette-v1 id);缺省用润色期 AI 自动选配结果 */
  paletteSchemeId?: string;
}

export interface AssetGenerationProgress {
  /** 当前阶段 */
  phase: "idle" | "polishing" | "generating" | "saving" | "done" | "failed";
  /** 阶段描述 */
  message?: string;
  /** 润色结果 */
  polishResult?: PolishResult;
  /** 最终图片路径 */
  imageLocalPath?: string;
  /** 错误信息 */
  error?: string;
}

// ─── 核心函数：单资产生成 ───

/**
 * 完整的「润色 → 生成 → 保存」流程
 */
export async function generateAsset(
  task: AssetGenerationTask,
  onProgress?: (progress: AssetGenerationProgress) => void,
): Promise<AssetGenerationProgress> {
  let polishResult: PolishResult | undefined;
  try {
    // Phase 1: 提示词润色
    let prompt: string;
    let negativePrompt: string | undefined;
    let promptPolicy: "enhanced" | "raw" | undefined;

    if (task.skipPolish && task.existingPrompt) {
      prompt = task.existingPrompt;
    } else {
      onProgress?.({
        phase: "polishing",
        message: `正在润色 ${task.name} 的提示词...`,
      });

      polishResult = await polishAssetPrompt({
        assetType: task.assetType,
        name: task.name,
        description: task.description,
        isDerivative: task.isDerivative,
        visualManualId: task.visualManualId,
        identityAnchors: task.identityAnchors,
        negativePrompt: task.negativePrompt,
      });

      if (polishResult.status === "failed") {
        return { phase: "failed", error: polishResult.error, polishResult };
      }

      prompt = polishResult.prompt;
      negativePrompt = polishResult.negativePrompt;
    }

    // Phase 1.5: 道劫 ma-gongbi-v1 确定性编译边界。
    // 题材正文(润色产物或已有提示词)统一进入编译器装配自动层/唯一 Avoid/300-800 长度门,
    // 编译产物 providerPrompt 以 raw 策略直传 provider,禁止 normalize 再追加。
    if (task.visualManualId === EXTENDED_VISUAL_MANUAL_SEED_ID) {
      // 已有提示词直出链同口径清洗:润色路径产出的正文已过 sanitize,
      // 存量/手写 draftPrompt 不过——违禁词(电影质感/景深/宣纸质感系)不得直通 provider
      const subjectBody = sanitizeExtendedManualPrompt(prompt.trim());
      if (!subjectBody) {
        return { phase: "failed", error: "道劫提示词为空，已拒绝生成", polishResult };
      }
      let compiled;
      const daoOpId = createOperationId("daojie-prompt-compile");
      const subjectRisks = lintDaojieSubjectRisks(subjectBody);
      if (subjectRisks.length) {
        void logEvent({
          level: "warn",
          category: "ai",
          operationId: daoOpId,
          message: "Daojie subject body carries risk phrases (soft lint)",
          context: { risks: subjectRisks, assetName: task.name },
        });
      }
      try {
        compiled = await compileDaojiePrompt({
          runtimeTrack: task.assetType,
          subjectBody,
          negativeTerms: [task.negativePrompt, negativePrompt].filter((term): term is string => Boolean(term)),
          hasReferenceImage: Boolean(task.referenceImages?.length),
          paletteSchemeId: task.paletteSchemeId
            ?? polishResult?.daojie?.schemeId
            // skipPolish 再生成没有润色产物,AI 选配会丢——基于已有题材正文补一次,
            // 保持「再生成」与首次生成的配色行为一致
            ?? (task.skipPolish
              ? await selectDaojiePaletteSchemeForAsset({
                assetType: task.assetType,
                name: task.name,
                description: task.description,
                subjectBody,
              }) ?? undefined
              : undefined),
        });
        void logEvent({
          level: "info",
          category: "ai",
          operationId: daoOpId,
          message: "Daojie asset prompt compiled (ma-gongbi-v1)",
          context: {
            track: compiled.track,
            maTrack: compiled.maTrack,
            paletteSchemeId: task.paletteSchemeId ?? polishResult?.daojie?.schemeId ?? null,
            totalChars: compiled.totalChars,
            status: compiled.status,
            moduleIds: compiled.moduleIds,
            moduleLengths: compiled.moduleLengths,
            contractVersion: compiled.contractVersion,
            contractSha256: compiled.contractSha256,
          },
        });
      } catch (err) {
        if (err instanceof DaojiePromptContractError && err.code === "length_exceeded") {
          void logEvent({
            level: "warn",
            category: "ai",
            operationId: daoOpId,
            message: "Daojie asset prompt rejected before provider (over 800)",
            context: { track: task.assetType, totalChars: err.input, moduleLengths: err.details.moduleLengths },
          });
        }
        if (err instanceof Error && /daojie palette scheme/.test(err.message)) {
          return { phase: "failed", error: `配色方案不可用: ${err.message}`, polishResult };
        }
        if (err instanceof DaojiePromptContractError && err.code === "length_exceeded") {
          return {
            phase: "failed",
            error: `道劫提示词超出 800 字符 provider 上限（实际 ${err.input} 字符），已拒绝生成；请重新润色或精简题材正文`,
            polishResult,
          };
        }
        throw err;
      }
      prompt = compiled.providerPrompt;
      negativePrompt = undefined;
      promptPolicy = "raw";
    }

    // Phase 2: 图片生成
    onProgress?.({
      phase: "generating",
      message: `正在生成 ${task.name} 的图片...`,
      polishResult,
    });

    const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
    const imageResult = await aiManager.image(
      {
        prompt,
        negativePrompt,
        promptPolicy,
        resolution: task.resolution ?? imageSettings.defaultResolution,
        aspectRatio:
          task.aspectRatio
          ?? (imageSettings.defaultAspectRatio === DEFAULT_IMAGE_ASPECT_RATIO
            ? suggestedAssetAspectRatio(task.assetType)
            : undefined)
          ?? imageSettings.defaultAspectRatio,
        referenceImages: task.referenceImages,
      },
      task.assetType === "character" ? "character" : task.assetType === "prop" ? "prop" : "scene",
    );

    if (!imageResult.imageUrl) {
      return {
        phase: "failed",
        error: "图片生成未返回 URL",
        polishResult,
      };
    }

    // Phase 3: 保存到本地
    onProgress?.({
      phase: "saving",
      message: `正在保存 ${task.name} 的图片...`,
      polishResult,
    });

    const categoryMap: Record<AssetType, ImageCategory> = {
      character: "characters",
      scene: "scenes",
      prop: "props",
    };

    const localPath = await saveGeneratedAssetImage({
      source: imageResult.imageUrl,
      assetType: task.assetType,
      assetId: task.assetId,
      assetName: task.name,
      projectId: task.projectId,
      isDerivative: task.isDerivative,
      chapterId: task.chapterId,
      category: categoryMap[task.assetType],
    });

    // Phase 4: 更新 Store
    updateStoreWithResult(task.assetId, task.assetType, {
      polishResult,
      imageLocalPath: localPath,
      imageWorkflowId: task.imageWorkflowId,
    });

    return {
      phase: "done",
      polishResult,
      imageLocalPath: localPath,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      phase: "failed",
      error: message,
      polishResult,
    };
  }
}

// ─── 批量生成 ───

/**
 * 批量生成资产图片
 * 图片生成默认串行执行（避免 API 限流）
 */
export async function batchGenerateAssets(
  tasks: AssetGenerationTask[],
  config?: {
    concurrency?: number;
    onProgress?: (
      done: number,
      total: number,
      taskProgress: AssetGenerationProgress,
    ) => void;
    onCancel?: () => boolean;
  },
): Promise<Map<string, AssetGenerationProgress>> {
  const results = new Map<string, AssetGenerationProgress>();
  const concurrency = config?.concurrency ?? 1; // 图片生成默认串行

  for (let i = 0; i < tasks.length; i += concurrency) {
    if (config?.onCancel?.()) break;

    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (task) => {
        const result = await generateAsset(task, (progress) => {
          config?.onProgress?.(i + 1, tasks.length, progress);
        });
        return { assetId: task.assetId, result };
      }),
    );

    for (const { assetId, result } of batchResults) {
      results.set(assetId, result);
    }
  }

  return results;
}

// ─── 仅润色（不生图）的批量版本 ───

/**
 * 批量润色并更新 Store
 * 用于 Phase 1 的"全部润色提示词"功能
 */
export async function polishAssetsAndUpdateStore(
  assetType: AssetType,
  visualManualId: string,
  options?: {
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
    onCancel?: () => boolean;
  },
): Promise<{ success: number; failed: number }> {
  // 先匹配资产库，复用已有数据
  const { pending, matched } = await collectAndMatchAssets(assetType);

  let reusedCount = 0;
  if (matched.length > 0) {
    reusedCount = applyMatchedAssets(assetType, matched);
  }

  if (pending.length === 0) {
    // 全部从资产库复用了
    return { success: reusedCount, failed: 0 };
  }

  // 标记为 polishing（仅未匹配的）
  markAssetsPolishing(assetType, pending);

  // 构建润色请求
  const requests: PolishRequest[] = pending.map((a) => ({
    assetType,
    name: a.name,
    description: a.description,
    isDerivative: false,
    visualManualId,
    identityAnchors: a.identityAnchors,
  }));

  // 执行批量润色
  const results = await batchPolishAssetPrompts(requests, undefined, {
    concurrency: options?.concurrency ?? 3,
    onProgress: options?.onProgress,
    onCancel: (_key) => !!options?.onCancel?.(),
  });

  // 写回 Store
  let success = reusedCount;
  let failed = 0;

  for (const [key, result] of results) {
    const assetName = key.split(":")[1];
    const asset = pending.find((a) => a.name === assetName);
    if (!asset) continue;

    if (result.status === "success") {
      writePolishResultToStore(asset.id, assetType, result);
      success++;
    } else {
      writePolishErrorToStore(asset.id, assetType, result.error ?? "润色失败");
      failed++;
    }
  }

  return { success, failed };
}

// ─── Store 更新辅助 ───



export { applyMatchedAssets, buildGeneratedDerivativeWorkflowPatch, collectAndMatchAssets, collectPendingAssets, markAssetsPolishing, saveGeneratedAssetImage, toReusableAssetImageUrl, updateProp, updateStoreWithResult, writePolishErrorToStore, writePolishResultToStore } from "./asset-generation-store-writers";
