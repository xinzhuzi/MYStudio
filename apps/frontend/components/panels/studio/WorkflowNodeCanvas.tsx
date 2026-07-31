import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type InternalNode,
  type Node,
  type NodeChange,
  useOnViewportChange,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Clapperboard,
  ExternalLink,
  Loader2,
  Maximize2,
  Play,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ImageWorkflowOpenContext } from "@/types/studio";
import type {
  ProductionFlowNodeAction,
  ProductionFlowNodeId,
  ProductionFlowNodeModel,
  ProductionFlowStage,
} from "./workflow-node-model";
import { PRODUCTION_FLOW_EDGES } from "./workflow-node-model";
import { ProductionFlowNode } from "./WorkflowProductionNode";
import type { ProductionNodeData } from "./WorkflowProductionNode";
import type { ChapterAutoVideoStatus } from "@/lib/studio/chapter-auto-video";

const PRODUCTION_NODE_WIDTHS = {
  script: 1040,
  scriptPlan: 680,
  assets: 760,
  storyboardTable: 700,
  storyboard: 640,
  remotionProduction: 760,
  workbench: 760,
} satisfies Record<ProductionFlowNodeId, number>;

const PRODUCTION_LAYOUT_GUTTER = 200;
const PRODUCTION_BRANCH_GUTTER = 200;
const PRODUCTION_MAINLINE_Y = 80;
const PRODUCTION_SCRIPT_VISUAL_HEIGHT = 620;
const PRODUCTION_NODE_FALLBACK_HEIGHTS = {
  script: PRODUCTION_SCRIPT_VISUAL_HEIGHT,
  scriptPlan: 820,
  assets: 760,
  storyboardTable: 760,
  storyboard: 760,
  remotionProduction: 720,
  workbench: 520,
} satisfies Record<ProductionFlowNodeId, number>;
const PRODUCTION_CANVAS_MIN_ZOOM = 0.18;
const PRODUCTION_CANVAS_MAX_ZOOM = 2.0;
const PRODUCTION_VIRTUALIZATION_THRESHOLD = 6;
const PRODUCTION_LAYOUT_MEASUREMENT_TIMEOUT_MS = 10_000;
const PRODUCTION_EDGE_COLOR = "hsl(var(--primary))";
const PRODUCTION_EDGE_STROKE_WIDTH = 3.5;

function productionNodeWidth(
  nodeId: ProductionFlowNodeId,
  measuredNodes?: Partial<Record<ProductionFlowNodeId, InternalNode<ProductionFlowReactNode>>>,
) {
  return measuredNodes?.[nodeId]?.measured.width ?? PRODUCTION_NODE_WIDTHS[nodeId];
}

function productionNodeHeight(
  nodeId: ProductionFlowNodeId,
  measuredNodes?: Partial<Record<ProductionFlowNodeId, InternalNode<ProductionFlowReactNode>>>,
) {
  return measuredNodes?.[nodeId]?.measured.height ?? PRODUCTION_NODE_FALLBACK_HEIGHTS[nodeId];
}

function nextProductionNodeX(
  previous: ProductionFlowNodeId,
  previousX: number,
  measuredNodes?: Partial<Record<ProductionFlowNodeId, InternalNode<ProductionFlowReactNode>>>,
) {
  return previousX + productionNodeWidth(previous, measuredNodes) + PRODUCTION_LAYOUT_GUTTER;
}

function centerProductionNodeUnder(
  parent: ProductionFlowNodeId,
  child: ProductionFlowNodeId,
  parentX: number,
  measuredNodes?: Partial<Record<ProductionFlowNodeId, InternalNode<ProductionFlowReactNode>>>,
) {
  return parentX + (
    productionNodeWidth(parent, measuredNodes) - productionNodeWidth(child, measuredNodes)
  ) / 2;
}

function buildMeasuredProductionPositions(
  measuredNodes?: Partial<Record<ProductionFlowNodeId, InternalNode<ProductionFlowReactNode>>>,
) {
  const scriptX = 0;
  const scriptPlanX = nextProductionNodeX("script", scriptX, measuredNodes);
  const storyboardTableX = nextProductionNodeX("scriptPlan", scriptPlanX, measuredNodes);
  const storyboardX = nextProductionNodeX("storyboardTable", storyboardTableX, measuredNodes);
  const remotionProductionX = nextProductionNodeX("storyboard", storyboardX, measuredNodes);
  const workbenchX = nextProductionNodeX("remotionProduction", remotionProductionX, measuredNodes);

  return {
    script: { x: scriptX, y: PRODUCTION_MAINLINE_Y },
    scriptPlan: { x: scriptPlanX, y: PRODUCTION_MAINLINE_Y },
    assets: {
      x: centerProductionNodeUnder("script", "assets", scriptX, measuredNodes),
      y: PRODUCTION_MAINLINE_Y + productionNodeHeight("script", measuredNodes) + PRODUCTION_BRANCH_GUTTER,
    },
    storyboardTable: { x: storyboardTableX, y: PRODUCTION_MAINLINE_Y },
    storyboard: { x: storyboardX, y: PRODUCTION_MAINLINE_Y },
    remotionProduction: { x: remotionProductionX, y: PRODUCTION_MAINLINE_Y },
    workbench: { x: workbenchX, y: PRODUCTION_MAINLINE_Y },
  } satisfies Record<ProductionFlowNodeId, { x: number; y: number }>;
}

const LR_POSITIONS = buildMeasuredProductionPositions();

const FIT_VIEW_OPTIONS = {
  padding: 0.22,
  minZoom: PRODUCTION_CANVAS_MIN_ZOOM,
  maxZoom: 0.72,
} as const;

function buildMeasuredTopBottomPositions(
  measuredNodes?: Partial<Record<ProductionFlowNodeId, InternalNode<ProductionFlowReactNode>>>,
) {
  const mainline: ProductionFlowNodeId[] = [
    "script",
    "scriptPlan",
    "storyboardTable",
    "storyboard",
    "remotionProduction",
    "workbench",
  ];
  const result = {} as Record<ProductionFlowNodeId, { x: number; y: number }>;
  let nextY = 0;
  for (const nodeId of mainline) {
    result[nodeId] = { x: 0, y: nextY };
    nextY += productionNodeHeight(nodeId, measuredNodes) + PRODUCTION_LAYOUT_GUTTER;
  }
  result.assets = {
    x: productionNodeWidth("script", measuredNodes) + PRODUCTION_BRANCH_GUTTER,
    y: result.script.y + productionNodeHeight("script", measuredNodes) + PRODUCTION_BRANCH_GUTTER,
  };
  return result;
}

const TB_POSITIONS = buildMeasuredTopBottomPositions();

type ProductionFlowReactNode = Node<ProductionNodeData>;

function measuredProductionPositions(
  instance: ReactFlowInstance<ProductionFlowReactNode, Edge>,
  layout: "LR" | "TB",
) {
  const measuredNodes = Object.fromEntries(
    (Object.keys(PRODUCTION_NODE_WIDTHS) as ProductionFlowNodeId[]).map((nodeId) => [
      nodeId,
      instance.getInternalNode(nodeId),
    ]),
  ) as Partial<Record<ProductionFlowNodeId, InternalNode<ProductionFlowReactNode>>>;

  return layout === "LR"
    ? buildMeasuredProductionPositions(measuredNodes)
    : buildMeasuredTopBottomPositions(measuredNodes);
}

function CanvasVisibilityMeasurementRefresh({
  isVisible,
  nodeIds,
  onRefreshed,
}: {
  isVisible: boolean;
  nodeIds: ProductionFlowNodeId[];
  onRefreshed: () => void;
}) {
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    if (!isVisible || nodeIds.length === 0) return;

    let layoutRefreshFrame: number | null = null;
    const refreshInternalsFrame = window.requestAnimationFrame(() => {
      updateNodeInternals(nodeIds);
      // updateNodeInternals performs its own rAF measurement. Schedule layout
      // after that pass rather than relying on a potentially stale store flag.
      layoutRefreshFrame = window.requestAnimationFrame(onRefreshed);
    });

    return () => {
      window.cancelAnimationFrame(refreshInternalsFrame);
      if (layoutRefreshFrame !== null) {
        window.cancelAnimationFrame(layoutRefreshFrame);
      }
    };
  }, [isVisible, nodeIds, onRefreshed, updateNodeInternals]);

  return null;
}

function CanvasViewportControls({
  onViewportControlStart,
  onFit,
}: {
  onViewportControlStart: () => void;
  onFit: () => void;
}) {
  const reactFlow = useReactFlow<ProductionFlowReactNode, Edge>();
  const [zoomPercent, setZoomPercent] = useState(100);

  useOnViewportChange({
    onChange: (viewport) => {
      setZoomPercent(Math.round(viewport.zoom * 100));
    },
    onEnd: (viewport) => {
      setZoomPercent(Math.round(viewport.zoom * 100));
    },
  });

  return (
    <Panel
      position="bottom-left"
      className="workflow-node-viewport-controls nodrag nopan"
    >
      <div className="flex max-w-[calc(100vw-3rem)] items-center gap-1 rounded-lg border border-border/80 bg-card p-1 text-xs text-card-foreground">
        <button
          type="button"
          aria-label="缩小画布"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onViewportControlStart();
            void reactFlow.zoomOut({ duration: 180 });
          }}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-16 px-2 text-center text-sm font-semibold tabular-nums text-foreground">
          {zoomPercent}%
        </span>
        <button
          type="button"
          aria-label="放大画布"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onViewportControlStart();
            void reactFlow.zoomIn({ duration: 180 });
          }}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="适配画布"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/70 bg-muted/70 px-3 text-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={onFit}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          适配
        </button>
      </div>
    </Panel>
  );
}

const nodeTypes = { productionFlow: ProductionFlowNode };

export function WorkflowNodeCanvas({
  isVisible,
  projectName,
  nodes,
  onStageChange,
  onNodeEdit,
  onNodeJson,
  onNodeAction,
  onOpenAssetImageWorkflow,
  chapterAutoVideoStatus,
  chapterAutoVideoRunning = false,
  onRunChapterAutoVideo,
  onOpenFinalVideo,
}: {
  isVisible: boolean;
  projectName: string;
  nodes: ProductionFlowNodeModel[];
  onStageChange: (stage: ProductionFlowStage) => void;
  onNodeEdit?: (nodeId: ProductionFlowNodeId) => void;
  onNodeJson?: (nodeId: ProductionFlowNodeId) => void;
  onNodeAction?: (action: ProductionFlowNodeAction) => void | Promise<void>;
  onOpenAssetImageWorkflow?: (context: ImageWorkflowOpenContext) => void;
  chapterAutoVideoStatus?: ChapterAutoVideoStatus;
  chapterAutoVideoRunning?: boolean;
  onRunChapterAutoVideo?: () => void | Promise<void>;
  onOpenFinalVideo?: () => void | Promise<void>;
}) {
  const [layout, setLayout] = useState<"LR" | "TB">("LR");
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ProductionFlowReactNode, Edge> | null>(null);
  const canvasSectionRef = useRef<HTMLElement | null>(null);
  const pendingLayoutFrameRef = useRef<number | null>(null);
  const measuredLayoutKeyRef = useRef<string | null>(null);
  const measuredNodeDimensionsRef = useRef(new Map<string, string>());
  const layoutVersionRef = useRef(0);
  const userViewportOwnedRef = useRef(false);
  const pendingLayoutFitModeRef = useRef<"initial" | "explicit">("initial");
  const positions = layout === "LR" ? LR_POSITIONS : TB_POSITIONS;
  const productionNodeIdsKey = nodes.map((node) => node.id).join("\u001f");
  const productionNodeIds = useMemo(
    () => productionNodeIdsKey.split("\u001f") as ProductionFlowNodeId[],
    [productionNodeIdsKey],
  );
  const layoutKey = JSON.stringify({ projectName, layout, productionNodeIds });
  const activeLayoutKeyRef = useRef(layoutKey);
  const productionNodeIdsRef = useRef(productionNodeIds);
  activeLayoutKeyRef.current = layoutKey;
  productionNodeIdsRef.current = productionNodeIds;
  const previousLayoutKeyRef = useRef(layoutKey);
  const versionedLayoutKeyRef = useRef(layoutKey);
  const initialReactFlowNodes = useMemo<ProductionFlowReactNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "productionFlow",
        position: positions[node.id],
        sourcePosition: layout === "LR" ? Position.Right : Position.Bottom,
        targetPosition:
          node.id === "assets" ? Position.Top : layout === "LR" ? Position.Left : Position.Top,
        data: {
          node,
          sourcePosition: layout === "LR" ? Position.Right : Position.Bottom,
          targetPosition:
            node.id === "assets" ? Position.Top : layout === "LR" ? Position.Left : Position.Top,
          onStageChange,
          onNodeEdit,
          onNodeJson,
          onNodeAction,
          onOpenAssetImageWorkflow,
        },
      })),
    [
      layout,
      nodes,
      onNodeAction,
      onNodeEdit,
      onNodeJson,
      onOpenAssetImageWorkflow,
      onStageChange,
      positions,
    ],
  );
  const [reactFlowNodes, setReactFlowNodes, applyReactFlowNodeChanges] =
    useNodesState<ProductionFlowReactNode>(initialReactFlowNodes);
  const cancelPendingLayoutWork = useCallback(() => {
    if (pendingLayoutFrameRef.current === null) return;
    window.cancelAnimationFrame(pendingLayoutFrameRef.current);
    pendingLayoutFrameRef.current = null;
  }, []);
  const claimViewportForUser = useCallback(() => {
    userViewportOwnedRef.current = true;
    cancelPendingLayoutWork();
  }, [cancelPendingLayoutWork]);
  const scheduleMeasuredLayoutFit = useCallback((
    mode: "initial" | "explicit",
    forceLayout = false,
  ) => {
    if (!flowInstance || !isVisible) return;
    const scheduledLayoutKey = layoutKey;
    const scheduledLayoutVersion = layoutVersionRef.current;
    if (!forceLayout && measuredLayoutKeyRef.current === scheduledLayoutKey) return;
    cancelPendingLayoutWork();
    const retryMeasurementUntil = performance.now() + PRODUCTION_LAYOUT_MEASUREMENT_TIMEOUT_MS;
    const applyMeasuredLayout = () => {
      pendingLayoutFrameRef.current = null;
      if (activeLayoutKeyRef.current !== scheduledLayoutKey) return;
      if (layoutVersionRef.current !== scheduledLayoutVersion) return;
      if (mode === "initial" && userViewportOwnedRef.current) return;

      const currentNodeIds = productionNodeIdsRef.current;
      const hasAllMeasurements = currentNodeIds.every((nodeId) => {
        const measured = flowInstance.getInternalNode(nodeId)?.measured;
        return Boolean(measured?.width && measured.height);
      });
      if (!hasAllMeasurements) {
        if (performance.now() < retryMeasurementUntil) {
          pendingLayoutFrameRef.current = window.requestAnimationFrame(applyMeasuredLayout);
        }
        return;
      }

      const layoutPositions = measuredProductionPositions(flowInstance, layout);
      setReactFlowNodes((currentNodes) =>
        currentNodes.map((node) => {
          const position = layoutPositions[node.id as ProductionFlowNodeId];
          return position
            ? { ...node, position, selected: false, dragging: false }
            : node;
        }),
      );
      pendingLayoutFrameRef.current = window.requestAnimationFrame(() => {
        pendingLayoutFrameRef.current = null;
        if (activeLayoutKeyRef.current !== scheduledLayoutKey) return;
        if (layoutVersionRef.current !== scheduledLayoutVersion) return;
        if (mode === "initial" && userViewportOwnedRef.current) return;
        measuredLayoutKeyRef.current = scheduledLayoutKey;
        void flowInstance.fitView({
          ...FIT_VIEW_OPTIONS,
          duration: 0,
        });
      });
    };
    pendingLayoutFrameRef.current = window.requestAnimationFrame(applyMeasuredLayout);
  }, [cancelPendingLayoutWork, flowInstance, isVisible, layout, layoutKey, positions, setReactFlowNodes]);
  useEffect(() => {
    setReactFlowNodes((currentNodes) => {
      const layoutChanged = previousLayoutKeyRef.current !== layoutKey;
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      const nextNodes = initialReactFlowNodes.map((node) => {
        const current = currentById.get(node.id);
        if (!current || layoutChanged) {
          return {
            ...node,
            position: positions[node.id as ProductionFlowNodeId],
            selected: false,
            dragging: false,
          };
        }
        return {
          ...node,
          measured: current.measured,
          position: current.position,
          selected: current.selected,
          dragging: current.dragging,
        };
      });
      previousLayoutKeyRef.current = layoutKey;
      return nextNodes;
    });
  }, [initialReactFlowNodes, layoutKey, positions, setReactFlowNodes]);
  const reactFlowEdges = useMemo<Edge[]>(
    () =>
      PRODUCTION_FLOW_EDGES.map(([source, target]) => ({
        id: `${source}->${target}`,
        source,
        target,
        sourceHandle:
          source === "script" && target === "assets"
            ? "script-assets-source"
            : `${source}-source`,
        targetHandle: `${target}-target`,
        data: { flowEdgeId: `${source}->${target}` },
        type: "smoothstep",
        className: "production-flow-edge",
        interactionWidth: 18,
        markerEnd: { type: MarkerType.ArrowClosed, color: PRODUCTION_EDGE_COLOR },
        style: { stroke: PRODUCTION_EDGE_COLOR, strokeWidth: PRODUCTION_EDGE_STROKE_WIDTH },
      })),
    [],
  );
  const toggleLayout = useCallback(() => {
    pendingLayoutFitModeRef.current = "explicit";
    setLayout((current) => (current === "LR" ? "TB" : "LR"));
  }, []);
  const resetLayout = useCallback(() => {
    scheduleMeasuredLayoutFit("explicit", true);
  }, [scheduleMeasuredLayoutFit]);
  const handleExplicitFit = useCallback(() => {
    if (!flowInstance) return;
    claimViewportForUser();
    void flowInstance.fitView({ ...FIT_VIEW_OPTIONS, duration: 0 });
  }, [claimViewportForUser, flowInstance]);
  const handleViewportMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    canvasSectionRef.current?.classList.add("workflow-node-canvas-interacting");
    if (event) claimViewportForUser();
  }, [claimViewportForUser]);
  const handleViewportMoveEnd = useCallback(() => {
    canvasSectionRef.current?.classList.remove("workflow-node-canvas-interacting");
  }, []);
  const onNodesChange = useCallback((changes: NodeChange<ProductionFlowReactNode>[]) => {
    if (changes.some((change) => change.type === "position" && change.dragging)) {
      claimViewportForUser();
    }
    let dimensionsChanged = false;
    for (const change of changes) {
      if (change.type !== "dimensions" || !change.dimensions) continue;
      const signature = `${change.dimensions.width}x${change.dimensions.height}`;
      if (measuredNodeDimensionsRef.current.get(change.id) === signature) continue;
      measuredNodeDimensionsRef.current.set(change.id, signature);
      dimensionsChanged = true;
    }
    applyReactFlowNodeChanges(changes);
    if (dimensionsChanged) {
      scheduleMeasuredLayoutFit("initial", true);
    }
  }, [applyReactFlowNodeChanges, claimViewportForUser, scheduleMeasuredLayoutFit]);
  const handleVisibleInternalsRefreshed = useCallback(() => {
    const mode = pendingLayoutFitModeRef.current;
    if (mode === "initial" && userViewportOwnedRef.current) return;
    pendingLayoutFitModeRef.current = "initial";
    scheduleMeasuredLayoutFit(mode);
  }, [scheduleMeasuredLayoutFit]);
  useEffect(() => {
    cancelPendingLayoutWork();
    if (versionedLayoutKeyRef.current !== layoutKey) {
      layoutVersionRef.current += 1;
      versionedLayoutKeyRef.current = layoutKey;
    }
    userViewportOwnedRef.current = false;
    measuredLayoutKeyRef.current = null;
    return cancelPendingLayoutWork;
  }, [cancelPendingLayoutWork, layoutKey]);
  useEffect(() => {
    if (!isVisible) cancelPendingLayoutWork();
  }, [cancelPendingLayoutWork, isVisible]);
  useEffect(() => {
    const handleResize = () => {
      cancelPendingLayoutWork();
      if (!isVisible) return;
      if (measuredLayoutKeyRef.current === layoutKey) return;
      if (userViewportOwnedRef.current) return;
      scheduleMeasuredLayoutFit("initial");
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelPendingLayoutWork();
    };
  }, [cancelPendingLayoutWork, isVisible, layoutKey, scheduleMeasuredLayoutFit]);

  return (
    <section
      ref={canvasSectionRef}
      className="workflow-node-canvas production-video-stage grid h-full min-h-[calc(100vh-190px)] w-full flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border border-border text-foreground"
    >
      <div className="workflow-node-static-background relative min-w-0 overflow-hidden">
        <div className="workflow-node-toolbar pointer-events-none absolute left-5 top-5 z-30 flex flex-wrap items-center gap-2">
          <div className="mr-3 min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">
              {projectName}
            </h3>
          </div>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-9 max-w-[320px] items-center gap-2 rounded-md border border-border bg-card px-3 text-xs text-card-foreground"
          >
            <Clapperboard className="h-4 w-4" />
            <span className="truncate">{projectName} EP01</span>
          </button>
          <button
            type="button"
            aria-label="重排当前画布"
            title="重排当前画布"
            className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs text-card-foreground hover:bg-muted"
            onClick={resetLayout}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs text-card-foreground hover:bg-muted"
            onClick={toggleLayout}
          >
            自动排版 {layout}
          </button>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md border border-primary/60 bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={chapterAutoVideoRunning || !onRunChapterAutoVideo}
            onClick={() => void onRunChapterAutoVideo?.()}
          >
            {chapterAutoVideoRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {chapterAutoVideoRunning ? "第一章成片中" : "一键第一章成片"}
          </button>
          {chapterAutoVideoStatus ? (
            <div
              className="pointer-events-auto inline-flex h-9 max-w-[360px] items-center rounded-md border border-border bg-card px-3 text-xs text-card-foreground"
              title={chapterAutoVideoStatus.error || chapterAutoVideoStatus.detail}
              data-auto-video-stage={chapterAutoVideoStatus.stage}
            >
              <span className="truncate">
                {chapterAutoVideoStatus.error
                  ? `失败：${chapterAutoVideoStatus.error}`
                  : chapterAutoVideoStatus.detail}
              </span>
            </div>
          ) : null}
          {chapterAutoVideoStatus?.finalPath ? (
            <button
              type="button"
              className="pointer-events-auto inline-flex min-h-9 max-w-[560px] items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-card-foreground hover:bg-muted"
              title={chapterAutoVideoStatus.finalPath}
              onClick={() => void onOpenFinalVideo?.()}
            >
              <ExternalLink className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block font-medium">打开最终 MP4</span>
                <span className="block break-all font-mono text-[10px] leading-4 text-muted-foreground">
                  {chapterAutoVideoStatus.finalPath}
                </span>
              </span>
            </button>
          ) : null}
        </div>
        <ReactFlow
          className="production-flow-reactflow absolute inset-0"
          nodes={reactFlowNodes}
          edges={reactFlowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onInit={(instance) => {
            setFlowInstance(instance);
          }}
          onMoveStart={handleViewportMoveStart}
          onMoveEnd={handleViewportMoveEnd}
          minZoom={PRODUCTION_CANVAS_MIN_ZOOM}
          maxZoom={PRODUCTION_CANVAS_MAX_ZOOM}
          onlyRenderVisibleElements={reactFlowNodes.length > PRODUCTION_VIRTUALIZATION_THRESHOLD}
          nodesDraggable
          nodeDragThreshold={2}
          nodesConnectable={false}
          elementsSelectable
          panOnDrag={[0]}
          panOnScroll={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          proOptions={{ hideAttribution: true }}
        >
          <CanvasVisibilityMeasurementRefresh
            isVisible={isVisible && Boolean(flowInstance)}
            nodeIds={productionNodeIds}
            onRefreshed={handleVisibleInternalsRefreshed}
          />
          <CanvasViewportControls
            onViewportControlStart={claimViewportForUser}
            onFit={handleExplicitFit}
          />
        </ReactFlow>
      </div>
    </section>
  );
}
