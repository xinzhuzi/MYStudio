import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
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
import { LocalImage } from "@/components/ui/local-image";
import { Textarea } from "@/components/ui/textarea";
import { readImageAsBase64 } from "@/lib/image-storage";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  buildImageWorkflowGenerationRequest,
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
import { prepareImageWorkflowReferenceImages } from "@/lib/studio/image-workflow-references";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowOpenContext,
  ImageWorkflowPromptNode,
  ImageWorkflowReferenceNode,
  AssetImageWorkflowContext,
  StoryboardItem,
  StudioMaterial,
} from "@/types/studio";
import { cn } from "@/lib/utils";
import { ModelSelector } from "@/components/panels/assist/ModelSelector";
import { IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS } from "@/lib/ai/image-size-presets";

interface ImageWorkflowNodeData extends Record<string, unknown> {
  node: ImageWorkflowNode;
  promptNode?: ImageWorkflowPromptNode;
  selected: boolean;
  storyboards: StoryboardItem[];
  onUpdate: (nodeId: string, updates: Partial<ImageWorkflowNode>) => void;
  onGenerate: (nodeId: string) => void;
  onApplyToStoryboard: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}

type ImageWorkflowReactNode = Node<ImageWorkflowNodeData>;

const nodeTypes = { imageWorkflow: ImageWorkflowNodeCard };
const FIT_VIEW_OPTIONS = { padding: 0.18, minZoom: 0.35, maxZoom: 1.1 } as const;
const ASPECT_RATIOS = IMAGE_ASPECT_RATIOS;
const RESOLUTION_OPTIONS = IMAGE_RESOLUTIONS;
const QUALITY_OPTIONS: Array<ImageWorkflowGeneratedNode["quality"]> = ["draft", "standard", "hd"];

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
    [activeGraph, applyNodeToStoryboard, deleteNode, generateNode, selectedNodeId, storyboards, updateNode],
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

  const renderScopedWorkflowPending = () => (
    <section className="grid h-full min-h-[calc(100vh-190px)] w-full flex-1 grid-cols-[minmax(0,1fr)_320px] overflow-hidden rounded-lg border border-border bg-background text-foreground">
      <div className="relative min-w-0 overflow-hidden bg-muted/20">
        <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/92 p-2 text-card-foreground shadow-lg backdrop-blur">
          {onBack ? (
            <Button size="sm" variant="ghost" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
              返回工作流
            </Button>
          ) : null}
          <div className={cn("flex min-w-[180px] flex-1 items-center text-xs", onBack ? "border-l border-border pl-2" : "")}>
            <span className="shrink-0 text-muted-foreground">来源</span>
            <span className="ml-2 truncate font-medium">
              {sourceStageLabel ? `${sourceStageLabel} / ${sourceLabel}` : sourceLabel}
            </span>
          </div>
          <div className="flex min-w-[180px] max-w-[320px] items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] text-cyan-100">
            <Save className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0 text-cyan-200/75">回写目标</span>
            <span className="truncate font-medium">{scopedPendingWritebackTargetLabel}</span>
          </div>
          <Button size="sm" disabled>
            <WandSparkles className="h-3.5 w-3.5" />
            运行生成
          </Button>
          <Button size="sm" variant="secondary" disabled>
            <Save className="h-3.5 w-3.5" />
            写回目标
          </Button>
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <div className="max-w-sm rounded-md border border-border bg-card/92 px-4 py-3 text-sm text-card-foreground shadow-lg backdrop-blur">
            <div className="font-semibold">正在打开当前图片工作流</div>
            <div className="mt-1 text-xs text-muted-foreground">
              稍候将只显示当前节点的参考图、提示词和生成结果。
            </div>
          </div>
        </div>
      </div>
      <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-cyan-200" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">当前节点图片工作流</h3>
              <p className="text-[11px] text-muted-foreground">{projectName}</p>
            </div>
          </div>
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
              <div className="mt-1 truncate">{scopedPendingWritebackTargetLabel}</div>
            </div>
          </div>
        </div>
      </aside>
    </section>
  );

  if (!activeGraph) {
    if (isScopedWorkflowDetail) return renderScopedWorkflowPending();

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
              返回工作流
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
            <PaletteSection title="项目参考图" emptyText="当前项目暂无参考图">
              {imageMaterials.slice(0, 24).map((material) => (
                <PaletteImageButton
                  key={material.id}
                  title={material.name}
                  imageUrl={material.localPath}
                  onClick={() => addReferenceFromMaterial(material)}
                />
              ))}
            </PaletteSection>
            <PaletteSection title="分镜成图" emptyText="分镜尚未绑定图片">
              {storyboardImages.slice(0, 24).map((storyboard) => (
                <PaletteImageButton
                  key={storyboard.id}
                  title={`分镜 ${storyboard.index}`}
                  imageUrl={storyboard.mediaRef!.path}
                  onClick={() => addReferenceFromStoryboard(storyboard)}
                />
              ))}
            </PaletteSection>
          </div>
        ) : null}
      </aside>
    </section>
  );
}

function ImageWorkflowNodeCard({ data }: NodeProps<ImageWorkflowReactNode>) {
  const node = data.node;
  const borderClass = data.selected
    ? "border-amber-300/80 shadow-[0_18px_42px_rgba(251,191,36,0.22)]"
    : node.type === "generated" && node.status === "ready"
      ? "border-emerald-300/45"
      : "border-border";
  const nodeKindLabel =
    node.type === "reference" ? "Image" : node.type === "prompt" ? "图片生成" : "生成结果";

  return (
    <div
      data-image-workflow-node-kind={node.type}
      className={cn(
        "rounded-md border bg-card/96 p-3 text-card-foreground shadow-[0_22px_54px_rgba(0,0,0,0.24)]",
        node.type === "prompt" || node.type === "generated" ? "w-[560px]" : "w-[420px]",
        borderClass,
      )}
    >
      {node.type === "generated" ? (
        <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-cyan-100 !bg-cyan-300" />
      ) : null}
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-cyan-100 !bg-cyan-300" />
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/35">
            {node.type === "reference" ? <ImageIcon className="h-4 w-4" /> : <WandSparkles className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <input
              value={node.title}
              onChange={(event) => data.onUpdate(node.id, { title: event.target.value } as Partial<ImageWorkflowNode>)}
              className="nodrag nopan w-full truncate bg-transparent text-sm font-semibold outline-none"
            />
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {nodeKindLabel}
            </div>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="删除节点"
          onClick={() => data.onDelete(node.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {node.type === "reference" ? (
        <ReferenceNodeEditor node={node} onUpdate={data.onUpdate} />
      ) : node.type === "prompt" ? (
        <PromptNodeEditor
          node={node}
          onUpdate={data.onUpdate}
          onGenerate={data.onGenerate}
        />
      ) : (
        <GeneratedNodeEditor
          node={node}
          promptNode={data.promptNode}
          onUpdate={data.onUpdate}
          onGenerate={data.onGenerate}
          onApplyToStoryboard={data.onApplyToStoryboard}
        />
      )}
    </div>
  );
}

function ReferenceNodeEditor({
  node,
  onUpdate,
}: {
  node: ImageWorkflowReferenceNode;
  onUpdate: ImageWorkflowNodeData["onUpdate"];
}) {
  return (
    <div className="space-y-2">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
        {node.imageUrl ? (
          <LocalImage src={node.imageUrl} alt={node.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">暂无图片</div>
        )}
      </div>
      <input
        value={node.imageUrl}
        onChange={(event) => onUpdate(node.id, { imageUrl: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="project-file://、local-image:// 或 https://"
        className="nodrag nopan h-8 w-full rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
      />
      <Textarea
        value={node.notes ?? ""}
        onChange={(event) => onUpdate(node.id, { notes: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="参考说明"
        className="nodrag nopan min-h-[58px] border-border bg-background/80 text-xs text-foreground"
      />
    </div>
  );
}

function PromptNodeEditor({
  node,
  onUpdate,
  onGenerate,
}: {
  node: ImageWorkflowPromptNode;
  onUpdate: ImageWorkflowNodeData["onUpdate"];
  onGenerate: ImageWorkflowNodeData["onGenerate"];
}) {
  return (
    <div className="space-y-3">
      <Textarea
        value={node.prompt}
        onChange={(event) => onUpdate(node.id, { prompt: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="描述要生成的图片"
        className="nodrag nopan min-h-[160px] resize-y border-border bg-background/80 text-sm leading-6 text-foreground"
      />
      <div className="nodrag nopan grid grid-cols-[minmax(0,1fr)_88px_88px_92px] gap-2">
        <ModelSelector
          type="image"
          value={node.model ?? ""}
          onChange={(model) => onUpdate(node.id, { model } as Partial<ImageWorkflowNode>)}
          className="w-full"
        />
        <select
          value={node.aspectRatio}
          onChange={(event) => onUpdate(node.id, { aspectRatio: event.target.value } as Partial<ImageWorkflowNode>)}
          className="h-9 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
          aria-label="图片比例"
        >
          {ASPECT_RATIOS.map((ratio) => (
            <option key={ratio} value={ratio}>
              {ratio}
            </option>
          ))}
        </select>
        <select
          value={node.resolution ?? ""}
          onChange={(event) => onUpdate(node.id, { resolution: event.target.value } as Partial<ImageWorkflowNode>)}
          className="h-9 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
          aria-label="图片分辨率"
        >
          {RESOLUTION_OPTIONS.map((resolution) => (
            <option key={resolution} value={resolution}>
              {resolution}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => onGenerate(node.id)}>
          <WandSparkles className="h-3.5 w-3.5" />
          生成
        </Button>
      </div>
      <div className="nodrag nopan grid grid-cols-[1fr_96px] gap-2">
        <Textarea
          value={node.negativePrompt ?? ""}
          onChange={(event) => onUpdate(node.id, { negativePrompt: event.target.value } as Partial<ImageWorkflowNode>)}
          placeholder="反向提示词（可选）"
          className="min-h-[54px] border-border bg-background/80 text-xs leading-5 text-foreground"
        />
        <select
          value={node.quality}
          onChange={(event) =>
            onUpdate(node.id, { quality: event.target.value as ImageWorkflowPromptNode["quality"] } as Partial<ImageWorkflowNode>)
          }
          className="h-9 self-end rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
          aria-label="生成质量"
        >
          {QUALITY_OPTIONS.map((quality) => (
            <option key={quality} value={quality}>
              {quality}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function GeneratedNodeEditor({
  node,
  promptNode,
  onUpdate,
  onGenerate,
  onApplyToStoryboard,
}: {
  node: ImageWorkflowGeneratedNode;
  promptNode?: ImageWorkflowPromptNode;
  onUpdate: ImageWorkflowNodeData["onUpdate"];
  onGenerate: ImageWorkflowNodeData["onGenerate"];
  onApplyToStoryboard: ImageWorkflowNodeData["onApplyToStoryboard"];
}) {
  const generating = node.status === "generating" || node.status === "queued";
  const generationPrompt = promptNode ?? node;
  const updateGenerationPrompt = (updates: Partial<ImageWorkflowPromptNode | ImageWorkflowGeneratedNode>) => {
    onUpdate((promptNode ?? node).id, updates as Partial<ImageWorkflowNode>);
  };
  return (
    <div className="space-y-3">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
        {node.resultUrl ? (
          <LocalImage src={node.resultUrl} alt={node.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {node.status === "failed" ? node.errorReason || "生成失败" : "等待生成"}
          </div>
        )}
      </div>
      <div className="nodrag nopan flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {node.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : null}
          {node.status}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => onApplyToStoryboard(node.id)} disabled={!node.resultUrl}>
            <Save className="h-3.5 w-3.5" />
            回写
          </Button>
          <Button size="sm" onClick={() => onGenerate(node.id)} disabled={generating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
            生成
          </Button>
        </div>
      </div>
      <div
        data-toonflow-generated-prompt-panel
        className="nodrag nopan space-y-3 rounded-md border border-border bg-background/80 p-3"
      >
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <WandSparkles className="h-3.5 w-3.5 text-cyan-200" />
          图片生成
        </div>
        <Textarea
          data-toonflow-generated-prompt-textarea
          value={generationPrompt.prompt}
          onChange={(event) => updateGenerationPrompt({ prompt: event.target.value })}
          placeholder="描述要生成的图片"
          className="min-h-[148px] resize-y border-border bg-card/80 text-sm leading-6 text-foreground"
        />
        <div className="grid grid-cols-[minmax(0,1fr)_104px_104px] gap-2">
          <ModelSelector
            type="image"
            value={generationPrompt.model ?? ""}
            onChange={(model) => updateGenerationPrompt({ model })}
            className="w-full"
          />
          <select
            value={generationPrompt.aspectRatio}
            onChange={(event) => updateGenerationPrompt({ aspectRatio: event.target.value })}
            className="h-9 rounded-md border border-border bg-card/80 px-2 text-xs text-foreground outline-none"
            aria-label="图片比例"
          >
            {ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
          <select
            value={generationPrompt.resolution ?? ""}
            onChange={(event) => updateGenerationPrompt({ resolution: event.target.value })}
            className="h-9 rounded-md border border-border bg-card/80 px-2 text-xs text-foreground outline-none"
            aria-label="图片分辨率"
          >
            {RESOLUTION_OPTIONS.map((resolution) => (
              <option key={resolution} value={resolution}>
                {resolution}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_104px_40px_40px] gap-2">
          <Textarea
            value={generationPrompt.negativePrompt ?? ""}
            onChange={(event) => updateGenerationPrompt({ negativePrompt: event.target.value })}
            placeholder="反向提示词（可选）"
            className="min-h-[44px] border-border bg-card/80 text-xs leading-5 text-foreground"
          />
          <select
            value={generationPrompt.quality}
            onChange={(event) =>
              updateGenerationPrompt({ quality: event.target.value as ImageWorkflowPromptNode["quality"] })
            }
            className="h-9 self-end rounded-md border border-border bg-card/80 px-2 text-xs text-foreground outline-none"
            aria-label="生成质量"
          >
            {QUALITY_OPTIONS.map((quality) => (
              <option key={quality} value={quality}>
                {quality}
              </option>
            ))}
          </select>
          <Button
            size="icon"
            onClick={() => onGenerate(node.id)}
            disabled={generating}
            aria-label="运行生成"
            className="self-end"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
          </Button>
          <Button
            size="icon"
            variant="secondary"
            onClick={() => onApplyToStoryboard(node.id)}
            disabled={!node.resultUrl}
            aria-label="写回目标"
            className="self-end"
          >
            <Save className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PaletteSection({
  title,
  emptyText,
  children,
}: {
  title: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="mb-4">
      <h4 className="mb-2 text-xs font-semibold text-card-foreground">{title}</h4>
      {hasChildren ? (
        <div className="grid grid-cols-2 gap-2">{children}</div>
      ) : (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      )}
    </section>
  );
}

function PaletteImageButton({
  title,
  imageUrl,
  onClick,
}: {
  title: string;
  imageUrl: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group overflow-hidden rounded-md border border-border bg-muted/20 text-left hover:border-cyan-300/50"
      onClick={onClick}
    >
      <div className="aspect-video bg-muted/30">
        <LocalImage src={imageUrl} alt={title} className="h-full w-full object-cover" />
      </div>
      <div className="truncate px-2 py-1.5 text-[11px] text-muted-foreground group-hover:text-cyan-500">
        {title}
      </div>
    </button>
  );
}

function nextNodePosition(graph: ImageWorkflowGraph, type: ImageWorkflowNode["type"]) {
  const count = graph.nodes.filter((node) => node.type === type).length;
  return type === "reference"
    ? { x: 80, y: 80 + count * 260 }
    : type === "prompt"
      ? { x: 560, y: 500 + count * 320 }
      : { x: 620, y: 120 + count * 300 };
}

function resolveGenerationTargetNodeId(graph: ImageWorkflowGraph, nodeId: string) {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return undefined;
  if (node.type === "generated") return node.id;
  if (node.type !== "prompt") return undefined;
  const edgeTarget = graph.edges.find((edge) => edge.source === node.id)?.target;
  const targetNodeId = edgeTarget || node.targetNodeId;
  return graph.nodes.some((item) => item.id === targetNodeId && item.type === "generated")
    ? targetNodeId
    : undefined;
}

function resolveActionGeneratedNode(
  graph: ImageWorkflowGraph,
  selectedNodeId: string | null,
  preferredGeneratedNodeId: string | null,
) {
  const selectedTargetId = selectedNodeId
    ? resolveGenerationTargetNodeId(graph, selectedNodeId)
    : undefined;
  const preferredTargetId =
    preferredGeneratedNodeId &&
    graph.nodes.some(
      (node) => node.type === "generated" && node.id === preferredGeneratedNodeId,
    )
      ? preferredGeneratedNodeId
      : undefined;
  const fallbackTargetId =
    selectedTargetId ??
    preferredTargetId ??
    graph.nodes
      .filter((node) => node.type === "prompt")
      .map((node) => resolveGenerationTargetNodeId(graph, node.id))
      .find(Boolean) ??
    graph.nodes.find((node): node is ImageWorkflowGeneratedNode => node.type === "generated")?.id;
  return graph.nodes.find(
    (node): node is ImageWorkflowGeneratedNode =>
      node.type === "generated" && node.id === fallbackTargetId,
  );
}

function resolveOpenContextGeneratedNodeId(
  graph: ImageWorkflowGraph,
  context: ImageWorkflowOpenContext,
) {
  const generatedNodes = graph.nodes.filter(
    (node): node is ImageWorkflowGeneratedNode => node.type === "generated",
  );
  const resultMatch = context.resultImagePath
    ? generatedNodes.find((node) => node.resultUrl === context.resultImagePath)
    : undefined;
  const promptMatch = context.prompt
    ? generatedNodes.find((node) => node.prompt === context.prompt)
    : undefined;
  return resultMatch?.id ?? promptMatch?.id ?? generatedNodes[0]?.id ?? null;
}

function findLinkedPromptNodeForGenerated(
  graph: ImageWorkflowGraph,
  generatedNodeId: string,
) {
  const inputNodeIds = graph.edges
    .filter((edge) => edge.target === generatedNodeId)
    .map((edge) => edge.source);
  return graph.nodes.find(
    (node): node is ImageWorkflowPromptNode =>
      node.type === "prompt" &&
      (node.targetNodeId === generatedNodeId || inputNodeIds.includes(node.id)),
  );
}

function focusNodeIdsForGenerated(
  graph: ImageWorkflowGraph,
  generatedNodeId: string,
) {
  const generatedNode = graph.nodes.find(
    (node): node is ImageWorkflowGeneratedNode =>
      node.type === "generated" && node.id === generatedNodeId,
  );
  if (!generatedNode) return [];
  const inputNodeIds = graph.edges
    .filter((edge) => edge.target === generatedNodeId)
    .map((edge) => edge.source);
  const promptNode = findLinkedPromptNodeForGenerated(graph, generatedNodeId);
  const nearbyReferenceNodeIds = graph.nodes
    .filter(
      (node): node is ImageWorkflowReferenceNode =>
        node.type === "reference" && inputNodeIds.includes(node.id),
    )
    .sort(
      (left, right) =>
        Math.abs(left.position.y - generatedNode.position.y) -
        Math.abs(right.position.y - generatedNode.position.y),
    )
    .slice(0, 3)
    .map((node) => node.id);
  return Array.from(new Set([
    ...nearbyReferenceNodeIds,
    generatedNode.id,
    ...(promptNode ? [promptNode.id] : []),
  ]));
}

function workflowTargetLabel(
  graph: ImageWorkflowGraph,
  context: AssetImageWorkflowContext | undefined,
  storyboards: StoryboardItem[],
  targetStoryboardId: string,
) {
  if (graph.target.kind === "asset") return assetTargetLabel(graph.target, context);
  const storyboardId =
    graph.target.kind === "storyboard" && graph.target.id
      ? graph.target.id
      : targetStoryboardId;
  if (storyboardId) {
    const storyboard = storyboards.find((item) => item.id === storyboardId);
    return storyboard
      ? `分镜 ${storyboard.index} · ${storyboard.prompt.slice(0, 24)}`
      : `分镜 · ${storyboardId}`;
  }
  if (graph.target.kind === "material" && graph.target.id) return `项目素材 · ${graph.target.id}`;
  return "未绑定目标";
}

function openContextTargetLabel(
  context: ImageWorkflowOpenContext,
  storyboards: StoryboardItem[],
) {
  if (isAssetOpenContext(context)) return assetTargetLabel(context.target, context);
  if (context.target.kind === "storyboard" && context.target.id) {
    const storyboard = storyboards.find((item) => item.id === context.target.id);
    return storyboard
      ? `分镜 ${storyboard.index} · ${storyboard.prompt.slice(0, 24)}`
      : `分镜 · ${context.target.id}`;
  }
  if (context.target.kind === "material" && context.target.id) return `项目素材 · ${context.target.id}`;
  return context.title || "当前图片工作流";
}

function isSameImageWorkflowTarget(
  left: ImageWorkflowGraph["target"],
  right: ImageWorkflowGraph["target"],
) {
  return imageWorkflowTargetKey(left) === imageWorkflowTargetKey(right);
}

function assetWorkflowContextKey(context: ImageWorkflowOpenContext) {
  return [
    context.imageWorkflowId ?? "",
    imageWorkflowTargetKey(context.target),
  ].join("|");
}

function isAssetOpenContext(
  context: ImageWorkflowOpenContext | undefined,
): context is AssetImageWorkflowContext {
  return Boolean(context?.target.kind === "asset" && context.target.assetType);
}

function createOpenImageWorkflowGraph(
  context: ImageWorkflowOpenContext,
  projectName: string,
) {
  let graph = createImageWorkflowGraph({
    id: context.imageWorkflowId,
    name: `${projectName} · ${context.title} 图片工作流`,
    target: context.target,
  });
  const generatedNodeId = createId("gen");
  const promptNodeId = createId("prompt");
  const referenceImagePath = context.sourceImagePath || context.resultImagePath;
  const referenceNodeId = referenceImagePath ? createId("ref") : "";
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  if (referenceImagePath) {
    graph = addReferenceImageNode(graph, {
      id: referenceNodeId,
      title: context.target.kind === "storyboard" ? "当前分镜参考图" : "来源参考图",
      imageUrl: referenceImagePath,
      source: context.target,
      position: { x: 80, y: 100 },
    });
  }
  graph = addGeneratedImageNode(graph, {
    id: generatedNodeId,
    title: `${context.title} 成图`,
    prompt: context.prompt ?? "",
    position: { x: referenceImagePath ? 620 : 160, y: 120 },
  });
  graph = addPromptImageNode(graph, {
    id: promptNodeId,
    title: "图片生成",
    prompt: context.prompt ?? "",
    aspectRatio: imageSettings.defaultAspectRatio,
    resolution: imageSettings.defaultResolution,
    quality: "standard",
    targetNodeId: generatedNodeId,
    position: { x: referenceImagePath ? 560 : 160, y: 500 },
  });
  if (context.resultImagePath) {
    graph = setGeneratedImageResult(graph, generatedNodeId, {
      imageUrl: context.resultImagePath,
    });
  }
  if (referenceNodeId) {
    graph = connectImageWorkflowNodes(graph, {
      source: referenceNodeId,
      target: generatedNodeId,
    });
  }
  graph = connectImageWorkflowNodes(graph, {
    source: promptNodeId,
    target: generatedNodeId,
  });
  return graph;
}

function imageWorkflowTargetKey(target: ImageWorkflowGraph["target"]) {
  return [
    target.kind,
    target.assetType ?? "",
    target.parentId ?? "",
    target.id ?? "",
  ].join(":");
}

function assetTargetLabel(
  target: ImageWorkflowGraph["target"],
  context?: AssetImageWorkflowContext,
) {
  if (target.kind !== "asset") return "未绑定资产";
  const typeLabel =
    target.assetType === "character"
      ? "角色衍生"
      : target.assetType === "scene"
        ? "场景衍生"
        : "道具衍生";
  return `${typeLabel} · ${context?.title || target.id || "未命名"}`;
}

async function prepareReferenceImages(values: string[]) {
  return prepareImageWorkflowReferenceImages(values, {
    readProjectFileAsBase64: async (url) =>
      window.projectFiles?.readAsBase64(url),
    readLocalImageAsBase64: readImageAsBase64,
  });
}

function workflowImageRelativePath(workflowId: string, filename: string) {
  return `workflow-images/${safePathSegment(workflowId)}/${safePathSegment(filename)}`;
}

function createWorkflowFilename(prefix: "ref" | "gen", id: string, sourceName: string) {
  const ext = safeExtension(sourceName);
  const base = safePathSegment(sourceName.replace(/\.[^.]+$/, "")) || prefix;
  return `${prefix}-${safePathSegment(id)}-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

function safePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "file";
}

function safeExtension(value: string) {
  const match = value.match(/\.([a-z0-9]{2,8})$/i);
  return match ? `.${match[1].toLowerCase()}` : ".png";
}
