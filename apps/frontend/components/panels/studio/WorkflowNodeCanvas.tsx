import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type InternalNode,
  type Node,
  useOnViewportChange,
  useNodesState,
  useReactFlow,
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
  workbench: 760,
} satisfies Record<ProductionFlowNodeId, number>;

const PRODUCTION_LAYOUT_GUTTER = 200;
const PRODUCTION_BRANCH_GUTTER = 200;
const PRODUCTION_MAINLINE_Y = 80;
const PRODUCTION_SCRIPT_VISUAL_HEIGHT = 620;
const PRODUCTION_CANVAS_MIN_ZOOM = 0.18;
const PRODUCTION_CANVAS_MAX_ZOOM = 1.2;
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
  return measuredNodes?.[nodeId]?.measured.height ?? (
    nodeId === "script" ? PRODUCTION_SCRIPT_VISUAL_HEIGHT : 0
  );
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
  const workbenchX = nextProductionNodeX("storyboard", storyboardX, measuredNodes);

  return {
    script: { x: scriptX, y: PRODUCTION_MAINLINE_Y },
    scriptPlan: { x: scriptPlanX, y: PRODUCTION_MAINLINE_Y },
    assets: {
      x: centerProductionNodeUnder("script", "assets", scriptX, measuredNodes),
      y: PRODUCTION_MAINLINE_Y + productionNodeHeight("script", measuredNodes) + PRODUCTION_BRANCH_GUTTER,
    },
    storyboardTable: { x: storyboardTableX, y: PRODUCTION_MAINLINE_Y },
    storyboard: { x: storyboardX, y: PRODUCTION_MAINLINE_Y },
    workbench: { x: workbenchX, y: PRODUCTION_MAINLINE_Y },
  } satisfies Record<ProductionFlowNodeId, { x: number; y: number }>;
}

const LR_POSITIONS = buildMeasuredProductionPositions();

const FIT_VIEW_OPTIONS = {
  padding: 0.18,
  minZoom: PRODUCTION_CANVAS_MIN_ZOOM,
  maxZoom: 0.72,
} as const;

function fitCanvasAfterLayout(
  instance: ReactFlowInstance<ProductionFlowReactNode, Edge>,
) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      void instance.fitView({ ...FIT_VIEW_OPTIONS, duration: 180 });
    });
  });
}

const TB_POSITIONS = {
  script: { x: 160, y: 0 },
  assets: { x: 160, y: PRODUCTION_SCRIPT_VISUAL_HEIGHT + PRODUCTION_BRANCH_GUTTER },
  scriptPlan: { x: 160, y: 1040 },
  storyboardTable: { x: 160, y: 1380 },
  storyboard: { x: 160, y: 1720 },
  workbench: { x: 160, y: 2060 },
} satisfies Record<ProductionFlowNodeId, { x: number; y: number }>;

type ProductionFlowReactNode = Node<ProductionNodeData>;

function measuredProductionPositions(
  instance: ReactFlowInstance<ProductionFlowReactNode, Edge>,
) {
  const measuredNodes = Object.fromEntries(
    (Object.keys(PRODUCTION_NODE_WIDTHS) as ProductionFlowNodeId[]).map((nodeId) => [
      nodeId,
      instance.getInternalNode(nodeId),
    ]),
  ) as Partial<Record<ProductionFlowNodeId, InternalNode<ProductionFlowReactNode>>>;

  return buildMeasuredProductionPositions(measuredNodes);
}

function CanvasViewportControls() {
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
      <div className="flex max-w-[calc(100vw-3rem)] items-center gap-1 rounded-lg border border-border/80 bg-card/95 p-1 text-xs text-card-foreground shadow-[0_18px_48px_rgba(0,0,0,0.34)] backdrop-blur-md">
        <button
          type="button"
          aria-label="缩小画布"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => reactFlow.zoomOut({ duration: 180 })}
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
          onClick={() => reactFlow.zoomIn({ duration: 180 })}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="适配画布"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/70 bg-muted/70 px-3 text-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => reactFlow.fitView({ padding: 0.22, duration: 220 })}
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
  projectName,
  nodes,
  onStageChange,
  onNodeEdit,
  onNodeAction,
  onOpenAssetImageWorkflow,
  chapterAutoVideoStatus,
  chapterAutoVideoRunning = false,
  onRunChapterAutoVideo,
  onOpenFinalVideo,
}: {
  projectName: string;
  nodes: ProductionFlowNodeModel[];
  onStageChange: (stage: ProductionFlowStage) => void;
  onNodeEdit?: (nodeId: ProductionFlowNodeId) => void;
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
  const previousLayoutRef = useRef(layout);
  const didApplyMeasuredLayoutRef = useRef(false);
  const positions = layout === "LR" ? LR_POSITIONS : TB_POSITIONS;
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
          onStageChange,
          onNodeEdit,
          onNodeAction,
          onOpenAssetImageWorkflow,
        },
      })),
    [
      layout,
      nodes,
      onNodeAction,
      onNodeEdit,
      onOpenAssetImageWorkflow,
      onStageChange,
      positions,
    ],
  );
  const [reactFlowNodes, setReactFlowNodes, onNodesChange] =
    useNodesState<ProductionFlowReactNode>(initialReactFlowNodes);
  useEffect(() => {
    setReactFlowNodes((currentNodes) => {
      const layoutChanged = previousLayoutRef.current !== layout;
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      const layoutPositions =
        layout === "LR" && flowInstance ? measuredProductionPositions(flowInstance) : positions;
      const nextNodes = initialReactFlowNodes.map((node) => {
        const current = currentById.get(node.id);
        if (!current || layoutChanged) {
          return {
            ...node,
            position: layoutPositions[node.id as ProductionFlowNodeId],
            selected: false,
            dragging: false,
          };
        }
        return {
          ...node,
          position: current.position,
          selected: current.selected,
          dragging: current.dragging,
        };
      });
      previousLayoutRef.current = layout;
      return nextNodes;
    });
  }, [flowInstance, initialReactFlowNodes, layout, positions, setReactFlowNodes]);
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
    setLayout((current) => (current === "LR" ? "TB" : "LR"));
  }, []);
  const resetLayout = useCallback(() => {
    const measuredPositions =
      layout === "LR" && flowInstance ? measuredProductionPositions(flowInstance) : positions;
    setReactFlowNodes((currentNodes) =>
      currentNodes.map((node) => {
        const position = measuredPositions[node.id as ProductionFlowNodeId];
        return position
          ? { ...node, position, selected: false, dragging: false }
          : node;
      }),
    );
    if (flowInstance) fitCanvasAfterLayout(flowInstance);
  }, [flowInstance, layout, positions, setReactFlowNodes]);
  useEffect(() => {
    if (!flowInstance) return;
    fitCanvasAfterLayout(flowInstance);
  }, [flowInstance, layout, nodes]);
  useEffect(() => {
    if (!flowInstance || layout !== "LR" || didApplyMeasuredLayoutRef.current) return;
    const hasAllMeasurements = nodes.every((node) => {
      const measured = flowInstance.getInternalNode(node.id)?.measured;
      return Boolean(measured?.width && measured.height);
    });
    if (!hasAllMeasurements) return;
    didApplyMeasuredLayoutRef.current = true;
    setReactFlowNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        position: measuredProductionPositions(flowInstance)[node.id as ProductionFlowNodeId],
      })),
    );
    fitCanvasAfterLayout(flowInstance);
  }, [flowInstance, layout, nodes, setReactFlowNodes]);

  return (
    <section className="workflow-node-canvas production-video-stage grid h-full min-h-[calc(100vh-190px)] w-full flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-background text-foreground">
      <div className="relative min-w-0 overflow-hidden">
        <div className="workflow-node-toolbar pointer-events-none absolute left-5 top-5 z-30 flex flex-wrap items-center gap-2">
          <div className="mr-3 min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">
              {projectName}
            </h3>
          </div>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-9 max-w-[320px] items-center gap-2 rounded-md border border-border bg-card/88 px-3 text-xs text-card-foreground shadow-[0_14px_34px_rgba(0,0,0,0.16)] backdrop-blur-md"
          >
            <Clapperboard className="h-4 w-4" />
            <span className="truncate">{projectName} EP01</span>
          </button>
          <button
            type="button"
            aria-label="重排当前画布"
            title="重排当前画布"
            className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card/88 px-3 text-xs text-card-foreground backdrop-blur-md hover:bg-muted"
            onClick={resetLayout}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card/88 px-3 text-xs text-card-foreground backdrop-blur-md hover:bg-muted"
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
              className="pointer-events-auto inline-flex h-9 max-w-[360px] items-center rounded-md border border-border bg-card/88 px-3 text-xs text-card-foreground backdrop-blur-md"
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
              className="pointer-events-auto inline-flex min-h-9 max-w-[560px] items-center gap-2 rounded-md border border-border bg-card/88 px-3 py-2 text-left text-xs text-card-foreground backdrop-blur-md hover:bg-muted"
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
          className="production-flow-reactflow absolute inset-0 bg-background"
          nodes={reactFlowNodes}
          edges={reactFlowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onInit={(instance) => {
            setFlowInstance(instance);
            fitCanvasAfterLayout(instance);
          }}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={PRODUCTION_CANVAS_MIN_ZOOM}
          maxZoom={PRODUCTION_CANVAS_MAX_ZOOM}
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
          <Background color="hsl(var(--border))" gap={30} size={1} />
          <CanvasViewportControls />
        </ReactFlow>
      </div>
    </section>
  );
}
