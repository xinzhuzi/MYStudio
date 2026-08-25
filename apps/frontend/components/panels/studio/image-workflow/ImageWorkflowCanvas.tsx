import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  MarkerType,
  ReactFlow,
  type Edge,
  type OnConnect,
  type ReactFlowInstance,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CanvasViewportControls } from "../CanvasViewportControls";
import { interactionDeferBegin, interactionDeferEnd } from "../previews/interaction-defer";
import { useScopedWorkflowLifecycle } from "./use-scoped-workflow-lifecycle";
import { useStoryboardWorkflowSwitch } from "./use-storyboard-workflow-switch";
import {
  Image as _ImageIcon,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  updateImageWorkflowNode,
  updateImageWorkflowNodePosition,
} from "@/lib/studio/image-workflow";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useStudioWorkflowHydrated } from "@/stores/studio/use-studio-workflow-hydrated";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowOpenContext,
 
 
} from "@/types/studio";
import {
  ImageWorkflowNodeCard,
  type ImageWorkflowReactNode,
} from "./image-workflow-node-card";
import {
  findStoryboardWorkflowForContext,
  focusNodeIdsForGenerated,
  isAssetOpenContext,
  openContextTargetLabel,
  resolveActionGeneratedNode,
  resolveGenerationTargetNodeId,
  workflowTargetLabel,
} from "./image-workflow-graph-utils";
import { createImageWorkflowReactNodes } from "./image-workflow-react-nodes";
import { ImageWorkflowScopedPending } from "./image-workflow-scoped-pending";
import { useImageWorkflowGeneration } from "./use-image-workflow-generation";
import { useImageWorkflowUpscale } from "./use-image-workflow-upscale";
import { useImageWorkflowActions } from "./use-image-workflow-actions";
import { ImageWorkflowSidebar } from "./image-workflow-sidebar";
import { ImageWorkflowCanvasToolbar } from "./image-workflow-canvas-toolbar";
import {
  ImageWorkflowBatchUpscaleDialog,
  ImageWorkflowBatchUpscaleProgress,
} from "./image-workflow-batch-upscale-dialog";

const nodeTypes = { imageWorkflow: ImageWorkflowNodeCard };
const FIT_VIEW_OPTIONS = { padding: 0.18, minZoom: 0.35, maxZoom: 1.1 } as const;

export function ImageWorkflowCanvas({
  projectName,
  initialAssetContext,
  onBack,
  onOpenStoryboardWorkflow,
}: {
  projectName: string;
  initialAssetContext?: ImageWorkflowOpenContext;
  onBack?: () => void;
  /** scoped 视图切换分镜(由外层 openAssetImageWorkflow 承接,复用整条打开链) */
  onOpenStoryboardWorkflow?: (context: ImageWorkflowOpenContext) => void;
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
  // T4 水合竞态:启动/切项目 rehydrate 窗口内禁止自动新建工作流(storage 层另有拒写兜底)
  const workflowStoreHydrated = useStudioWorkflowHydrated();
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [preferredGeneratedNodeId, setPreferredGeneratedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [targetStoryboardId, setTargetStoryboardId] = useState("");
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ImageWorkflowReactNode, Edge> | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const isScopedWorkflowDetail = Boolean(initialAssetContext);

  const scopedWorkflow = useMemo(
    () =>
      initialAssetContext
        // 身份防线(08-24 S08 实证,与 lifecycle 同款): id 命中的分镜工作流若无
        // 参考节点(旧代空壳),优先展示带参考的替代工作流——空参考生成会让
        // 模型自由发挥角色形象(监工被画成主角剑客相)
        ? (() => {
            const byId = initialAssetContext.imageWorkflowId
              ? imageWorkflows.find((item) => item.id === initialAssetContext.imageWorkflowId)
              : undefined;
            if (byId && byId.target.kind === "storyboard"
              && !byId.nodes.some((node) => node.type === "reference")) {
              return findStoryboardWorkflowForContext(imageWorkflows, initialAssetContext) ?? byId;
            }
            return byId ?? findStoryboardWorkflowForContext(imageWorkflows, initialAssetContext);
          })()
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
  // 风格依据 chips:建流装配溯源(assemblyTrace)→ 可读标签(命中的手册资产清单)
  const styleTraceChips = useMemo(() => {
    const trace = activeGraph?.target.kind === "storyboard" ? activeGraph.assemblyTrace : undefined;
    if (!trace) return [];
    const chips: string[] = [];
    if (trace.manualId) chips.push(`视觉手册 ${trace.manualId}`);
    if (trace.templateId && trace.templateTitle) chips.push(`成片模板 ${trace.templateId}·${trace.templateTitle}`);
    if (trace.factions?.length) chips.push(`阵营配色 ${trace.factions.join("/")}`);
    if (trace.negativeApplied) chips.push("负面约束(五类)");
    if (trace.styleTokenCount) chips.push(`风格令牌×${trace.styleTokenCount}`);
    if (trace.assetReferenceTitles?.length) chips.push(`参考资产 ${trace.assetReferenceTitles.join("、")}`);
    return chips;
  }, [activeGraph]);
  // 进入画布首帧减负:工具栏重活块(风格依据 chips + 回写目标 chip)延后一帧渲染。
  // 这两块都是 useMemo 同步拼装 + 一堆圆角 chip DOM,首帧与画布/reactFlow 节点
  // 同时挂载会把主线程卡出一帧以上;defer 到第二帧,功能不变、视觉无感。
  const [chromeReady, setChromeReady] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setChromeReady(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  const selectedGenerationBusy =
    activeGeneratedNode?.status === "generating" ||
    activeGeneratedNode?.status === "queued";
  const canUseGlobalWorkflowControls = !isScopedWorkflowDetail;

  useScopedWorkflowLifecycle({
    activeGraph,
    activeWorkflowId,
    hydrated: workflowStoreHydrated,
    initialAssetContext,
    imageWorkflows,
    storyboards,
    projectName,
    upsertImageWorkflow,
    createImageWorkflow,
    setActiveWorkflowId,
    setSelectedNodeId,
    setPreferredGeneratedNodeId,
    setTargetStoryboardId,
  });

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

  const { switchTo: switchStoryboardWorkflowInCanvas } = useStoryboardWorkflowSwitch({
    imageWorkflows,
    projectName,
    upsertImageWorkflow,
    setActiveWorkflowId,
    setSelectedNodeId,
    setPreferredGeneratedNodeId,
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

  const handleFlowNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      const targetNodeId = activeGraph
        ? resolveGenerationTargetNodeId(activeGraph, nodeId)
        : null;
      if (targetNodeId) setPreferredGeneratedNodeId(targetNodeId);
      setSelectedEdgeId(null);
    },
    [activeGraph],
  );
  const handleFlowPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);
  const handleFlowEdgeClick = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }, []);
  const handleFlowNodeDragStop = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      if (!activeGraph) return;
      saveGraph(updateImageWorkflowNodePosition(activeGraph, nodeId, position));
    },
    [activeGraph, saveGraph],
  );
  const handleFitView = useCallback(
    () => flowInstance?.fitView({ ...FIT_VIEW_OPTIONS, duration: 180 }),
    [flowInstance],
  );

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

    // T4 水合竞态:store 装载中不展示「新建」空态——此时新建的 free 图会
    // 挂在空 store 上,水合完成后造成误建工作流残留+盲保存风险
    if (!workflowStoreHydrated) {
      return (
        <section
          data-image-workflow-hydrating
          className="flex min-h-[calc(100vh-190px)] items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          正在装载图像工作流…
        </section>
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
    <section className="workflow-node-canvas grid h-full min-h-[calc(100vh-190px)] w-full flex-1 grid-cols-[minmax(0,1fr)_320px] overflow-hidden rounded-lg border border-border bg-background text-foreground">
      <div className="workflow-node-static-background relative min-w-0 overflow-hidden">
        <ImageWorkflowFlowView
          activeGraph={activeGraph}
          focusedFitNodeIds={focusedFitNodeIds}
          focusedFitNodeKey={focusedFitNodeKey}
          initialAssetContext={initialAssetContext}
          reactFlowEdges={reactFlowEdges}
          reactFlowNodes={reactFlowNodes}
          onConnect={handleConnect}
          onEdgeClick={handleFlowEdgeClick}
          onFitView={handleFitView}
          onInit={setFlowInstance}
          onNodeClick={handleFlowNodeClick}
          onNodeDragStop={handleFlowNodeDragStop}
          onPaneClick={handleFlowPaneClick}
          uploadInputRef={uploadInputRef}
          onUploadReference={handleUploadReference}
        />
        <ImageWorkflowCanvasToolbar
          onBack={onBack}
          sourceLabel={sourceLabel}
          sourceStageLabel={sourceStageLabel}
          activeGraph={activeGraph}
          chromeReady={chromeReady}
          styleTraceChips={styleTraceChips}
          canUseGlobalWorkflowControls={canUseGlobalWorkflowControls}
          imageWorkflows={imageWorkflows}
          onSelectorChange={(workflowId) => {
            setActiveWorkflowId(workflowId);
            setSelectedNodeId(null);
            setPreferredGeneratedNodeId(null);
          }}
          onCreateNewFlow={createNewFlow}
          onUploadReferenceClick={() => uploadInputRef.current?.click()}
          onAddGeneratedNode={addGeneratedNode}
          onAddStoryboardLayeredPair={addStoryboardLayeredPair}
          workflowWritebackTargetLabel={workflowWritebackTargetLabel}
          activeGeneratedNode={activeGeneratedNode}
          selectedGenerationBusy={selectedGenerationBusy}
          onGenerate={(nodeId) => void generateNode(nodeId)}
          onApplyToStoryboard={(nodeId) => void applyNodeToStoryboard(nodeId)}
          upscalableCount={upscalableNodes.length}
          upscaleRunning={upscaleBatchState.running || isUpscaling}
          onOpenBatchUpscale={openBatchUpscaleDialog}
          onStoreInAssetLibrary={(nodeId) => void storeGeneratedNodeInAssetLibrary(nodeId)}
          showStoreInAssetLibrary={activeGraph.target.kind === "asset"}
          selectedEdgeId={selectedEdgeId}
          onDeleteSelectedEdge={deleteSelectedEdge}
          onFitView={handleFitView}
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
        canUseGlobalWorkflowControls={canUseGlobalWorkflowControls}
        imageMaterials={imageMaterials}
        storyboardImages={storyboardImages}
        onAddReferenceFromMaterial={addReferenceFromMaterial}
        onAddReferenceFromStoryboard={addReferenceFromStoryboard}
        onSwitchScopedStoryboard={onOpenStoryboardWorkflow ? (storyboard) => {
          void switchStoryboardWorkflowInCanvas(storyboard);
        } : undefined}
      />

      {/* 批量超分勾选清单 + 进行中进度浮层(T2 抽组件) */}
      <ImageWorkflowBatchUpscaleDialog
        open={isBatchUpscaleDialogOpen}
        onOpenChange={setIsBatchUpscaleDialogOpen}
        upscalableNodes={upscalableNodes}
        selection={batchUpscaleSelection}
        onSelectionChange={setBatchUpscaleSelection}
        onStart={startBatchUpscale}
      />
      <ImageWorkflowBatchUpscaleProgress
        state={upscaleBatchState}
        onCancel={cancelUpscaleBatch}
      />
    </section>
  );
}

// ─── 画布子组件:nodes 每帧更新隔离在此,父级工具栏/侧栏不随拖动重渲染 ───

function ImageWorkflowFlowView({
  activeGraph,
  focusedFitNodeIds,
  focusedFitNodeKey,
  initialAssetContext,
  reactFlowEdges,
  reactFlowNodes,
  onConnect,
  onEdgeClick,
  onFitView,
  onInit,
  onNodeClick,
  onNodeDragStop,
  onPaneClick,
  uploadInputRef,
  onUploadReference,
}: {
  activeGraph: ImageWorkflowGraph;
  focusedFitNodeIds: string[];
  focusedFitNodeKey: string;
  initialAssetContext?: ImageWorkflowOpenContext;
  reactFlowEdges: Edge[];
  reactFlowNodes: ImageWorkflowReactNode[];
  onConnect: OnConnect;
  onEdgeClick: (edgeId: string) => void;
  onFitView: () => void;
  onInit: (instance: ReactFlowInstance<ImageWorkflowReactNode, Edge>) => void;
  onNodeClick: (nodeId: string) => void;
  onNodeDragStop: (nodeId: string, position: { x: number; y: number }) => void;
  onPaneClick: () => void;
  uploadInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onUploadReference: (file: File | undefined) => void | Promise<void>;
}) {
  const [nodes, setNodes, onNodesChange] =
    useNodesState<ImageWorkflowReactNode>(reactFlowNodes);

  useEffect(() => {
    setNodes(reactFlowNodes);
  }, [reactFlowNodes, setNodes]);

  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ImageWorkflowReactNode, Edge> | null>(null);

  // 交互(拖节点/平移/缩放)期间给容器打标,CSS 把卡片大阴影、ReactFlow
  // Background pattern、毛玻璃等重活临时降级,松手/静止 180ms 后恢复。
  const interactingRef = useRef<HTMLDivElement | null>(null);
  const interactEndTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setInteracting = useCallback((on: boolean) => {
    const el = interactingRef.current;
    if (!el) return;
    clearTimeout(interactEndTimerRef.current);
    if (on) {
      el.classList.add("workflow-canvas-interacting");
    } else {
      // 拖/缩放结束稍微延迟摘标,避免最后一帧抖动闪烁
      interactEndTimerRef.current = setTimeout(() => {
        el.classList.remove("workflow-canvas-interacting");
      }, 180);
    }
  }, []);
  useEffect(() => () => clearTimeout(interactEndTimerRef.current), []);

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
    // 首帧 fitView 静止后补一帧交互标,确保初次缩放回位期间阴影/背景已降级
    setInteracting(true);
    const settleTimer = window.setTimeout(() => setInteracting(false), 400);
    return () => window.clearTimeout(settleTimer);
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGraph.id, flowInstance, focusedFitNodeKey, initialAssetContext, nodes.length]);

  return (
    <div ref={interactingRef} className="image-workflow-flow-host contents">
      <ReactFlow
        className="absolute inset-0 bg-muted/20"
        nodes={nodes}
        edges={reactFlowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onNodeClick(node.id)}
        onPaneClick={onPaneClick}
        onEdgeClick={(_, edge) => onEdgeClick(edge.id)}
        onNodeDragStart={() => setInteracting(true)}
        onNodeDragStop={(_, node) => {
          setInteracting(false);
          onNodeDragStop(node.id, node.position);
        }}
        onMoveStart={(event) => {
          setInteracting(true);
          // 程序性视口变化(event=null)不关闸,仅用户手势延迟图片加载
          if (event) interactionDeferBegin();
        }}
        onMoveEnd={() => {
          setInteracting(false);
          // 同生产画布:开闸无条件,防 wheel end 无 event 导致闸门关死
          interactionDeferEnd();
        }}
        onConnect={onConnect}
        onInit={(instance) => {
          setFlowInstance(instance);
          onInit(instance);
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
        <CanvasViewportControls onFit={onFitView} />
      </ReactFlow>
      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
          <div className="max-w-sm rounded-md border border-border bg-card/92 px-4 py-3 text-sm text-card-foreground">
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
        onChange={(event) => void onUploadReference(event.target.files?.[0])}
      />
    </div>
  );
}
