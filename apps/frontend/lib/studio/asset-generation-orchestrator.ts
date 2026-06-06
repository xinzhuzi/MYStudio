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

  // 先匹配资产库，复用已有数据
  const { pending, matched } = await collectAndMatchAssets(assetType);

  let reusedCount = 0;
  if (matched.length > 0) {
    reusedCount = applyMatchedAssets(assetType, matched);
    console.log(`[asset-orchestrator] 从资产库复用了 ${reusedCount} 个${assetType === "character" ? "角色" : assetType === "scene" ? "场景" : "道具"}`);
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
    onCancel: (key) => !!options?.onCancel?.(),
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

/**
 * 从项目级 store 收集待润色资产，同时批量匹配资产库。
 * 匹配到的资产直接从资产库复用（prompt / 图片），不再重新润色/生成。
 * 返回 { pending: 需要润色的, matched: 已复用的 }
 */
export async function collectAndMatchAssets(
  assetType: AssetType,
): Promise<{ pending: PendingAsset[]; matched: Array<{ id: string; name: string; assetDbData: any }> }> {
  const all = collectPendingAssets(assetType);
  if (all.length === 0) return { pending: [], matched: [] };

  // 调 IPC 批量匹配资产库
  let matchedEntries: Array<{ name: string; asset: any }> = [];
  try {
    const dbType = assetType === "prop" ? "tool" : assetType === "character" ? "role" : assetType;
    matchedEntries = await window.studioAssets?.batchMatch({
      type: dbType,
      names: all.map(a => a.name),
    }) ?? [];
  } catch {
    matchedEntries = [];
  }

  const matchedMap = new Map<string, any>();
  for (const entry of matchedEntries) {
    if (entry?.name && entry?.asset) {
      matchedMap.set(entry.name, entry.asset);
    }
  }

  const matched: Array<{ id: string; name: string; assetDbData: any }> = [];
  const pending: PendingAsset[] = [];

  for (const asset of all) {
    const dbMatch = matchedMap.get(asset.name);
    if (dbMatch && dbMatch.filePath) {
      matched.push({ id: asset.id, name: asset.name, assetDbData: dbMatch });
    } else {
      pending.push(asset);
    }
  }

  return { pending, matched };
}

/**
 * 将资产库中匹配到的数据写入项目级 store（复用）
 */
export function applyMatchedAssets(
  assetType: AssetType,
  matched: Array<{ id: string; name: string; assetDbData: any }>,
): number {
  let applied = 0;
  for (const m of matched) {
    try {
      if (assetType === "character") {
        const store = useCharacterLibraryStore.getState();
        // 从资产库的 filePath 构造缩略图路径
        const thumbPath = m.assetDbData.thumbnailUrl || m.assetDbData.filePath;
        store.updateCharacter(m.id, {
          thumbnailUrl: thumbPath ? `local-image://${thumbPath}` : undefined,
          promptState: "ready",
          visualTraits: m.assetDbData.prompt || m.assetDbData.description || "",
        });
        if (thumbPath) {
          store.addCharacterView(m.id, {
            viewType: "front",
            imageUrl: `local-image://${thumbPath}`,
          });
        }
        applied++;
      } else if (assetType === "scene") {
        const store = useSceneStore.getState();
        const thumbPath = m.assetDbData.thumbnailUrl || m.assetDbData.filePath;
        store.updateScene(m.id, {
          referenceImage: thumbPath ? `local-image://${thumbPath}` : undefined,
          visualPrompt: m.assetDbData.prompt || m.assetDbData.description || "",
          promptState: "ready",
        });
        applied++;
      }
    } catch {
      // 跳过单个失败
    }
  }
  return applied;
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
