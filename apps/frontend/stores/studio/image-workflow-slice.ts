import { createImageWorkflowGraph, buildAssetImageWorkflowPatch, buildStoryboardImageWorkflowPatch } from "@/lib/studio/image-workflow";
import { assertImageWorkflowGraphMediaPersistable } from "./studio-store-persistence";
import { resolvePersistableAssetCurrentMediaPaths } from "@/components/panels/studio/workflow-asset-media-path";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { storyboardSourceFingerprint } from "./studio-store-continuity-helpers";

/**
 * Image-workflow slice —— 图像工作流的创建/更新/删除与结果回接分镜/资产。
 * 08-31 file-size-reduction zustand 专批:自 studio-store 内联 action 族抽出,
 * 体逐字保留;沿用 material-slice 的 set/get 注入模式。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImageWorkflowSliceStore = Record<string, any> & {
  imageWorkflows: any[];
};
type SetFn = (fn: (state: ImageWorkflowSliceStore) => Partial<ImageWorkflowSliceStore>) => void;
type GetFn = () => ImageWorkflowSliceStore;

export function createImageWorkflowSliceActions(set: SetFn, get: GetFn) {
  return {
      createImageWorkflow: (input = {}) => {
        const graph = createImageWorkflowGraph(input);
        set((state) => ({
          imageWorkflows: [
            graph,
            ...state.imageWorkflows.filter((item) => item.id !== graph.id),
          ],
        }));
        return graph.id;
      },

      upsertImageWorkflow: (graph) => {
        assertImageWorkflowGraphMediaPersistable(graph);
        set((state) => ({
          imageWorkflows: [
            graph,
            ...state.imageWorkflows.filter((item) => item.id !== graph.id),
          ],
        }));
      },

      updateImageWorkflow: (id, updates) => {
        set((state) => ({
          imageWorkflows: state.imageWorkflows.map((item) => {
            if (item.id !== id) return item;
            const graph = {
              ...item,
              ...updates,
              id: item.id,
              updatedAt: updates.updatedAt ?? Date.now(),
            };
            assertImageWorkflowGraphMediaPersistable(graph);
            return graph;
          }),
        }));
      },

      deleteImageWorkflow: (id) => {
        set((state) => ({
          imageWorkflows: state.imageWorkflows.filter((item) => item.id !== id),
        }));
      },

      applyImageWorkflowResultToStoryboard: (storyboardId, workflowId, nodeId) => {
        const graph = get().imageWorkflows.find((item) => item.id === workflowId);
        if (!graph) return;
        const patch = buildStoryboardImageWorkflowPatch(graph, nodeId);
        get().updateStoryboard(storyboardId, patch);
        if (patch.mediaRef) {
          const storyboard = get().storyboards.find((item) => item.id === storyboardId);
          const taskId = get().startMediaTask({
            kind: "storyboardImage",
            targetId: storyboardId,
            episodeId: storyboard?.episodeId,
            provider: "image",
            checkpointRef: `${workflowId}:${nodeId}`,
            inputFingerprint: storyboard ? storyboardSourceFingerprint(storyboard) : undefined,
          });
          get().finishMediaTask(taskId, {
            outputRef: patch.mediaRef.path,
            outputRefs: [patch.mediaRef.path, workflowId, nodeId],
            checkpointRef: `${workflowId}:${nodeId}`,
          });
        }
      },

      applyImageWorkflowResultToAsset: (target, workflowId, nodeId) => {
        if (target.kind !== "asset" || !target.assetType || !target.id) return;
        const graph = get().imageWorkflows.find((item) => item.id === workflowId);
        if (!graph) return;
        const patch = buildAssetImageWorkflowPatch(graph, nodeId);
        // 08-27 R1 父代锚:衍生变体落图时记录「这张图参照的父样子」——父当前
        // 媒体路径(v1 主判据)+ 父最新批准连续性指纹(加强判据,取不到就只写
        // 路径)。锚只写衍生记录:character 需 target.parentId、scene 记录需带
        // parentSceneId、prop 记录需带 parentId;父资产自身没有父,不写锚。
        // 08-27 二期 R2:父媒体路径改走共享候选解析(连续性最新批准图优先,
        // legacy 链兜底),与 WorkbenchTab.buildWorkbenchAssetMediaMap 同一函数,
        // 「两侧优先级必须一致」从注释约定升级为结构保证。
        const latestApprovedVersion = (assetId: string) => {
          const approved = get().continuityAssetVersions
            .filter((version) => version.assetId === assetId && version.approved)
            .sort((left, right) =>
              (right.approval?.reviewedAt ?? 0) - (left.approval?.reviewedAt ?? 0)
              || right.versionId.localeCompare(left.versionId),
            );
          return approved[0];
        };
        const latestApprovedFingerprint = (assetId: string) =>
          latestApprovedVersion(assetId)?.contentFingerprint;
        const buildParentAnchor = (
          parentMediaPath: string | undefined,
          parentFingerprint: string | undefined,
        ) =>
          parentMediaPath || parentFingerprint
            ? {
                ...(parentMediaPath ? { parentMediaPath } : {}),
                ...(parentFingerprint
                  ? { parentContinuityFingerprint: parentFingerprint }
                  : {}),
              }
            : undefined;
        if (target.assetType === "character") {
          if (!target.parentId) return;
          const parent = useCharacterLibraryStore
            .getState()
            .characters.find((char) => char.id === target.parentId);
          const parentMediaPath = parent
            ? resolvePersistableAssetCurrentMediaPaths({
                kind: "character",
                character: parent,
                latestApprovedVersion: latestApprovedVersion(parent.id),
              })[0]
            : undefined;
          useCharacterLibraryStore.getState().updateVariation(target.parentId, target.id, {
            referenceImage: patch.imageUrl,
            imageWorkflowId: patch.imageWorkflowId,
            imageWorkflowNodeId: patch.imageWorkflowNodeId,
            generatedAt: patch.generatedAt,
            ...(parent
              ? { parentAnchor: buildParentAnchor(parentMediaPath, latestApprovedFingerprint(parent.id)) }
              : {}),
          });
          return;
        }
        if (target.assetType === "scene") {
          const scene = useSceneStore.getState().scenes.find((item) => item.id === target.id);
          const parentScene = scene?.parentSceneId
            ? useSceneStore.getState().scenes.find((item) => item.id === scene.parentSceneId)
            : undefined;
          const parentMediaPath = parentScene
            ? resolvePersistableAssetCurrentMediaPaths({
                kind: "scene",
                scene: parentScene,
                latestApprovedVersion: latestApprovedVersion(parentScene.id),
              })[0]
            : undefined;
          useSceneStore.getState().updateScene(target.id, {
            referenceImage: patch.imageUrl,
            imageWorkflowId: patch.imageWorkflowId,
            imageWorkflowNodeId: patch.imageWorkflowNodeId,
            ...(parentScene
              ? { parentAnchor: buildParentAnchor(parentMediaPath, latestApprovedFingerprint(parentScene.id)) }
              : {}),
          });
          return;
        }
        const prop = usePropsLibraryStore.getState().items.find((item) => item.id === target.id);
        const parentProp = prop?.parentId
          ? usePropsLibraryStore.getState().items.find((item) => item.id === prop.parentId)
          : undefined;
        const parentMediaPath = parentProp
          ? resolvePersistableAssetCurrentMediaPaths({
              kind: "prop",
              prop: parentProp,
              latestApprovedVersion: latestApprovedVersion(parentProp.id),
            })[0]
          : undefined;
        usePropsLibraryStore.getState().updateProp(target.id, {
          imageUrl: patch.imageUrl,
          imageWorkflowId: patch.imageWorkflowId,
          imageWorkflowNodeId: patch.imageWorkflowNodeId,
          ...(parentProp
            ? { parentAnchor: buildParentAnchor(parentMediaPath, latestApprovedFingerprint(parentProp.id)) }
            : {}),
        });
      },
  };
}
