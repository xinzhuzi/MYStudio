/**
 * 资产生成编排服务
 *
 * 编排：提示词润色 → 图片生成 → 本地保存 → Store 更新
 *
 * 已有基础设施：
 * - aiManager.image(params, kind) → ImageGenerationResult { imageUrl, taskId? }
 * - saveImageToLocal(url, category, filename) → local-image://...
 * - characterStore.addCharacterView(charId, { viewType, imageUrl })
 * - characterStore.updateCharacter(id, updates)
 * - sceneStore.updateScene(id, updates)
 */

import { aiManager, type AIBinding } from "@/lib/ai/ai-manager";
import {
  polishAssetPrompt,
  type PolishRequest,
  type PolishResult,
  type AssetType,
} from "@/lib/ai/prompt-polisher";

export type { AssetType };
import { saveImageToLocal, type ImageCategory } from "@/lib/image-storage";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";

// ─── 类型定义 ───

export interface AssetGenerationTask {
  /** 资产 ID（Store 中的 id） */
  assetId: string;
  /** 资产类型 */
  assetType: AssetType;
  /** 资产名称 */
  name: string;
  /** 资产描述 */
  description: string;
  /** 是否衍生资产 */
  isDerivative: boolean;
  /** 视觉手册 ID */
  visualManualId: string;
  /** 身份锚点（仅角色） */
  identityAnchors?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** 现有负面提示词 */
  negativePrompt?: string;

  // ── 生成配置 ──
  /** 分辨率，默认 "2K" */
  resolution?: "1K" | "2K" | "4K";
  /** 宽高比，默认 "16:9" */
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  /** 参考图（base64 或 local-image://） */
  referenceImages?: string[];
  /** 是否跳过润色（已有 prompt 时） */
  skipPolish?: boolean;
  /** 已有的提示词（skipPolish=true 时使用） */
  existingPrompt?: string;
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
  try {
    // Phase 1: 提示词润色
    let prompt: string;
    let negativePrompt: string | undefined;
    let polishResult: PolishResult | undefined;

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

    // Phase 2: 图片生成
    onProgress?.({
      phase: "generating",
      message: `正在生成 ${task.name} 的图片...`,
      polishResult,
    });

    const imageResult = await aiManager.image(
      {
        prompt,
        negativePrompt,
        resolution: task.resolution ?? "2K",
        aspectRatio: task.aspectRatio ?? "16:9",
        referenceImages: task.referenceImages,
      },
      task.assetType === "character" ? "character" : "scene",
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

    const localPath = await saveImageToLocal(
      imageResult.imageUrl,
      categoryMap[task.assetType],
      `${task.name}-${Date.now()}`,
    );

    // Phase 4: 更新 Store
    updateStoreWithResult(task.assetId, task.assetType, {
      polishResult,
      imageLocalPath: localPath,
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
  const { batchPolishAssetPrompts } = await import("@/lib/ai/prompt-polisher");

  // 收集待润色资产
  const assets = collectPendingAssets(assetType);

  if (assets.length === 0) return { success: 0, failed: 0 };

  // 标记为 polishing
  markAssetsPolishing(assetType, assets);

  // 构建润色请求
  const requests: PolishRequest[] = assets.map((a) => ({
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
    onCancel: (key) => !!options?.onCancel?.(),
  });

  // 写回 Store
  let success = 0;
  let failed = 0;

  for (const [key, result] of results) {
    const assetName = key.split(":")[1];
    const asset = assets.find((a) => a.name === assetName);
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

function updateStoreWithResult(
  assetId: string,
  assetType: AssetType,
  data: { polishResult?: PolishResult; imageLocalPath: string },
) {
  if (assetType === "character") {
    const store = useCharacterLibraryStore.getState();

    // 更新提示词
    if (data.polishResult?.status === "success") {
      store.updateCharacter(assetId, {
        visualTraits: data.polishResult.prompt,
        promptState: "ready",
        negativePrompt: data.polishResult.negativePrompt
          ? { avoid: [data.polishResult.negativePrompt] }
          : undefined,
      });
    }

    // 添加图片视图
    store.addCharacterView(assetId, {
      viewType: "front",
      imageUrl: data.imageLocalPath,
    });

    // 设置缩略图
    store.updateCharacter(assetId, {
      thumbnailUrl: data.imageLocalPath,
    });
  } else if (assetType === "scene") {
    const store = useSceneStore.getState();

    if (data.polishResult?.status === "success") {
      store.updateScene(assetId, {
        visualPrompt: data.polishResult.prompt,
        promptState: "ready",
      });
    }

    store.updateScene(assetId, {
      referenceImage: data.imageLocalPath,
    });
  }
  // prop 待 Phase 3 实现
}

function writePolishResultToStore(
  assetId: string,
  assetType: AssetType,
  result: PolishResult,
) {
  if (assetType === "character") {
    useCharacterLibraryStore.getState().updateCharacter(assetId, {
      visualTraits: result.prompt,
      promptState: "ready",
      negativePrompt: result.negativePrompt
        ? { avoid: [result.negativePrompt] }
        : undefined,
    });
  } else if (assetType === "scene") {
    useSceneStore.getState().updateScene(assetId, {
      visualPrompt: result.prompt,
      promptState: "ready",
    });
  }
}

function writePolishErrorToStore(
  assetId: string,
  assetType: AssetType,
  error: string,
) {
  if (assetType === "character") {
    useCharacterLibraryStore.getState().updateCharacter(assetId, {
      promptState: "failed",
      promptError: error,
    });
  } else if (assetType === "scene") {
    useSceneStore.getState().updateScene(assetId, {
      promptState: "failed",
      promptError: error,
    });
  }
}

// ─── 资产收集辅助 ───

interface PendingAsset {
  id: string;
  name: string;
  description: string;
  identityAnchors?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function collectPendingAssets(assetType: AssetType): PendingAsset[] {
  if (assetType === "character") {
    const store = useCharacterLibraryStore.getState();
    return store.characters
      .filter((c) => !c.promptState || c.promptState === "none")
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        identityAnchors: c.identityAnchors,
      }));
  } else if (assetType === "scene") {
    const store = useSceneStore.getState();
    return store.scenes
      .filter((s) => !s.promptState || s.promptState === "none")
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: [s.location, s.time, s.atmosphere, s.notes].filter(Boolean).join(", "),
      }));
  }
  return [];
}

function markAssetsPolishing(assetType: AssetType, assets: PendingAsset[]) {
  if (assetType === "character") {
    const store = useCharacterLibraryStore.getState();
    for (const a of assets) {
      store.updateCharacter(a.id, { promptState: "polishing" });
    }
  } else if (assetType === "scene") {
    const store = useSceneStore.getState();
    for (const a of assets) {
      store.updateScene(a.id, { promptState: "polishing" });
    }
  }
}
