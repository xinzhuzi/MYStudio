import { getAbsoluteImagePath } from "@/lib/image-storage";
import { eventBus } from "@/lib/event-bus";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import type {
  AssetImageWorkflowContext,
  ImageWorkflowAssetTargetType,
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowPromptNode,
} from "@/types/studio";
import type { StudioAssetKind, StudioAssetSummary } from "@/types/studio-assets";

export type ImageWorkflowAssetLibraryPayload = {
  type: StudioAssetKind;
  name: string;
  sourceFilePath: string;
  description?: string;
  prompt?: string;
  setting?: string;
};

export async function buildAssetLibraryPayloadForImageWorkflow({
  target,
  openContext,
  generatedNode,
  promptNode,
}: {
  target: ImageWorkflowGraph["target"];
  openContext?: AssetImageWorkflowContext;
  generatedNode: ImageWorkflowGeneratedNode;
  promptNode?: ImageWorkflowPromptNode;
}): Promise<ImageWorkflowAssetLibraryPayload> {
  if (target.kind !== "asset") throw new Error("当前图片工作流不是衍生资产");
  const sourceFilePath = await resolveAssetLibrarySourceFilePath(generatedNode.resultUrl);
  if (!sourceFilePath) throw new Error("生成图片未保存为可入库文件");
  const metadata = resolveAssetLibraryMetadata(target, openContext, generatedNode, promptNode);
  return {
    type: imageWorkflowAssetTypeToLibraryKind(target.assetType),
    name: metadata.name,
    sourceFilePath,
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.prompt ? { prompt: metadata.prompt } : {}),
    ...(metadata.setting ? { setting: metadata.setting } : {}),
  };
}

function resolveAssetLibraryMetadata(
  target: ImageWorkflowGraph["target"],
  openContext: AssetImageWorkflowContext | undefined,
  generatedNode: ImageWorkflowGeneratedNode,
  promptNode?: ImageWorkflowPromptNode,
) {
  const fallbackTitle = openContext?.title || generatedNode.title || "衍生资产";
  const fallbackPrompt = openContext?.prompt || promptNode?.prompt || generatedNode.prompt;
  if (target.assetType === "character") {
    const store = useCharacterLibraryStore.getState();
    const character = target.parentId
      ? store.getCharacterById(target.parentId)
      : target.id ? store.getCharacterById(target.id) : undefined;
    const variation = target.parentId && target.id
      ? store.getVariationById(target.parentId, target.id)
      : undefined;
    const variationName = variation?.name || fallbackTitle;
    return {
      name: compactText([character?.name, variationName], " · ") || fallbackTitle,
      description: compactText([
        variation?.stageDescription,
        character?.description,
        character?.appearance,
        character?.notes,
      ], "。") || fallbackPrompt,
      prompt: variation?.visualPromptZh || variation?.visualPrompt || character?.visualTraits || fallbackPrompt,
      setting: compactText([
        character?.role,
        character?.gender,
        character?.age,
        character?.traits,
        character?.personality,
      ], "。"),
    };
  }
  if (target.assetType === "scene") {
    const store = useSceneStore.getState();
    const scene = target.id ? store.getSceneById(target.id) : undefined;
    const parentScene = scene?.parentSceneId
      ? store.getSceneById(scene.parentSceneId)
      : target.parentId ? store.getSceneById(target.parentId) : undefined;
    return {
      name: scene?.name || fallbackTitle,
      description: compactText([scene?.location, scene?.time, scene?.atmosphere, scene?.notes], "，") || fallbackPrompt,
      prompt: scene?.visualPrompt || fallbackPrompt,
      setting: compactText([
        parentScene?.name ? `父场景：${parentScene.name}` : "",
        scene?.viewpointName,
        scene?.architectureStyle,
        scene?.spatialLayout,
        scene?.lightingDesign,
        scene?.colorPalette,
      ], "。"),
    };
  }
  if (target.assetType === "prop") {
    const store = usePropsLibraryStore.getState();
    const prop = target.id ? store.getPropById(target.id) : undefined;
    const parentProp = prop?.parentId
      ? store.getPropById(prop.parentId)
      : target.parentId ? store.getPropById(target.parentId) : undefined;
    return {
      name: prop?.name || fallbackTitle,
      description: prop?.description || fallbackPrompt,
      prompt: prop?.visualPrompt || fallbackPrompt,
      setting: compactText([
        parentProp?.name ? `父道具：${parentProp.name}` : "",
        prop?.category,
      ], "。"),
    };
  }
  throw new Error("资产工作流缺少资产类型");
}

export function imageWorkflowAssetTypeToLibraryKind(
  assetType?: ImageWorkflowAssetTargetType,
): StudioAssetKind {
  if (assetType === "character") return "role";
  if (assetType === "scene") return "scene";
  if (assetType === "prop") return "tool";
  throw new Error("资产工作流缺少资产类型");
}

export async function resolveAssetLibrarySourceFilePath(image?: string) {
  if (!image) return undefined;
  if (image.startsWith("project-file://")) {
    return (await window.projectFiles?.getAbsolutePath?.(image)) ?? undefined;
  }
  if (image.startsWith("local-image://")) {
    return (await getAbsoluteImagePath(image)) ?? undefined;
  }
  if (image.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(image).pathname);
    } catch {
      return undefined;
    }
  }
  if (image.startsWith("/")) return image;
  return undefined;
}

export function notifyAssetLibraryUpdated(asset: StudioAssetSummary) {
  eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
}

function compactText(parts: Array<string | undefined>, separator: string) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(separator);
}
