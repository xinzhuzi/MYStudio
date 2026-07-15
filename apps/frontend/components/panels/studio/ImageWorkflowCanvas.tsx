import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Connection,
  type Edge,
  type ReactFlowInstance,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Plus,
  Save,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  buildImageWorkflowGenerationRequest,
  assertImageWorkflowContinuityCapability,
  connectImageWorkflowNodes,
  createAssetImageWorkflowGraph,
  createImageWorkflowGraph,
  createId,
  ensureImageWorkflowPromptNodes,
  ensureAssetImageWorkflowGraph,
  removeImageWorkflowEdge,
  removeImageWorkflowNode,
  setGeneratedImageResult,
  setGeneratedImageStatus,
  updateImageWorkflowNode,
  updateImageWorkflowNodePosition,
} from "@/lib/studio/image-workflow";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowOpenContext,
  ImageWorkflowPromptNode,
  AssetImageWorkflowContext,
  StoryboardItem,
  StudioMaterial,
} from "@/types/studio";
import { cn } from "@/lib/utils";
import {
  ImageWorkflowNodeCard,
  type ImageWorkflowNodeData,
  type ImageWorkflowReactNode,
} from "./image-workflow-node-card";
import {
  ImageWorkflowPaletteImageButton,
  ImageWorkflowPaletteSection,
} from "./image-workflow-palette";
import {
  assetTargetLabel,
  assetWorkflowContextKey,
  createOpenImageWorkflowGraph,
  findLinkedPromptNodeForGenerated,
  focusNodeIdsForGenerated,
  imageWorkflowTargetKey,
  isAssetOpenContext,
  isSameImageWorkflowTarget,
  nextNodePosition,
  openContextTargetLabel,
  resolveActionGeneratedNode,
  resolveGenerationTargetNodeId,
  resolveOpenContextGeneratedNodeId,
  workflowTargetLabel,
} from "./image-workflow-graph-utils";
import {
  buildAssetLibraryPayloadForImageWorkflow,
  notifyAssetLibraryUpdated,
} from "./image-workflow-asset-bridge";
import {
  createWorkflowFilename,
  prepareReferenceImages,
  workflowImageRelativePath,
} from "./image-workflow-file-utils";
import { ImageWorkflowScopedPending } from "./image-workflow-scoped-pending";

const nodeTypes = { imageWorkflow: ImageWorkflowNodeCard };
const FIT_VIEW_OPTIONS = { padding: 0.18, minZoom: 0.35, maxZoom: 1.1 } as const;

export function ImageWorkflowCanvas({
  projectName,
  initialAssetContext,
  onBack,
}: {
  projectName: string;
  initialAssetContext?: ImageWorkflowOpenContext;
  onBack?: () => void;
}) {
  const {
    imageWorkflows,
    materials,
    storyboards,
    addMaterial,
    createImageWorkflow,
    upsertImageWorkflow,
    updateImageWorkflow,
    applyImageWorkflowResultToAsset,
    applyImageWorkflowResultToStoryboard,
  } = useStudioStore();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [preferredGeneratedNodeId, setPreferredGeneratedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [targetStoryboardId, setTargetStoryboardId] = useState("");
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ImageWorkflowReactNode, Edge> | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const handledAssetContextKeyRef = useRef("");
  const activeGraphTargetKeyRef = useRef("");
  const isScopedWorkflowDetail = Boolean(initialAssetContext);

  const scopedWorkflow = useMemo(
    () =>
      initialAssetContext
        ? initialAssetContext.imageWorkflowId
          ? imageWorkflows.find((item) => item.id === initialAssetContext.imageWorkflowId)
          : imageWorkflows.find((item) =>
              isSameImageWorkflowTarget(item.target, initialAssetContext.target),
            )
        : undefined,
    [imageWorkflows, initialAssetContext],
  );
  const activeGraph = useMemo(
    () => {
      const selectedGraph = activeWorkflowId
        ? imageWorkflows.find((item) => item.id === activeWorkflowId)
        : undefined;
      return isScopedWorkflowDetail
        ? selectedGraph && selectedGraph.id === scopedWorkflow?.id
          ? selectedGraph
          : scopedWorkflow
        : selectedGraph ?? imageWorkflows[0];
    },
    [activeWorkflowId, imageWorkflows, isScopedWorkflowDetail, scopedWorkflow],
  );
  const imageMaterials = useMemo(
    () => materials.filter((item) => item.kind === "image"),
    [materials],
  );
  const storyboardImages = useMemo(
    () => storyboards.filter((item) => item.mediaRef?.kind === "image" && item.mediaRef.path),
    [storyboards],
  );
  const sourceLabel = initialAssetContext?.sourceLabel || initialAssetContext?.title || "当前图片工作流";
  const sourceStageLabel = initialAssetContext?.sourceStageLabel;
  const activeGeneratedNode = useMemo(
    () =>
      activeGraph
        ? resolveActionGeneratedNode(activeGraph, selectedNodeId, preferredGeneratedNodeId)
        : undefined,
    [activeGraph, preferredGeneratedNodeId, selectedNodeId],
  );
  const focusedFitNodeIds = useMemo(
    () =>
      activeGraph && activeGeneratedNode
        ? focusNodeIdsForGenerated(activeGraph, activeGeneratedNode.id)
        : [],
    [activeGeneratedNode, activeGraph],
  );
  const focusedFitNodeKey = focusedFitNodeIds.join("|");
  const workflowWritebackTargetLabel = useMemo(
    () =>
      activeGraph
        ? workflowTargetLabel(
            activeGraph,
            isAssetOpenContext(initialAssetContext) ? initialAssetContext : undefined,
            storyboards,
            targetStoryboardId,
          )
        : "未绑定目标",
    [activeGraph, initialAssetContext, storyboards, targetStoryboardId],
  );
  const scopedPendingWritebackTargetLabel = useMemo(
    () =>
      initialAssetContext
        ? openContextTargetLabel(initialAssetContext, storyboards)
        : "未绑定目标",
    [initialAssetContext, storyboards],
  );
  const selectedGenerationBusy =
    activeGeneratedNode?.status === "generating" ||
    activeGeneratedNode?.status === "queued";
  const canUseGlobalWorkflowControls = !isScopedWorkflowDetail;

  useEffect(() => {
    if (activeGraph) {
      if (activeWorkflowId !== activeGraph.id) setActiveWorkflowId(activeGraph.id);
      return;
    }
    if (initialAssetContext) return;
    const id = createImageWorkflow({
      name: `${projectName} 图像工作流`,
      target: { kind: "free" },
    });
    setActiveWorkflowId(id);
  }, [activeGraph, activeWorkflowId, createImageWorkflow, initialAssetContext, projectName]);

  useEffect(() => {
    if (!activeGraph) return;
    const ensured = ensureImageWorkflowPromptNodes(activeGraph);
    if (ensured !== activeGraph) upsertImageWorkflow(ensured);
  }, [activeGraph, upsertImageWorkflow]);

  useEffect(() => {
    if (!activeGraph) return;
    const targetKey = `${activeGraph.id}|${imageWorkflowTargetKey(activeGraph.target)}`;
    if (activeGraphTargetKeyRef.current === targetKey) return;
    activeGraphTargetKeyRef.current = targetKey;
    setTargetStoryboardId(
      activeGraph.target.kind === "storyboard" && activeGraph.target.id
        ? activeGraph.target.id
        : "",
    );
  }, [activeGraph]);

  useEffect(() => {
    if (!initialAssetContext) return;
    const contextKey = assetWorkflowContextKey(initialAssetContext);
    if (
      handledAssetContextKeyRef.current === contextKey &&
      activeGraph &&
      isSameImageWorkflowTarget(activeGraph.target, initialAssetContext.target)
    ) {
      return;
    }
    const existing = initialAssetContext.imageWorkflowId
      ? imageWorkflows.find((graph) => graph.id === initialAssetContext.imageWorkflowId)
      : imageWorkflows.find((graph) =>
          isSameImageWorkflowTarget(graph.target, initialAssetContext.target),
        );
    if (existing) {
      const ensured = ensureImageWorkflowPromptNodes(
        isAssetOpenContext(initialAssetContext)
          ? ensureAssetImageWorkflowGraph(existing, initialAssetContext)
          : existing,
      );
      if (ensured !== existing) upsertImageWorkflow(ensured);
      setActiveWorkflowId(existing.id);
      const selectedId = resolveOpenContextGeneratedNodeId(ensured, initialAssetContext);
      setSelectedNodeId(selectedId);
      setPreferredGeneratedNodeId(selectedId);
      handledAssetContextKeyRef.current = contextKey;
      return;
    }
    const graph = isAssetOpenContext(initialAssetContext)
      ? createAssetImageWorkflowGraph(initialAssetContext, projectName)
      : createOpenImageWorkflowGraph(initialAssetContext, projectName);
    upsertImageWorkflow(graph);
    setActiveWorkflowId(graph.id);
    const selectedId = resolveOpenContextGeneratedNodeId(graph, initialAssetContext);
    setSelectedNodeId(selectedId);
    setPreferredGeneratedNodeId(selectedId);
    handledAssetContextKeyRef.current = contextKey;
  }, [activeGraph, imageWorkflows, initialAssetContext, projectName, upsertImageWorkflow]);

  const saveGraph = useCallback(
    (graph: ImageWorkflowGraph) => {
      upsertImageWorkflow(graph);
    },
    [upsertImageWorkflow],
  );

  const updateNode = useCallback(
    (nodeId: string, updates: Partial<ImageWorkflowNode>) => {
      if (!activeGraph) return;
      saveGraph(updateImageWorkflowNode(activeGraph, nodeId, updates));
    },
    [activeGraph, saveGraph],
  );

  const reactFlowEdges = useMemo<Edge[]>(
    () =>
      (activeGraph?.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#67e8f9" },
        style: {
          stroke: edge.id === selectedEdgeId ? "#fbbf24" : "#67e8f9",
          strokeWidth: edge.id === selectedEdgeId ? 3 : 2,
        },
      })),
    [activeGraph?.edges, selectedEdgeId],
  );

  const createNewFlow = useCallback(() => {
    const id = createImageWorkflow({
      name: `${projectName} 图像工作流 ${imageWorkflows.length + 1}`,
      target: { kind: "free" },
    });
    setActiveWorkflowId(id);
    setSelectedNodeId(null);
    setPreferredGeneratedNodeId(null);
  }, [createImageWorkflow, imageWorkflows.length, projectName]);

  const bindTargetStoryboard = useCallback(() => {
    if (!activeGraph || !targetStoryboardId) return;
    updateImageWorkflow(activeGraph.id, { target: { kind: "storyboard", id: targetStoryboardId } });
    toast.success("已绑定分镜");
  }, [activeGraph, targetStoryboardId, updateImageWorkflow]);

  const addReferenceFromMaterial = useCallback(
    (material: StudioMaterial) => {
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
    },
    [activeGraph, saveGraph],
  );

  const addReferenceFromStoryboard = useCallback(
    (storyboard: StoryboardItem) => {
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
    },
    [activeGraph, saveGraph],
  );

  const addGeneratedNode = useCallback(() => {
    if (!activeGraph) return;
    const id = createId("gen");
    const promptId = createId("prompt");
    const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
    const targetStoryboard = storyboards.find((item) => item.id === targetStoryboardId);
    const targetAsset =
      activeGraph.target.kind === "asset" &&
      initialAssetContext &&
      isAssetOpenContext(initialAssetContext) &&
      isSameImageWorkflowTarget(activeGraph.target, initialAssetContext.target)
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
      position: { x: 560, y: 500 + activeGraph.nodes.filter((node) => node.type === "prompt").length * 320 },
    });
    next = connectImageWorkflowNodes(next, {
      source: promptId,
      target: id,
    });
    saveGraph(next);
    setSelectedNodeId(promptId);
    setPreferredGeneratedNodeId(id);
  }, [activeGraph, initialAssetContext, saveGraph, storyboards, targetStoryboardId]);

  const deleteNode = useCallback(
    (nodeId: string) => {
      if (!activeGraph) return;
      saveGraph(removeImageWorkflowNode(activeGraph, nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      if (preferredGeneratedNodeId === nodeId) setPreferredGeneratedNodeId(null);
    },
    [activeGraph, preferredGeneratedNodeId, saveGraph, selectedNodeId],
  );

  const deleteSelectedEdge = useCallback(() => {
    if (!activeGraph || !selectedEdgeId) return;
    saveGraph(removeImageWorkflowEdge(activeGraph, selectedEdgeId));
    setSelectedEdgeId(null);
  }, [activeGraph, saveGraph, selectedEdgeId]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!activeGraph || !connection.source || !connection.target) return;
      saveGraph(connectImageWorkflowNodes(activeGraph, {
        source: connection.source,
        target: connection.target,
      }));
    },
    [activeGraph, saveGraph],
  );

  const handleUploadReference = useCallback(
    async (file?: File) => {
      if (!file || !activeGraph) return;
      try {
        if (!activeProjectId) throw new Error("请先选择项目");
        const bytes = await file.arrayBuffer();
        const id = createId("ref");
        const saved = await window.projectFiles?.writeBinary({
          projectId: activeProjectId,
          relativePath: workflowImageRelativePath(activeGraph.id, createWorkflowFilename("ref", id, file.name)),
          bytes,
        });
        if (!saved?.success || !saved.url) {
          throw new Error(saved?.error || "项目内参考图保存失败");
        }
        const imageUrl = saved.url;
        const materialId = addMaterial({
          name: file.name,
          localPath: imageUrl,
          size: saved?.size ?? file.size,
        });
        saveGraph(addReferenceImageNode(activeGraph, {
          id,
          title: file.name,
          imageUrl,
          source: { kind: "material", id: materialId },
          position: nextNodePosition(activeGraph, "reference"),
        }));
        setSelectedNodeId(id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "参考图导入失败");
      } finally {
        if (uploadInputRef.current) uploadInputRef.current.value = "";
      }
    },
    [activeGraph, activeProjectId, addMaterial, saveGraph],
  );

  const generateNode = useCallback(
    async (nodeId: string) => {
      const graph = useStudioStore.getState().imageWorkflows.find((item) => item.id === activeGraph?.id);
      if (!graph) return;
      const targetNodeId = resolveGenerationTargetNodeId(graph, nodeId);
      if (!targetNodeId) {
        toast.error("未找到要生成的图片节点");
        return;
      }
      const request = buildImageWorkflowGenerationRequest(graph, targetNodeId);
      if (!request.prompt.trim()) {
        toast.error("请先填写生成提示词");
        return;
      }
      assertImageWorkflowContinuityCapability(request);
      saveGraph(setGeneratedImageStatus(graph, targetNodeId, "generating"));
      try {
        const projectId = useProjectStore.getState().activeProjectId;
        if (!projectId) throw new Error("请先选择项目");
        const referenceImages = await prepareReferenceImages(request.referenceImages);
        const result = await aiManager.freedomImage({
          prompt: request.prompt,
          model: request.model,
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          negativePrompt: request.negativePrompt,
          referenceImages,
          extraParams: request.quality === "hd" ? { quality: "hd" } : undefined,
        });
        const node = graph.nodes.find((item) => item.id === targetNodeId);
        const saved = await window.projectFiles?.saveImage({
          projectId,
          relativePath: workflowImageRelativePath(graph.id, createWorkflowFilename("gen", targetNodeId, `${node?.title || "workflow-image"}.png`)),
          source: result.url,
        });
        if (!saved?.success || !saved.url) {
          throw new Error(saved?.error || "项目内图片保存失败");
        }
        const localPath = saved.url;
        const materialId = addMaterial({
          name: `${node?.title || "workflow-image"}.png`,
          localPath,
          size: saved.size ?? 0,
        });
        const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
        saveGraph(setGeneratedImageResult(latest, targetNodeId, {
          imageUrl: localPath,
          mediaId: materialId ?? result.mediaId,
        }));
        toast.success("图片已生成并保存到当前项目");
      } catch (error) {
        const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
        saveGraph(setGeneratedImageStatus(latest, targetNodeId, "failed", error instanceof Error ? error.message : "生成失败"));
        toast.error(error instanceof Error ? error.message : "生成失败");
      }
    },
    [activeGraph?.id, addMaterial, saveGraph],
  );

  const applyNodeToStoryboard = useCallback(
    (nodeId: string) => {
      if (!activeGraph) return;
      if (activeGraph.target.kind === "asset") {
        applyImageWorkflowResultToAsset(activeGraph.target, activeGraph.id, nodeId);
        toast.success("已回写到衍生资产");
        return;
      }
      const storyboardId =
        activeGraph.target.kind === "storyboard" && activeGraph.target.id
          ? activeGraph.target.id
          : targetStoryboardId;
      if (!storyboardId) {
        toast.error("请先选择要回写的分镜");
        return;
      }
      applyImageWorkflowResultToStoryboard(storyboardId, activeGraph.id, nodeId);
      toast.success("已回写到分镜媒体");
    },
    [
      activeGraph,
      applyImageWorkflowResultToAsset,
      applyImageWorkflowResultToStoryboard,
      targetStoryboardId,
    ],
  );

  const storeGeneratedNodeInAssetLibrary = useCallback(
    async (nodeId: string) => {
      const graph =
        useStudioStore.getState().imageWorkflows.find((item) => item.id === activeGraph?.id) ??
        activeGraph;
      if (!graph || graph.target.kind !== "asset") return;
      const generatedNode = graph.nodes.find(
        (item): item is ImageWorkflowGeneratedNode =>
          item.id === nodeId && item.type === "generated",
      );
      if (!generatedNode?.resultUrl) {
        toast.error("请先生成衍生图片");
        return;
      }
      if (!window.studioAssets?.add) {
        toast.error("当前环境不支持资产库写入");
        return;
      }
      try {
        const promptNode = findLinkedPromptNodeForGenerated(graph, generatedNode.id);
        const payload = await buildAssetLibraryPayloadForImageWorkflow({
          target: graph.target,
          openContext: isAssetOpenContext(initialAssetContext)
            ? initialAssetContext
            : undefined,
          generatedNode,
          promptNode,
        });
        const existing = await window.studioAssets.getByName?.({
          type: payload.type,
          name: payload.name,
        });
        const asset = await window.studioAssets.add(payload);
        if (!asset) throw new Error("资产库写入失败");
        notifyAssetLibraryUpdated(asset);
        toast.success(existing ? "资产库已更新" : "已放入资产库");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "资产库写入失败");
      }
    },
    [activeGraph, initialAssetContext],
  );

  const reactFlowNodes = useMemo<ImageWorkflowReactNode[]>(
    () =>
      (activeGraph?.nodes ?? []).map((node) => ({
        id: node.id,
        type: "imageWorkflow",
        position: node.position,
        data: {
          node,
          promptNode:
            node.type === "generated" && activeGraph
              ? findLinkedPromptNodeForGenerated(activeGraph, node.id)
              : undefined,
          selected: node.id === selectedNodeId,
          storyboards,
          onUpdate: updateNode,
          onGenerate: (nodeId: string) => void generateNode(nodeId),
          onApplyToStoryboard: (nodeId: string) => applyNodeToStoryboard(nodeId),
          onDelete: (nodeId: string) => deleteNode(nodeId),
        },
      })),
    [
      activeGraph,
      applyNodeToStoryboard,
      deleteNode,
      generateNode,
      selectedNodeId,
      storyboards,
      updateNode,
    ],
  );
  const [nodes, setNodes, onNodesChange] =
    useNodesState<ImageWorkflowReactNode>(reactFlowNodes);

  useEffect(() => {
    setNodes(reactFlowNodes);
  }, [reactFlowNodes, setNodes]);

  useEffect(() => {
    if (!flowInstance || nodes.length === 0) return;
    const focusNodes =
      initialAssetContext && focusedFitNodeIds.length > 0
        ? focusedFitNodeIds.map((id) => ({ id }))
        : undefined;
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        flowInstance?.fitView({
          ...FIT_VIEW_OPTIONS,
          duration: 180,
          ...(focusNodes ? { nodes: focusNodes } : {}),
        });
      }, 80);
    });
  }, [activeGraph?.id, flowInstance, focusedFitNodeKey, initialAssetContext, nodes.length]);

  if (!activeGraph) {
    if (isScopedWorkflowDetail) {
      return (
        <ImageWorkflowScopedPending
          projectName={projectName}
          sourceLabel={sourceLabel}
          sourceStageLabel={sourceStageLabel}
          writebackTargetLabel={scopedPendingWritebackTargetLabel}
          onBack={onBack}
        />
      );
    }

    return (
      <section className="flex min-h-[calc(100vh-190px)] items-center justify-center rounded-lg border border-border bg-card">
        <Button onClick={createNewFlow}>
          <Plus className="h-4 w-4" />
          新建图像工作流
        </Button>
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-[calc(100vh-190px)] w-full flex-1 grid-cols-[minmax(0,1fr)_320px] overflow-hidden rounded-lg border border-border bg-background text-foreground">
      <div className="relative min-w-0 overflow-hidden">
        <ReactFlow
          className="absolute inset-0 bg-muted/20"
          nodes={nodes}
          edges={reactFlowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id);
            const targetNodeId = resolveGenerationTargetNodeId(activeGraph, node.id);
            if (targetNodeId) setPreferredGeneratedNodeId(targetNodeId);
            setSelectedEdgeId(null);
          }}
          onPaneClick={() => {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }}
          onEdgeClick={(_, edge) => {
            setSelectedEdgeId(edge.id);
            setSelectedNodeId(null);
          }}
          onNodeDragStop={(_, node) => {
            saveGraph(updateImageWorkflowNodePosition(activeGraph, node.id, node.position));
          }}
          onConnect={handleConnect}
          onInit={(instance) => {
            setFlowInstance(instance);
            window.requestAnimationFrame(() => instance.fitView(FIT_VIEW_OPTIONS));
          }}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          panOnDrag={[0, 1]}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="hsl(var(--border))" gap={28} size={1} />
          <Controls
            showInteractive={false}
            className="[&_.react-flow__controls-button]:!border-border [&_.react-flow__controls-button]:!bg-card [&_.react-flow__controls-button]:!text-card-foreground"
          />
        </ReactFlow>
        <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/92 p-2 text-card-foreground shadow-lg backdrop-blur">
          {onBack ? (
            <Button size="sm" variant="ghost" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
              返回
            </Button>
          ) : null}
          <div className={cn("flex min-w-[180px] flex-1 items-center text-xs", onBack ? "border-l border-border pl-2" : "")}>
            <span className="shrink-0 text-muted-foreground">来源</span>
            <span className="ml-2 truncate font-medium">
              {sourceStageLabel ? `${sourceStageLabel} / ${sourceLabel}` : sourceLabel}
            </span>
          </div>
          {canUseGlobalWorkflowControls ? (
            <>
              <select
                data-image-workflow-selector
                value={activeGraph.id}
                onChange={(event) => {
                  setActiveWorkflowId(event.target.value);
                  setSelectedNodeId(null);
                  setPreferredGeneratedNodeId(null);
                }}
                className="h-8 max-w-[260px] rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
              >
                {imageWorkflows.map((graph) => (
                  <option key={graph.id} value={graph.id}>
                    {graph.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                data-image-workflow-global-action
                onClick={createNewFlow}
              >
                <Plus className="h-3.5 w-3.5" />
                新建
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-image-workflow-global-action
                onClick={() => uploadInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                上传参考
              </Button>
              <Button size="sm" data-image-workflow-global-action onClick={addGeneratedNode}>
                <WandSparkles className="h-3.5 w-3.5" />
                生成节点
              </Button>
            </>
          ) : (
            <div className="max-w-[300px] truncate rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs font-medium text-card-foreground">
              {activeGraph.name}
            </div>
          )}
          <div className="flex min-w-[180px] max-w-[320px] items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] text-cyan-100">
            <Save className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0 text-cyan-200/75">回写目标</span>
            <span className="truncate font-medium">{workflowWritebackTargetLabel}</span>
          </div>
          <Button
            size="sm"
            onClick={() => activeGeneratedNode && void generateNode(activeGeneratedNode.id)}
            disabled={!activeGeneratedNode || selectedGenerationBusy}
          >
            {selectedGenerationBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <WandSparkles className="h-3.5 w-3.5" />
            )}
            运行生成
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => activeGeneratedNode && applyNodeToStoryboard(activeGeneratedNode.id)}
            disabled={!activeGeneratedNode?.resultUrl}
          >
            <Save className="h-3.5 w-3.5" />
            写回目标
          </Button>
          {activeGraph.target.kind === "asset" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                activeGeneratedNode && void storeGeneratedNodeInAssetLibrary(activeGeneratedNode.id)
              }
              disabled={!activeGeneratedNode?.resultUrl}
            >
              <Save className="h-3.5 w-3.5" />
              放入资产库
            </Button>
          ) : null}
          {selectedEdgeId && canUseGlobalWorkflowControls ? (
            <Button
              size="sm"
              variant="destructive"
              data-image-workflow-global-action
              onClick={deleteSelectedEdge}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除连线
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            aria-label="适配画布"
            onClick={() => flowInstance?.fitView({ ...FIT_VIEW_OPTIONS, duration: 180 })}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
        {nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="max-w-sm rounded-md border border-border bg-card/92 px-4 py-3 text-sm text-card-foreground shadow-lg backdrop-blur">
              <div className="font-semibold">当前图片工作流没有节点</div>
              <div className="mt-1 text-xs text-muted-foreground">
                可从左上角新建节点，或回到工作流重新从资产/分镜卡片进入。
              </div>
            </div>
          </div>
        ) : null}
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => void handleUploadReference(event.target.files?.[0])}
        />
      </div>

      <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-cyan-200" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{activeGraph.name}</h3>
              <p className="text-[11px] text-muted-foreground">{projectName}</p>
            </div>
          </div>
          {isScopedWorkflowDetail ? (
            <div className="mt-3 grid gap-2" data-scoped-image-workflow-summary>
              <div className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
                <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">
                  来源
                </div>
                <div className="mt-1 truncate">
                  {sourceStageLabel ? `${sourceStageLabel} / ${sourceLabel}` : sourceLabel}
                </div>
              </div>
              <div className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
                <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">
                  回写目标
                </div>
                <div className="mt-1 truncate">{workflowWritebackTargetLabel}</div>
              </div>
            </div>
          ) : activeGraph.target.kind === "asset" ? (
            <div className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
              <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">
                回写目标
              </div>
              <div className="mt-1 truncate">
                {assetTargetLabel(
                  activeGraph.target,
                  isAssetOpenContext(initialAssetContext)
                    ? initialAssetContext
                    : undefined,
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 grid gap-2">
              <select
                value={targetStoryboardId}
                onChange={(event) => setTargetStoryboardId(event.target.value)}
                className="h-8 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
              >
                <option value="">选择回写分镜</option>
                {storyboards.map((storyboard) => (
                  <option key={storyboard.id} value={storyboard.id}>
                    分镜 {storyboard.index} · {storyboard.prompt.slice(0, 18)}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="secondary" onClick={bindTargetStoryboard} disabled={!targetStoryboardId}>
                <Save className="h-3.5 w-3.5" />
                绑定当前图
              </Button>
            </div>
          )}
        </div>
        {canUseGlobalWorkflowControls ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ImageWorkflowPaletteSection title="项目参考图" emptyText="当前项目暂无参考图">
              {imageMaterials.slice(0, 24).map((material) => (
                <ImageWorkflowPaletteImageButton
                  key={material.id}
                  title={material.name}
                  imageUrl={material.localPath}
                  onClick={() => addReferenceFromMaterial(material)}
                />
              ))}
            </ImageWorkflowPaletteSection>
            <ImageWorkflowPaletteSection title="分镜成图" emptyText="分镜尚未绑定图片">
              {storyboardImages.slice(0, 24).map((storyboard) => (
                <ImageWorkflowPaletteImageButton
                  key={storyboard.id}
                  title={`分镜 ${storyboard.index}`}
                  imageUrl={storyboard.mediaRef!.path}
                  onClick={() => addReferenceFromStoryboard(storyboard)}
                />
              ))}
            </ImageWorkflowPaletteSection>
          </div>
        ) : null}
      </aside>
    </section>
  );
}
