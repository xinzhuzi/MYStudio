/**
 * 资产生成编排服务
 *
 * 编排：提示词润色 → 图片生成 → 本地保存 → Store 更新
 *
 * 已有基础设施：
 * - aiManager.image(params, kind) → ImageGenerationResult { imageUrl, taskId? }
 * - projectFiles.saveImage(...) → project-file://... for project workflows
 * - saveImageToLocal(url, category, filename) → local-image://... fallback
 * - characterStore.addCharacterView(charId, { viewType, imageUrl })
 * - characterStore.updateCharacter(id, updates)
 * - sceneStore.updateScene(id, updates)
 */

import { aiManager, type AIBinding } from "@/lib/ai/ai-manager";
import {
  batchPolishAssetPrompts,
  polishAssetPrompt,
  type PolishRequest,
  type PolishResult,
  type AssetType,
} from "@/lib/ai/prompt-polisher";

export type { AssetType };
import { saveImageToLocal, type ImageCategory } from "@/lib/image-storage";
import { createAssetImageWorkflowGraph } from "@/lib/studio/image-workflow";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { usePropsLibraryStore, type PropItem } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { useStudioStore } from "@/stores/studio-store";
import type { ImageAspectRatio, ImageResolution } from "@/lib/ai/image-size-presets";

// ─── 类型定义 ───

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
  /** 视觉手册 ID */
  visualManualId: string;
  /** 身份锚点（仅角色） */
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

    const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
    const imageResult = await aiManager.image(
      {
        prompt,
        negativePrompt,
        resolution: task.resolution ?? imageSettings.defaultResolution,
        aspectRatio: task.aspectRatio ?? imageSettings.defaultAspectRatio,
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
  data: { polishResult?: PolishResult; imageLocalPath: string; imageWorkflowId?: string },
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
    const scene = store.getSceneById(assetId);

    if (data.polishResult?.status === "success") {
      store.updateScene(assetId, {
        visualPrompt: data.polishResult.prompt,
        promptState: "ready",
      });
    }

    store.updateScene(assetId, {
      referenceImage: data.imageLocalPath,
      ...buildGeneratedDerivativeWorkflowPatch({
        assetId,
        assetType: "scene",
        name: scene?.viewpointName || scene?.name || assetId,
        prompt: data.polishResult?.prompt || scene?.visualPrompt,
        resultImagePath: data.imageLocalPath,
        parentId: scene?.parentSceneId,
        sourceImagePath: scene?.parentSceneId
          ? store.getSceneById(scene.parentSceneId)?.referenceImage
          : undefined,
        imageWorkflowId: data.imageWorkflowId || scene?.imageWorkflowId,
      }),
    });
  } else if (assetType === "prop") {
    const store = usePropsLibraryStore.getState();
    const prop = store.getPropById(assetId);
    const promptUpdates =
      data.polishResult?.status === "success"
        ? {
            visualPrompt: data.polishResult.prompt,
            promptState: "ready" as const,
            promptError: undefined,
          }
        : {};
    updateProp(assetId, {
      ...promptUpdates,
      imageUrl: data.imageLocalPath,
      ...buildGeneratedDerivativeWorkflowPatch({
        assetId,
        assetType: "prop",
        name: prop?.category || prop?.name || assetId,
        prompt: data.polishResult?.prompt || prop?.visualPrompt,
        resultImagePath: data.imageLocalPath,
        parentId: prop?.parentId,
        sourceImagePath: prop?.parentId
          ? store.getPropById(prop.parentId)?.imageUrl
          : undefined,
        imageWorkflowId: data.imageWorkflowId || prop?.imageWorkflowId,
      }),
    });
  }
}

function buildGeneratedDerivativeWorkflowPatch(input: {
  assetId: string;
  assetType: "scene" | "prop";
  name: string;
  prompt?: string;
  resultImagePath: string;
  parentId?: string;
  sourceImagePath?: string;
  imageWorkflowId?: string;
}) {
  if (!input.parentId) return {};
  const graph = createAssetImageWorkflowGraph(
    {
      target: {
        kind: "asset",
        assetType: input.assetType,
        parentId: input.parentId,
        id: input.assetId,
      },
      title: input.name,
      prompt: input.prompt,
      sourceImagePath: input.sourceImagePath,
      resultImagePath: input.resultImagePath,
      imageWorkflowId: input.imageWorkflowId,
    },
    useProjectStore.getState().activeProject?.name || "MYStudio",
  );
  const generatedNode = graph.nodes.find((node) => node.type === "generated");
  if (!generatedNode) return {};
  useStudioStore.getState().upsertImageWorkflow(graph);
  return {
    imageWorkflowId: graph.id,
    imageWorkflowNodeId: generatedNode.id,
  };
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
  } else if (assetType === "prop") {
    updateProp(assetId, {
      visualPrompt: result.prompt,
      promptState: "ready",
      promptError: undefined,
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
  } else if (assetType === "prop") {
    updateProp(assetId, {
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
  identityAnchors?: any;
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
  } else if (assetType === "prop") {
    const store = usePropsLibraryStore.getState();
    return store.items
      .filter((p) => !p.promptState || p.promptState === "none")
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
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
        const thumbPath = toReusableAssetImageUrl(
          m.assetDbData.thumbnailUrl || m.assetDbData.filePath,
        );
        store.updateCharacter(m.id, {
          thumbnailUrl: thumbPath,
          promptState: "ready",
          visualTraits: m.assetDbData.prompt || m.assetDbData.description || "",
        });
        if (thumbPath) {
          store.addCharacterView(m.id, {
            viewType: "front",
            imageUrl: thumbPath,
          });
        }
        applied++;
      } else if (assetType === "scene") {
        const store = useSceneStore.getState();
        const thumbPath = toReusableAssetImageUrl(
          m.assetDbData.thumbnailUrl || m.assetDbData.filePath,
        );
        store.updateScene(m.id, {
          referenceImage: thumbPath,
          visualPrompt: m.assetDbData.prompt || m.assetDbData.description || "",
          promptState: "ready",
        });
        applied++;
      } else if (assetType === "prop") {
        const thumbPath = toReusableAssetImageUrl(
          m.assetDbData.thumbnailUrl || m.assetDbData.filePath,
        );
        updateProp(m.id, {
          imageUrl: thumbPath || "",
          visualPrompt: m.assetDbData.prompt || m.assetDbData.description || "",
          promptState: "ready",
          promptError: undefined,
        });
        applied++;
      }
    } catch {
      // 跳过单个失败
    }
  }
  return applied;
}

function toReusableAssetImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^(https?:|data:|blob:|file:|local-image:\/\/|project-file:\/\/)/.test(trimmed)) {
    return trimmed;
  }
  return `local-image://${trimmed}`;
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
  } else if (assetType === "prop") {
    for (const a of assets) {
      updateProp(a.id, { promptState: "polishing" });
    }
  }
}

function updateProp(assetId: string, updates: Partial<PropItem>) {
  usePropsLibraryStore.setState((state) => ({
    items: state.items.map((item) =>
      item.id === assetId
        ? { ...item, ...updates, updatedAt: Date.now() }
        : item,
    ),
  }));
}

async function saveGeneratedAssetImage({
  source,
  assetType,
  assetId,
  assetName,
  projectId,
  isDerivative,
  category,
}: {
  source: string;
  assetType: AssetType;
  assetId: string;
  assetName: string;
  projectId?: string;
  isDerivative: boolean;
  category: ImageCategory;
}) {
  const filename = `${safePathSegment(assetId)}-${safePathSegment(assetName)}-${Date.now()}.png`;
  if (!projectId) {
    if (isDerivative) {
      throw new Error("衍生资产图片必须保存到当前项目");
    }
    return saveImageToLocal(source, category, `${assetName}-${Date.now()}`);
  }
  if (projectId && window.projectFiles?.saveImage) {
    const saved = await window.projectFiles.saveImage({
      projectId,
      relativePath: `workflow-images/assets/${assetType}/${filename}`,
      source,
    });
    if (!saved.success || !saved.url) {
      throw new Error(saved.error || "项目内资产图片保存失败");
    }
    return saved.url;
  }

  throw new Error("当前环境不支持项目内资产图片保存");
}

function safePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "asset";
}
