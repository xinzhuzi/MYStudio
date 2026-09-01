import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  MarkerType,
  ReactFlow,
  type Edge,
  type FinalConnectionState,
  type OnConnect,
  type ReactFlowInstance,
  useNodesState,
  useUpdateNodeInternals,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CanvasViewportControls } from "../CanvasViewportControls";
import { InteractionDeferHint } from "../previews/interaction-defer-hint";
import { useCanvasGestureKernel } from "../use-canvas-gesture-kernel";
import { useCanvasHistory, useCanvasHistoryShortcuts } from "../use-canvas-history";
import { useScopedWorkflowLifecycle } from "./use-scoped-workflow-lifecycle";
import { buildSwitchContext, useStoryboardWorkflowSwitch } from "./use-storyboard-workflow-switch";
import { useChapterStoryboards } from "../use-chapter-storyboards";
import { libraryImageWorkflows, resolveImageWorkflowScope } from "./image-workflow-scope";
import {
  Image as _ImageIcon,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  tidyImageWorkflowLayout,
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
  imageWorkflowTargetKey,
  findStoryboardWorkflowForContext,
  focusNodeIdsForGenerated,
  isAssetOpenContext,
  openContextTargetLabel,
  resolveActionGeneratedNode,
  resolveGenerationTargetNodeId,
  workflowTargetLabel,
} from "./image-workflow-graph-utils";
import { createImageWorkflowReactNodes } from "./image-workflow-react-nodes";
import { ImageWorkflowConnectCreateMenu } from "./image-workflow-connect-create-menu";
import {
  connectCreateDirection,
  createConnectedImageNode,
  getCreatableImageNodeTypes,
  type ConnectCreateInput,
} from "@/lib/studio/image-workflow/connect-create";
import type { CanvasHistoryController } from "../use-canvas-history";
import { ImageWorkflowScopedPending } from "./image-workflow-scoped-pending";
import { useImageWorkflowGeneration } from "./use-image-workflow-generation";
import { useImageWorkflowUpscale } from "./use-image-workflow-upscale";
import { denoiseModeToOpts, type UpscaleDenoiseMode } from "./upscale-denoise-mode";
import { useImageWorkflowActions } from "./use-image-workflow-actions";
import { useImageWorkflowCommands } from "./use-image-workflow-commands";
import { ImageWorkflowSidebar } from "./image-workflow-sidebar";
import { ImageWorkflowCanvasToolbar } from "./image-workflow-canvas-toolbar";
import {
  ImageWorkflowBatchUpscaleDialog,
  ImageWorkflowBatchUpscaleProgress,
} from "./image-workflow-batch-upscale-dialog";

const nodeTypes = { imageWorkflow: ImageWorkflowNodeCard };
// 上下让位:顶部悬浮工具栏(返回/风格依据/整理布局≈140px)与左下视口控件+
// 右下小地图会盖住贴边节点(实弹审查实证),fitView 用方向 padding 避让
const FIT_VIEW_OPTIONS = {
  padding: { top: "150px", bottom: "150px", left: 0.16, right: 0.16 },
  // 0.35 地板会让高图(82镜/多卡堆叠)装不下,顶部溢出压进悬浮工具栏
  minZoom: 0.25,
  maxZoom: 1.1,
} as const;

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
  // 上下文作用域(08-30 默认分镜域):无上下文直进/分镜入口=storyboard;
  // 资产入口=library。默认落点=分镜节点图(本章第一条分镜流)
  const workflowScope = resolveImageWorkflowScope(initialAssetContext);
  // 合并切换器的分镜口径:useChapterStoryboards(全仓唯一本章过滤,与分镜面板同源)
  const chapterStoryboards = useChapterStoryboards();

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
      if (isScopedWorkflowDetail) {
        return selectedGraph && selectedGraph.id === scopedWorkflow?.id
          ? selectedGraph
          : scopedWorkflow;
      }
      // library 域(资产入口)不落分镜流——分镜浏览回分镜面板(08-30 强隔离)
      if (workflowScope === "library") {
        return selectedGraph && selectedGraph.target.kind !== "storyboard"
          ? selectedGraph
          : libraryImageWorkflows(imageWorkflows)[0];
      }
      // storyboard 域默认:直进工作流=分镜节点图,落本章首个有流的分镜
      //(顺序按分镜表;优先带指纹的当前代流)
      if (selectedGraph) return selectedGraph;
      for (const storyboard of chapterStoryboards) {
        const withFp = imageWorkflows.find((graph) =>
          graph.target.kind === "storyboard"
          && graph.target.id === storyboard.id
          && graph.targetSourceFingerprint);
        if (withFp) return withFp;
      }
      for (const storyboard of chapterStoryboards) {
        const any = imageWorkflows.find((graph) =>
          graph.target.kind === "storyboard" && graph.target.id === storyboard.id);
        if (any) return any;
      }
      return undefined;
    },
    [activeWorkflowId, chapterStoryboards, imageWorkflows, isScopedWorkflowDetail, scopedWorkflow, workflowScope],
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
  // 全局动作(新建自由/上传参考/生成节点/参考面板)仅资产域;分镜域纯净(08-30)
  const canUseGlobalWorkflowControls = workflowScope === "library";

  useScopedWorkflowLifecycle({
    activeGraph,
    activeWorkflowId,
    hydrated: workflowStoreHydrated,
    initialAssetContext,
    imageWorkflows,
    storyboards,
    projectName,
    upsertImageWorkflow,
    setActiveWorkflowId,
    setSelectedNodeId,
    setPreferredGeneratedNodeId,
    setTargetStoryboardId,
  });

  // 撤销重做(08-31-canvas-undo-redo):快照只包 nodes+edges(视图模型),
  // 选中/视口/目标绑定指纹不入史;restore 直写 store 不经包装防回环。
  const activeGraphRef = useRef<ImageWorkflowGraph | null>(null);
  activeGraphRef.current = activeGraph ?? null;
  const canvasHistory = useCanvasHistory<{
    nodes: ImageWorkflowGraph["nodes"];
    edges: ImageWorkflowGraph["edges"];
  }>({
    read: () => ({
      nodes: activeGraphRef.current?.nodes ?? [],
      edges: activeGraphRef.current?.edges ?? [],
    }),
    resetKey: activeGraph?.id ?? "",
    restore: (snapshot) => {
      const current = activeGraphRef.current;
      if (!current) return;
      upsertImageWorkflow({ ...current, nodes: snapshot.nodes, edges: snapshot.edges });
    },
  });
  useCanvasHistoryShortcuts({ undo: canvasHistory.undo, redo: canvasHistory.redo });

  const saveGraph = useCallback(
    (graph: ImageWorkflowGraph) => {
      canvasHistory.commit({ nodes: graph.nodes, edges: graph.edges });
      upsertImageWorkflow(graph);
    },
    [canvasHistory, upsertImageWorkflow],
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
        // 连线层置于节点之上(见 index.css):隐形点击带收窄到 10px,
        // 连线压过卡片时不吞卡片上按钮/输入的点击
        interactionWidth: 10,
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

  // 指令通道(08-31-canvas-ops-layer):注册进 lib 总线,自动化测试经
  // dispatchCanvasCommand("image-workflow", cmd) 驱动,替代 CDP 摸 DOM
  useImageWorkflowCommands({
    activeGraph,
    saveGraph,
    deleteNode,
    generateNode,
    setSelectedNodeId,
    flowInstance,
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
  const [batchUpscaleDenoiseMode, setBatchUpscaleDenoiseMode] = useState<UpscaleDenoiseMode>("off");
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
    if (entries.length > 0) void upscaleBatch(entries, denoiseModeToOpts(batchUpscaleDenoiseMode));
  }, [batchUpscaleDenoiseMode, batchUpscaleSelection, upscaleBatch, upscalableNodes]);

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
  const handleTidyLayout = useCallback(() => {
    if (!activeGraph) return;
    const tidied = tidyImageWorkflowLayout(activeGraph);
    if (tidied === activeGraph) return;
    saveGraph(tidied);
    toast.success("已重排:输入(提示词/参考)居左、成图居右,连线走中间泳道");
    // 布局生效后一帧再适配视口(与首帧 fitView 同款时机)
    window.requestAnimationFrame(() => {
      window.setTimeout(() => flowInstance?.fitView({ ...FIT_VIEW_OPTIONS, duration: 260 }), 80);
    });
  }, [activeGraph, flowInstance, saveGraph]);

  // 连接落空创建(08-31-canvas-connect-create-menu):落点仅作菜单锚,
  // 节点落位走布局单源(createConnectedImageNode 内 nextStackedPosition)
  const handleConnectCreate = useCallback(
    (input: ConnectCreateInput) => {
      if (!activeGraph) return;
      const result = createConnectedImageNode(activeGraph, input);
      if (!result) return;
      saveGraph(result.graph);
      setSelectedNodeId(result.nodeId);
    },
    [activeGraph, saveGraph],
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

    if (workflowScope === "storyboard") {
      return (
        <section
          data-image-workflow-empty-storyboard
          className="flex min-h-[calc(100vh-190px)] items-center justify-center rounded-lg border border-border bg-card"
        >
          <div className="max-w-sm px-6 text-center text-sm text-muted-foreground">
            本章还没有分镜工作流——回分镜面板,从分镜卡片进入即可自动创建。
          </div>
        </section>
      );
    }
    return (
      <section className="flex min-h-[calc(100vh-190px)] items-center justify-center rounded-lg border border-border bg-card">
        <Button onClick={createNewFlow}>
          <Plus className="h-4 w-4" />
          新建自由工作流
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
          onConnectCreate={handleConnectCreate}
          canvasHistory={canvasHistory}
          uploadInputRef={uploadInputRef}
          onUploadReference={handleUploadReference}
        />
        <ImageWorkflowCanvasToolbar
          onBack={onBack}
          activeGraph={activeGraph}
          chromeReady={chromeReady}
          styleTraceChips={styleTraceChips}
          activeGeneratedNode={activeGeneratedNode}
          canUseGlobalWorkflowControls={canUseGlobalWorkflowControls}
          onCreateNewFlow={createNewFlow}
          onUploadReferenceClick={() => uploadInputRef.current?.click()}
          onAddGeneratedNode={addGeneratedNode}
          onAddStoryboardLayeredPair={addStoryboardLayeredPair}
          workflowWritebackTargetLabel={workflowWritebackTargetLabel}
          onApplyToStoryboard={(nodeId) => void applyNodeToStoryboard(nodeId)}
          upscalableCount={upscalableNodes.length}
          upscaleRunning={upscaleBatchState.running || isUpscaling}
          onOpenBatchUpscale={openBatchUpscaleDialog}
          onStoreInAssetLibrary={(nodeId) => void storeGeneratedNodeInAssetLibrary(nodeId)}
          showStoreInAssetLibrary={activeGraph.target.kind === "asset"}
          selectedEdgeId={selectedEdgeId}
          onDeleteSelectedEdge={deleteSelectedEdge}
          onTidyLayout={handleTidyLayout}
        />
      </div>

      <ImageWorkflowSidebar
        scope={workflowScope}
        activeGraph={activeGraph}
        storyboards={chapterStoryboards}
        imageWorkflows={imageWorkflows}
        chromeReady={chromeReady}
        onSelectStoryboard={(storyboard) => {
          const currentStoryboardId = activeGraph.target.kind === "storyboard" ? activeGraph.target.id : null;
          if (storyboard.id === currentStoryboardId) return;
          // 分镜域切镜恒走整条打开链(匹配/新建/装配)
          if (isScopedWorkflowDetail) {
            onOpenStoryboardWorkflow?.(buildSwitchContext(storyboard));
            return;
          }
          void switchStoryboardWorkflowInCanvas(storyboard);
        }}
        onSelectWorkflow={(workflowId) => {
          setActiveWorkflowId(workflowId);
          setSelectedNodeId(null);
          setPreferredGeneratedNodeId(null);
        }}
        canUseGlobalWorkflowControls={canUseGlobalWorkflowControls}
        imageMaterials={imageMaterials}
        storyboardImages={storyboardImages}
        onAddReferenceFromMaterial={addReferenceFromMaterial}
        onAddReferenceFromStoryboard={addReferenceFromStoryboard}
      />

      {/* 批量超分勾选清单 + 进行中进度浮层(T2 抽组件) */}
      <ImageWorkflowBatchUpscaleDialog
        open={isBatchUpscaleDialogOpen}
        onOpenChange={setIsBatchUpscaleDialogOpen}
        upscalableNodes={upscalableNodes}
        selection={batchUpscaleSelection}
        onSelectionChange={setBatchUpscaleSelection}
          denoiseMode={batchUpscaleDenoiseMode}
          onDenoiseModeChange={setBatchUpscaleDenoiseMode}
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
  initialAssetContext,
  reactFlowEdges,
  reactFlowNodes,
  onConnect,
  onConnectCreate,
  canvasHistory,
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
  initialAssetContext?: ImageWorkflowOpenContext;
  reactFlowEdges: Edge[];
  reactFlowNodes: ImageWorkflowReactNode[];
  onConnect: OnConnect;
  onConnectCreate: (input: ConnectCreateInput) => void;
  canvasHistory: CanvasHistoryController<{
    nodes: ImageWorkflowGraph["nodes"];
    edges: ImageWorkflowGraph["edges"];
  }>;
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
  const measurementNodeIds = useMemo(
    () => activeGraph.nodes.map((node) => node.id),
    [activeGraph.nodes],
  );

  useEffect(() => {
    setNodes(reactFlowNodes);
  }, [reactFlowNodes, setNodes]);

  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ImageWorkflowReactNode, Edge> | null>(null);

  // 连接落空创建菜单锚点(null=关);正常连上(isValid)不弹
  const [connectCreateAnchor, setConnectCreateAnchor] = useState<{
    x: number;
    y: number;
    fromNodeId: string;
    fromHandleType: "source" | "target";
  } | null>(null);

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      console.log("[connect-end-debug]", JSON.stringify({
        isValid: connectionState.isValid,
        fromNode: connectionState.fromNode?.id ?? null,
        fromHandleType: connectionState.fromHandle?.type ?? null,
      }));
      if (connectionState.isValid) return;
      const fromNode = connectionState.fromNode;
      const fromHandleType = connectionState.fromHandle?.type;
      if (!fromNode || (fromHandleType !== "source" && fromHandleType !== "target")) return;
      const point =
        "clientX" in event
          ? { x: event.clientX, y: event.clientY }
          : {
              x: event.changedTouches[0]?.clientX ?? 0,
              y: event.changedTouches[0]?.clientY ?? 0,
            };
      setConnectCreateAnchor({
        x: point.x,
        y: point.y,
        fromNodeId: fromNode.id,
        fromHandleType,
      });
    },
    [],
  );

  const connectCreateOptions = useMemo(
    () =>
      connectCreateAnchor
        ? getCreatableImageNodeTypes(connectCreateDirection(connectCreateAnchor.fromHandleType))
        : [],
    [connectCreateAnchor],
  );

  const handleConnectCreateSelect = useCallback(
    (type: "generated" | "prompt" | "reference") => {
      if (!connectCreateAnchor) return;
      onConnectCreate({
        fromNodeId: connectCreateAnchor.fromNodeId,
        fromHandleType: connectCreateAnchor.fromHandleType,
        type,
      });
      setConnectCreateAnchor(null);
    },
    [connectCreateAnchor, onConnectCreate],
  );

  // 08-30:fitView 触发键(稳定字符串,防对象身份抖动;不含选中/节点数)
  const initialAssetContextKey = initialAssetContext
    ? `${imageWorkflowTargetKey(initialAssetContext.target)}|${initialAssetContext.title}`
    : "";

  // 交互(拖节点/平移/缩放)期间给容器打标,CSS 把卡片大阴影、ReactFlow
  // Background pattern、毛玻璃等重活临时降级,松手/静止 180ms 后恢复。
  // 手势层单源(08-30 收敛 Phase2):两画布共用 useCanvasGestureKernel,
  // 类名/摘标延迟/缩放界为策略注入。
  const interactingRef = useRef<HTMLDivElement | null>(null);
  const {
    setInteracting,
    handleMoveStart,
    handleMoveEnd,
    handleNodeDragStart,
  } = useCanvasGestureKernel({
    containerRef: interactingRef,
    viewportApi: flowInstance && {
      getViewport: () => flowInstance.getViewport(),
      setViewport: (viewport) => flowInstance.setViewport(viewport),
    },
    interactingClass: "workflow-canvas-interacting",
    zoom: { minZoom: 0.5, maxZoom: 2 },
  });

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
  // 08-30 裁定:fitView 只在换流/实例就绪/带资产上下文打开时触发一次;
  // 旧依赖含 focusedFitNodeKey+nodes.length,点节点/按钮改选中或加节点
  // 就重排视口,被用户打回(「不要每次点击都整理布局」)。
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGraph.id, flowInstance, initialAssetContextKey]);

  return (
    <div ref={interactingRef} className="image-workflow-flow-host contents">
      <div className="pointer-events-none absolute bottom-3 left-3 z-10">
        <InteractionDeferHint />
      </div>
      {/* connectionMode=loose:允许从成图 target 手柄反向拖出建上游(提示词/
          参考图,strict 下 target 起拖被整体禁止);连线合法性由
          connectImageWorkflowNodes 域规则把关,不受 loose 放宽 */}
      <ReactFlow
        className="absolute inset-0 bg-muted/20"
        nodes={nodes}
        edges={reactFlowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onNodeClick(node.id)}
        onPaneClick={onPaneClick}
        onEdgeClick={(_, edge) => onEdgeClick(edge.id)}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={(_, node) => {
          setInteracting(false);
          onNodeDragStop(node.id, node.position);
        }}
        onMoveStart={handleMoveStart}
        onMoveEnd={handleMoveEnd}
        onConnect={onConnect}
        onConnectEnd={handleConnectEnd}
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
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <ImageWorkflowVisibilityMeasurementRefresh
          isVisible={Boolean(flowInstance)}
          nodeIds={measurementNodeIds}
        />
        <Background color="hsl(var(--border))" gap={28} size={1} />
        <CanvasViewportControls onFit={onFitView} history={canvasHistory} />
      </ReactFlow>
      {connectCreateAnchor ? (
        <ImageWorkflowConnectCreateMenu
          x={connectCreateAnchor.x}
          y={connectCreateAnchor.y}
          options={connectCreateOptions}
          onSelect={handleConnectCreateSelect}
          onClose={() => setConnectCreateAnchor(null)}
        />
      ) : null}
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

function ImageWorkflowVisibilityMeasurementRefresh({
  isVisible,
  nodeIds,
}: {
  isVisible: boolean;
  nodeIds: string[];
}) {
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    if (!isVisible || nodeIds.length === 0) return;

    const refreshFrame = window.requestAnimationFrame(() => {
      updateNodeInternals(nodeIds);
    });
    return () => window.cancelAnimationFrame(refreshFrame);
  }, [isVisible, nodeIds, updateNodeInternals]);

  return null;
}
