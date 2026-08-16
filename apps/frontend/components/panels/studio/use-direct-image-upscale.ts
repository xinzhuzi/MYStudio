import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  fetchActiveModel,
  guardUpscaleReadiness,
  upscaleProjectImage,
} from "./use-image-workflow-upscale";
import { useStudioStore } from "@/stores/studio/studio-store";
import { setGeneratedImageResult } from "@/lib/studio/image-workflow";
import {
  useCharacterLibraryStore,
} from "@/stores/library/character-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import type { StudioMaterial } from "@/types/studio";

export interface DirectAssetUpscaleTarget {
  assetType: "character" | "scene" | "prop";
  id: string;
  parentId?: string;
}

/**
 * Direct upscale actions for surfaces outside the image-workflow canvas:
 * storyboard tiles, asset cards, and material library rows. Each entry reuses
 * the same core (active model + project-file URL → ×4 sibling output) and
 * writes back through the existing store actions so review/reset semantics
 * stay identical to a manual regeneration.
 */
export function useDirectImageUpscale() {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const withBusy = useCallback(async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    try {
      await action();
    } finally {
      setBusyKey((current) => (current === key ? null : current));
    }
  }, []);

  const registerMaterial = useCallback((outputUrl: string, name: string, sizeBytes?: number) => {
    useStudioStore.getState().addMaterial({
      name: `${name}.png`,
      localPath: outputUrl,
      size: sizeBytes ?? 0,
    });
  }, []);

  const upscaleStoryboardImage = useCallback(async (storyboardId: string) => {
    const storyboard = useStudioStore.getState().storyboards.find((item) => item.id === storyboardId);
    const mediaRef = storyboard?.mediaRef;
    if (!storyboard || mediaRef?.kind !== "image" || !mediaRef.path) {
      toast.error("该分镜还没有绑定图片，无法超分");
      return;
    }
    if (!(await guardUpscaleReadiness())) return;
    await withBusy(`storyboard:${storyboardId}`, async () => {
      try {
        const activeModel = await fetchActiveModel();
        const title = (storyboard.prompt || storyboardId).slice(0, 24);
        const result = await upscaleProjectImage({
          imageUrl: mediaRef.path,
          title,
          idForFilename: storyboardId,
          shotId: storyboardId,
          activeModel,
        });
        useStudioStore.getState().bindStoryboardMedia(storyboardId, {
          kind: "image",
          path: result.outputUrl,
          contentSha256: result.artifact.outputSha256,
          ...(mediaRef.imageWorkflowId ? { imageWorkflowId: mediaRef.imageWorkflowId } : {}),
          ...(mediaRef.imageWorkflowNodeId ? { imageWorkflowNodeId: mediaRef.imageWorkflowNodeId } : {}),
        });
        const filename = result.outputRelativePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? title;
        registerMaterial(result.outputUrl, filename, result.artifact.outputBytes);
        toast.success(
          `分镜超分完成：${result.artifact.width}×${result.artifact.height}(视觉审核已重置，请重新确认)`,
        );
        // A1 修复:分镜超分后同步来源工作流节点,避免后续「写回目标」把 4K 打回 1K。
        if (mediaRef.imageWorkflowId && mediaRef.imageWorkflowNodeId) {
          const store = useStudioStore.getState();
          const graph = store.imageWorkflows.find((item) => item.id === mediaRef.imageWorkflowId);
          const node = graph?.nodes.find((item) => item.id === mediaRef.imageWorkflowNodeId);
          if (graph && node && node.type === "generated") {
            store.updateImageWorkflow(
              graph.id,
              setGeneratedImageResult(graph, mediaRef.imageWorkflowNodeId, {
                imageUrl: result.outputUrl,
              }),
            );
          }
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "分镜超分失败");
      }
    });
  }, [registerMaterial, withBusy]);

  const upscaleAssetImage = useCallback(async (target: DirectAssetUpscaleTarget, imageUrl: string) => {
    if (!imageUrl) {
      toast.error("该资产还没有图片，无法超分");
      return;
    }
    if (!(await guardUpscaleReadiness())) return;
    await withBusy(`asset:${target.id}`, async () => {
      try {
        const activeModel = await fetchActiveModel();
        const result = await upscaleProjectImage({
          imageUrl,
          title: target.id.slice(0, 24),
          idForFilename: target.id,
          activeModel,
        });
        if (target.assetType === "character") {
          if (!target.parentId) {
            toast.error("角色变体缺少父级，无法回写");
            return;
          }
          useCharacterLibraryStore.getState().updateVariation(target.parentId, target.id, {
            referenceImage: result.outputUrl,
          });
        } else if (target.assetType === "scene") {
          useSceneStore.getState().updateScene(target.id, {
            referenceImage: result.outputUrl,
          });
        } else {
          usePropsLibraryStore.getState().updateProp(target.id, {
            imageUrl: result.outputUrl,
          });
        }
        const filename = result.outputRelativePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? target.id;
        registerMaterial(result.outputUrl, filename, result.artifact.outputBytes);
        toast.success(`资产超分完成：${result.artifact.width}×${result.artifact.height}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "资产超分失败");
      }
    });
  }, [registerMaterial, withBusy]);

  const upscaleMaterialImage = useCallback(async (material: Pick<StudioMaterial, "id" | "localPath" | "name">) => {
    if (!material.localPath) {
      toast.error("素材没有本地文件，无法超分");
      return;
    }
    if (!(await guardUpscaleReadiness())) return;
    await withBusy(`material:${material.id}`, async () => {
      try {
        const activeModel = await fetchActiveModel();
        const result = await upscaleProjectImage({
          imageUrl: material.localPath,
          title: (material.name || material.id).replace(/\.[^.]+$/, "").slice(0, 24),
          idForFilename: material.id,
          activeModel,
        });
        const filename = result.outputRelativePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? material.name;
        registerMaterial(result.outputUrl, filename, result.artifact.outputBytes);
        toast.success(`素材超分完成：${result.artifact.width}×${result.artifact.height}，已加入素材库`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "素材超分失败");
      }
    });
  }, [registerMaterial, withBusy]);

  return {
    busyKey,
    upscaleStoryboardImage,
    upscaleAssetImage,
    upscaleMaterialImage,
  };
}
