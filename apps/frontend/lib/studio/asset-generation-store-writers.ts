import { maybeAutoDenoiseUrl } from "@/lib/ai/image-auto-denoise";
import { saveImageToLocal, type ImageCategory } from "@/lib/media/image-storage";
import { createAssetImageWorkflowGraph } from "@/lib/studio/image-workflow";
import { useProjectStore } from "@/stores/project/project-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore, type PropItem } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { AssetType, PolishResult } from "@/lib/ai/prompt-polisher";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { assetImageRelativePath, safePathSegment } from "@/lib/studio/chapter-paths";

/**
 * 资产生成写回族——结果写回 Store/衍生工作流补丁/润色落库/Pending 收集/图片入库。深网专批:vi.mock 命中面留在门面,写回族仅消费真实 bridge。体逐字保留。
 */
export function updateStoreWithResult(
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

export function buildGeneratedDerivativeWorkflowPatch(input: {
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

export function writePolishResultToStore(
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

export function writePolishErrorToStore(
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  identityAnchors?: any;
}

export function collectPendingAssets(assetType: AssetType): PendingAsset[] {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ pending: PendingAsset[]; matched: Array<{ id: string; name: string; assetDbData: any }> }> {
  const all = collectPendingAssets(assetType);
  if (all.length === 0) return { pending: [], matched: [] };

  // 调 IPC 批量匹配资产库
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let matchedEntries: Array<{ name: string; asset: any }> = [];
  try {
    const dbType = assetType === "prop" ? "tool" : assetType === "character" ? "role" : assetType;
    matchedEntries = await getStudioAssetsBridge()?.batchMatch({
      type: dbType,
      names: all.map(a => a.name),
    }) ?? [];
  } catch {
    matchedEntries = [];
  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matchedMap = new Map<string, any>();
  for (const entry of matchedEntries) {
    if (entry?.name && entry?.asset) {
      matchedMap.set(entry.name, entry.asset);
    }
  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export function toReusableAssetImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^(https?:|data:|blob:|file:|local-image:\/\/|project-file:\/\/)/.test(trimmed)) {
    return trimmed;
  }
  return `local-image://${trimmed}`;
}

export function markAssetsPolishing(assetType: AssetType, assets: PendingAsset[]) {
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

export function updateProp(assetId: string, updates: Partial<PropItem>) {
  usePropsLibraryStore.setState((state) => ({
    items: state.items.map((item) =>
      item.id === assetId
        ? { ...item, ...updates, updatedAt: Date.now() }
        : item,
    ),
  }));
}

export async function saveGeneratedAssetImage({
  source,
  assetType,
  assetId,
  assetName,
  projectId,
  isDerivative,
  chapterId,
  category,
}: {
  source: string;
  assetType: AssetType;
  assetId: string;
  assetName: string;
  projectId?: string;
  isDerivative: boolean;
  chapterId?: string;
  category: ImageCategory;
}) {
  const filename = `${safePathSegment(assetId, "asset")}-${safePathSegment(assetName, "asset")}-${Date.now()}.png`;
  // 生图落库自动去噪(噪点治理 08-29):资产图入库前统一过一道;失败原样(fail-open)
  source = await maybeAutoDenoiseUrl(source);
  if (!projectId) {
    if (isDerivative) {
      throw new Error("衍生资产图片必须保存到当前项目");
    }
    return saveImageToLocal(source, category, `${assetName}-${Date.now()}`);
  }
  const projectFiles = getProjectFilesBridge();
  if (projectId && projectFiles?.saveImage) {
    const saved = await projectFiles.saveImage({
      projectId,
      relativePath: assetImageRelativePath(assetType, filename, { chapterId, isDerivative }),
      source,
    });
    if (!saved.success || !saved.url) {
      throw new Error(saved.error || "项目内资产图片保存失败");
    }
    return saved.url;
  }

  throw new Error("当前环境不支持项目内资产图片保存");
}
