import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Connection } from "@xyflow/react";
import { toast } from "sonner";
import {
  addGeneratedImageNode,
  addStoryboardLayeredNodes as appendStoryboardLayeredNodes,
  addPromptImageNode,
  addReferenceImageNode,
  connectImageWorkflowNodes,
  createId,
  removeImageWorkflowEdge,
  removeImageWorkflowNode,
} from "@/lib/studio/image-workflow";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { storyboardSourceFingerprint } from "@/stores/studio/studio-store-continuity-helpers";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowOpenContext,
  StoryboardItem,
  StudioMaterial,
} from "@/types/studio";
import {
  findLinkedPromptNodeForGenerated,
  isAssetOpenContext,
  isSameImageWorkflowTarget,
  nextNodePosition,
} from "./image-workflow-graph-utils";
import {
  buildAssetLibraryPayloadForImageWorkflow,
  notifyAssetLibraryUpdated,
} from "./image-workflow-asset-bridge";
import {
  chapterScopeForWorkflowTarget,
  createWorkflowFilename,
  workflowImageRelativePath,
} from "./image-workflow-file-utils";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { landStoryboardContinuity } from "./land-continuity";

type StudioState = ReturnType<typeof useStudioStore.getState>;

type UseImageWorkflowActionsOptions = {
  activeGraph?: ImageWorkflowGraph;
  initialAssetContext?: ImageWorkflowOpenContext;
  projectName: string;
  imageWorkflowCount: number;
  storyboards: StoryboardItem[];
  targetStoryboardId: string;
  selectedNodeId: string | null;
  preferredGeneratedNodeId: string | null;
  selectedEdgeId: string | null;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  saveGraph: (graph: ImageWorkflowGraph) => void;
  addMaterial: StudioState["addMaterial"];
  createImageWorkflow: StudioState["createImageWorkflow"];
  updateImageWorkflow: StudioState["updateImageWorkflow"];
  applyImageWorkflowResultToAsset: StudioState["applyImageWorkflowResultToAsset"];
  applyImageWorkflowResultToStoryboard: StudioState["applyImageWorkflowResultToStoryboard"];
  setActiveWorkflowId: Dispatch<SetStateAction<string | null>>;
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  setPreferredGeneratedNodeId: Dispatch<SetStateAction<string | null>>;
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>;
};

export function useImageWorkflowActions({
  activeGraph,
  initialAssetContext,
  projectName,
  imageWorkflowCount,
  storyboards,
  targetStoryboardId,
  selectedNodeId,
  preferredGeneratedNodeId,
  selectedEdgeId,
  uploadInputRef,
  saveGraph,
  addMaterial,
  createImageWorkflow,
  updateImageWorkflow,
  applyImageWorkflowResultToAsset,
  applyImageWorkflowResultToStoryboard,
  setActiveWorkflowId,
  setSelectedNodeId,
  setPreferredGeneratedNodeId,
  setSelectedEdgeId,
}: UseImageWorkflowActionsOptions) {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);

  const createNewFlow = useCallback(() => {
    const id = createImageWorkflow({
      name: `${projectName} 图像工作流 ${imageWorkflowCount + 1}`,
      target: { kind: "free" },
    });
    setActiveWorkflowId(id);
    setSelectedNodeId(null);
    setPreferredGeneratedNodeId(null);
  }, [createImageWorkflow, imageWorkflowCount, projectName, setActiveWorkflowId, setPreferredGeneratedNodeId, setSelectedNodeId]);

  const bindTargetStoryboard = useCallback(() => {
    if (!activeGraph || !targetStoryboardId) return;
    const storyboard = storyboards.find((item) => item.id === targetStoryboardId);
    // 绑定分镜必须同步盖章指纹,否则会产出无指纹流——被水合清理当成上一代遗留丢弃
    const fingerprint = storyboard
      ? storyboard.sourceFingerprint ?? storyboardSourceFingerprint(storyboard)
      : undefined;
    updateImageWorkflow(activeGraph.id, {
      target: { kind: "storyboard", id: targetStoryboardId },
      ...(fingerprint ? { targetSourceFingerprint: fingerprint } : {}),
    });
    toast.success("已绑定分镜");
  }, [activeGraph, storyboards, targetStoryboardId, updateImageWorkflow]);

  const addReferenceFromMaterial = useCallback((material: StudioMaterial) => {
    if (!activeGraph) return;
    const id = createId("ref");
    saveGraph(addReferenceImageNode(activeGraph, {
      id,
      title: material.name,
      imageUrl: material.localPath,
      source: { kind: "material", id: material.id },
      position: nextNodePosition(activeGraph, "reference"),
    }));
    setSelectedNodeId(id);
  }, [activeGraph, saveGraph, setSelectedNodeId]);

  const addReferenceFromStoryboard = useCallback((storyboard: StoryboardItem) => {
    if (!activeGraph || !storyboard.mediaRef?.path) return;
    const id = createId("ref");
    saveGraph(addReferenceImageNode(activeGraph, {
      id,
      title: `分镜 ${storyboard.index}`,
      imageUrl: storyboard.mediaRef.path,
      source: { kind: "storyboard", id: storyboard.id },
      position: nextNodePosition(activeGraph, "reference"),
    }));
    setSelectedNodeId(id);
  }, [activeGraph, saveGraph, setSelectedNodeId]);

  // 分层节点对(08-19 multilayer Child3→UI 接线):背景板+人物净底两生成节点
  // (场景/角色 reference 各自连线=资产圣经自动生效),供原生分层生图流程。
  const addStoryboardLayeredPair = useCallback(() => {
    if (!activeGraph || activeGraph.target.kind !== "storyboard") return;
    const storyboard = storyboards.find((item) => item.id === activeGraph.target.id);
    if (!storyboard) return;
    const next = appendStoryboardLayeredNodes(activeGraph, { storyboard });
    saveGraph(next);
  }, [activeGraph, storyboards, saveGraph]);

  const addGeneratedNode = useCallback(() => {
    if (!activeGraph) return;
    const id = createId("gen");
    const promptId = createId("prompt");
    const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
    const targetStoryboard = storyboards.find((item) => item.id === targetStoryboardId);
    const targetAsset = activeGraph.target.kind === "asset"
      && initialAssetContext
      && isAssetOpenContext(initialAssetContext)
      && isSameImageWorkflowTarget(activeGraph.target, initialAssetContext.target)
      ? initialAssetContext
      : undefined;
    let next = addGeneratedImageNode(activeGraph, {
      id,
      title: targetAsset
        ? `${targetAsset.title} 成图`
        : targetStoryboard
          ? `分镜 ${targetStoryboard.index} 成图`
          : "生成图",
      prompt: targetAsset?.prompt ?? targetStoryboard?.prompt ?? "",
      aspectRatio: imageSettings.defaultAspectRatio,
      quality: "standard",
      position: nextNodePosition(activeGraph, "generated"),
    });
    next = addPromptImageNode(next, {
      id: promptId,
      title: "图片生成",
      prompt: targetAsset?.prompt ?? targetStoryboard?.prompt ?? "",
      aspectRatio: imageSettings.defaultAspectRatio,
      resolution: imageSettings.defaultResolution,
      quality: "standard",
      targetNodeId: id,
      position: {
        x: 560,
        y: 500 + activeGraph.nodes.filter((node) => node.type === "prompt").length * 320,
      },
    });
    next = connectImageWorkflowNodes(next, { source: promptId, target: id });
    saveGraph(next);
    setSelectedNodeId(promptId);
    setPreferredGeneratedNodeId(id);
  }, [activeGraph, initialAssetContext, saveGraph, setPreferredGeneratedNodeId, setSelectedNodeId, storyboards, targetStoryboardId]);

  const deleteNode = useCallback((nodeId: string) => {
    if (!activeGraph) return;
    saveGraph(removeImageWorkflowNode(activeGraph, nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    if (preferredGeneratedNodeId === nodeId) setPreferredGeneratedNodeId(null);
  }, [activeGraph, preferredGeneratedNodeId, saveGraph, selectedNodeId, setPreferredGeneratedNodeId, setSelectedNodeId]);

  const deleteSelectedEdge = useCallback(() => {
    if (!activeGraph || !selectedEdgeId) return;
    saveGraph(removeImageWorkflowEdge(activeGraph, selectedEdgeId));
    setSelectedEdgeId(null);
  }, [activeGraph, saveGraph, selectedEdgeId, setSelectedEdgeId]);

  const handleConnect = useCallback((connection: Connection) => {
    if (!activeGraph || !connection.source || !connection.target) return;
    saveGraph(connectImageWorkflowNodes(activeGraph, {
      source: connection.source,
      target: connection.target,
    }));
  }, [activeGraph, saveGraph]);

  const handleUploadReference = useCallback(async (file?: File) => {
    if (!file || !activeGraph) return;
    try {
      if (!activeProjectId) throw new Error("请先选择项目");
      const bytes = await file.arrayBuffer();
      const id = createId("ref");
      const chapterId = chapterScopeForWorkflowTarget(activeGraph.target, storyboards);
      const saved = await getProjectFilesBridge()?.writeBinary({
        projectId: activeProjectId,
        relativePath: workflowImageRelativePath(
          activeGraph.id,
          createWorkflowFilename("ref", id, file.name),
          chapterId,
        ),
        bytes,
      });
      if (!saved?.success || !saved.url) {
        throw new Error(saved?.error || "项目内参考图保存失败");
      }
      const materialId = addMaterial({
        name: file.name,
        localPath: saved.url,
        size: saved.size ?? file.size,
      });
      saveGraph(addReferenceImageNode(activeGraph, {
        id,
        title: file.name,
        imageUrl: saved.url,
        source: { kind: "material", id: materialId },
        position: nextNodePosition(activeGraph, "reference"),
      }));
      setSelectedNodeId(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "参考图导入失败");
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }, [activeGraph, activeProjectId, addMaterial, saveGraph, setSelectedNodeId, storyboards, uploadInputRef]);

  const applyNodeToStoryboard = useCallback((nodeId: string) => {
    if (!activeGraph) return;
    if (activeGraph.target.kind === "asset") {
      applyImageWorkflowResultToAsset(activeGraph.target, activeGraph.id, nodeId);
      toast.success("已回写到衍生资产");
      return;
    }
    const storyboardId = activeGraph.target.kind === "storyboard" && activeGraph.target.id
      ? activeGraph.target.id
      : targetStoryboardId;
    if (!storyboardId) {
      toast.error("请先选择要回写的分镜");
      return;
    }
    // 连续性接线(方案 2):媒体回写前先落三件套,回写的 freshWrite 清 stale
    landStoryboardContinuity(storyboardId, activeGraph.id, nodeId);
    applyImageWorkflowResultToStoryboard(storyboardId, activeGraph.id, nodeId);
    toast.success("已回写到分镜媒体");
  }, [activeGraph, applyImageWorkflowResultToAsset, applyImageWorkflowResultToStoryboard, targetStoryboardId]);

  const storeGeneratedNodeInAssetLibrary = useCallback(async (nodeId: string) => {
    const graph = useStudioStore.getState().imageWorkflows.find((item) => item.id === activeGraph?.id)
      ?? activeGraph;
    if (!graph || graph.target.kind !== "asset") return;
    const generatedNode = graph.nodes.find(
      (item): item is ImageWorkflowGeneratedNode => item.id === nodeId && item.type === "generated",
    );
    if (!generatedNode?.resultUrl) {
      toast.error("请先生成衍生图片");
      return;
    }
    const studioAssets = getStudioAssetsBridge();
    if (!studioAssets?.add) {
      toast.error("当前环境不支持资产库写入");
      return;
    }
    try {
      const promptNode = findLinkedPromptNodeForGenerated(graph, generatedNode.id);
      const payload = await buildAssetLibraryPayloadForImageWorkflow({
        target: graph.target,
        openContext: isAssetOpenContext(initialAssetContext) ? initialAssetContext : undefined,
        generatedNode,
        promptNode,
      });
      const existing = await studioAssets.getByName?.({
        type: payload.type,
        name: payload.name,
      });
      const asset = await studioAssets.add(payload);
      if (!asset) throw new Error("资产库写入失败");
      notifyAssetLibraryUpdated(asset);
      toast.success(existing ? "资产库已更新" : "已放入资产库");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "资产库写入失败");
    }
  }, [activeGraph, initialAssetContext]);

  return {
    createNewFlow,
    bindTargetStoryboard,
    addReferenceFromMaterial,
    addReferenceFromStoryboard,
    addGeneratedNode,
    addStoryboardLayeredPair,
    deleteNode,
    deleteSelectedEdge,
    handleConnect,
    handleUploadReference,
    applyNodeToStoryboard,
    storeGeneratedNodeInAssetLibrary,
  };
}
