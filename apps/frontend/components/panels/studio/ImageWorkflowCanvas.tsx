import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  MarkerType,
  ReactFlow,
  type Edge,
  type ReactFlowInstance,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CanvasViewportControls } from "./CanvasViewportControls";
import { resolveStoryboardAssetReferences } from "./storyboard-asset-references";
import {
  ArrowLeft,
 
  Image as _ImageIcon,
  Loader2,
  Maximize2,
  Plus,
  Save,
  Trash2,
  Upload,
  WandSparkles,
  ZoomIn,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  createAssetImageWorkflowGraph,
 
  ensureImageWorkflowPromptNodes,
  ensureAssetImageWorkflowGraph,
  updateImageWorkflowNode,
  updateImageWorkflowNodePosition,
} from "@/lib/studio/image-workflow";
import { useStudioStore } from "@/stores/studio/studio-store";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowOpenContext,
 
 
} from "@/types/studio";
import { cn } from "@/lib/utils";
import {
  ImageWorkflowNodeCard,
  type ImageWorkflowReactNode,
} from "./image-workflow-node-card";
import {
 
  assetWorkflowContextKey,
  createOpenImageWorkflowGraph,
  focusNodeIdsForGenerated,
  imageWorkflowTargetKey,
  isAssetOpenContext,
  matchesStoryboardOpenContext,
  openContextTargetLabel,
  resolveActionGeneratedNode,
  resolveGenerationTargetNodeId,
  resolveOpenContextGeneratedNodeId,
  workflowTargetLabel,
} from "./image-workflow-graph-utils";
import { createImageWorkflowReactNodes } from "./image-workflow-react-nodes";
import { ImageWorkflowScopedPending } from "./image-workflow-scoped-pending";
import { useImageWorkflowGeneration } from "./use-image-workflow-generation";
import { useImageWorkflowUpscale } from "./use-image-workflow-upscale";
import { useImageWorkflowActions } from "./use-image-workflow-actions";
import { ImageWorkflowSidebar } from "./image-workflow-sidebar";

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
              matchesStoryboardOpenContext(item, initialAssetContext),
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
      matchesStoryboardOpenContext(activeGraph, initialAssetContext)
    ) {
      return;
    }
    const existing = initialAssetContext.imageWorkflowId
      ? imageWorkflows.find((graph) => graph.id === initialAssetContext.imageWorkflowId)
      : imageWorkflows.find((graph) =>
          matchesStoryboardOpenContext(graph, initialAssetContext),
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
    // 建新工作流:分镜目标先异步解析关联资产参考图(场景/角色),再建流挂载。
    // handled key 前置防并发重复创建;解析失败按无参考建流(fail-soft)。
    handledAssetContextKeyRef.current = contextKey;
    void (async () => {
      const assetReferences = initialAssetContext.target.kind === "storyboard"
        ? await resolveStoryboardAssetReferences(
            storyboards.find((item) => item.id === initialAssetContext.target.id),
          ).catch(() => [])
        : undefined;
      const graph = isAssetOpenContext(initialAssetContext)
        ? createAssetImageWorkflowGraph(initialAssetContext, projectName)
        : createOpenImageWorkflowGraph(
            { ...initialAssetContext, assetReferences },
            projectName,
          );
      upsertImageWorkflow(graph);
      setActiveWorkflowId(graph.id);
      const selectedId = resolveOpenContextGeneratedNodeId(graph, initialAssetContext);
      setSelectedNodeId(selectedId);
      setPreferredGeneratedNodeId(selectedId);
    })();
  }, [activeGraph, imageWorkflows, initialAssetContext, projectName, storyboards, upsertImageWorkflow]);

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

  const {
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
  } = useImageWorkflowActions({
    activeGraph,
    initialAssetContext,
    projectName,
    imageWorkflowCount: imageWorkflows.length,
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
  });

  const { generateNode } = useImageWorkflowGeneration({
    workflowId: activeGraph?.id,
    addMaterial,
    saveGraph,
  });

  const {
    isUpscaling,
    batch: upscaleBatchState,
    upscaleNode,
    upscaleBatch,
    cancelBatch: cancelUpscaleBatch,
  } = useImageWorkflowUpscale({
    workflowId: activeGraph?.id,
    addMaterial,
    saveGraph,
  });

  const [isBatchUpscaleDialogOpen, setIsBatchUpscaleDialogOpen] = useState(false);
  const [batchUpscaleSelection, setBatchUpscaleSelection] = useState<Set<string>>(new Set());
  const upscalableNodes = useMemo(
    () => (activeGraph?.nodes ?? []).filter(
      (node): node is ImageWorkflowGeneratedNode =>
        node.type === "generated" && Boolean(node.resultUrl),
    ),
    [activeGraph],
  );

  const openBatchUpscaleDialog = useCallback(() => {
    if (upscalableNodes.length === 0) {
      toast.error("当前工作流没有可超分的成图节点");
      return;
    }
    setBatchUpscaleSelection(new Set(upscalableNodes.map((node) => node.id)));
    setIsBatchUpscaleDialogOpen(true);
  }, [upscalableNodes]);

  const startBatchUpscale = useCallback(() => {
    const entries = upscalableNodes
      .filter((node) => batchUpscaleSelection.has(node.id))
      .map((node) => ({ nodeId: node.id, title: node.title, resultUrl: node.resultUrl as string }));
    setIsBatchUpscaleDialogOpen(false);
    if (entries.length > 0) void upscaleBatch(entries);
  }, [batchUpscaleSelection, upscaleBatch, upscalableNodes]);

  const reactFlowNodes = useMemo<ImageWorkflowReactNode[]>(
    () =>
      createImageWorkflowReactNodes({
        graph: activeGraph,
        selectedNodeId,
        storyboards,
        onUpdate: updateNode,
        onGenerate: generateNode,
        onUpscale: upscaleNode,
        onApplyToStoryboard: applyNodeToStoryboard,
        onDelete: deleteNode,
      }),
    [
      activeGraph,
      applyNodeToStoryboard,
      deleteNode,
      generateNode,
      selectedNodeId,
      storyboards,
      updateNode,
      upscaleNode,
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
// eslint-disable-next-line react-hooks/exhaustive-deps
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
          <CanvasViewportControls
            onFit={() => flowInstance?.fitView({ ...FIT_VIEW_OPTIONS, duration: 180 })}
          />
        </ReactFlow>
        <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/92 p-2 text-card-foreground backdrop-blur-xl backdrop-blur">
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
          {activeGraph?.target.kind === "storyboard" ? (
            <Button size="sm" data-image-workflow-layered-action variant="outline" onClick={addStoryboardLayeredPair}>
              <Layers className="h-3.5 w-3.5" />
              分层节点对
            </Button>
          ) : null}
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
          <div className="flex min-w-[180px] max-w-[320px] items-center gap-1.5 rounded-md border border-info/25 bg-info/10 px-2 py-1 text-[11px] text-info">
            <Save className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0 text-info/75">回写目标</span>
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
          <Button
            size="sm"
            variant="outline"
            data-image-workflow-batch-upscale
            onClick={openBatchUpscaleDialog}
            disabled={upscalableNodes.length === 0 || upscaleBatchState.running || isUpscaling}
            title="勾选多个成图节点,本地 ×4 批量超分"
          >
            <ZoomIn className="h-3.5 w-3.5" />
            批量超分
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
            <div className="max-w-sm rounded-md border border-border bg-card/92 px-4 py-3 text-sm text-card-foreground backdrop-blur-xl backdrop-blur">
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

      <ImageWorkflowSidebar
        activeGraph={activeGraph}
        projectName={projectName}
        initialAssetContext={initialAssetContext}
        isScopedWorkflowDetail={isScopedWorkflowDetail}
        sourceLabel={sourceLabel}
        sourceStageLabel={sourceStageLabel}
        workflowWritebackTargetLabel={workflowWritebackTargetLabel}
        storyboards={storyboards}
        targetStoryboardId={targetStoryboardId}
        onTargetStoryboardChange={setTargetStoryboardId}
        onBindTargetStoryboard={bindTargetStoryboard}
        canUseGlobalWorkflowControls={canUseGlobalWorkflowControls}
        imageMaterials={imageMaterials}
        storyboardImages={storyboardImages}
        onAddReferenceFromMaterial={addReferenceFromMaterial}
        onAddReferenceFromStoryboard={addReferenceFromStoryboard}
      />

      {/* 批量超分勾选清单 */}
      <Dialog open={isBatchUpscaleDialogOpen} onOpenChange={setIsBatchUpscaleDialogOpen}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>批量超分 4K</DialogTitle>
            <DialogDescription>
              勾选要放大的成图节点(本地 Real-ESRGAN 原生 ×4,逐张顺序执行,可随时取消)。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[320px] space-y-1.5 overflow-y-auto" data-image-workflow-batch-upscale-list>
            {upscalableNodes.map((node) => (
              <label
                key={node.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={batchUpscaleSelection.has(node.id)}
                  onCheckedChange={(checked) => {
                    setBatchUpscaleSelection((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(node.id);
                      else next.delete(node.id);
                      return next;
                    });
                  }}
                />
                <span className="min-w-0 truncate">{node.title || node.id}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{node.status}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setIsBatchUpscaleDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={startBatchUpscale} disabled={batchUpscaleSelection.size === 0}>
              <ZoomIn className="mr-1 h-3.5 w-3.5" />
              超分 {batchUpscaleSelection.size} 张
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量超分进度浮层 */}
      {upscaleBatchState.running ? (
        <div
          className="absolute bottom-4 right-4 z-30 w-[320px] rounded-lg border border-border bg-card/95 p-3 backdrop-blur-xl backdrop-blur"
          data-image-workflow-batch-upscale-progress
        >
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="truncate">批量超分：{upscaleBatchState.currentNodeTitle ?? "…"}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {upscaleBatchState.completed + upscaleBatchState.failed}/{upscaleBatchState.total}
            </span>
          </div>
          <Progress
            value={
              upscaleBatchState.total > 0
                ? ((upscaleBatchState.completed + upscaleBatchState.failed) / upscaleBatchState.total) * 100
                : 0
            }
          />
          {upscaleBatchState.failed > 0 ? (
            <p className="mt-1.5 text-xs text-destructive">失败 {upscaleBatchState.failed} 张(已跳过,继续处理)</p>
          ) : null}
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={cancelUpscaleBatch}>
              取消剩余
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
