import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  useOnViewportChange,
  useNodesState,
  useReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Clapperboard,
  Maximize2,
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

const LR_POSITIONS = {
  script: { x: 0, y: 0 },
  scriptPlan: { x: 1120, y: 0 },
  assets: { x: 0, y: 660 },
  storyboardTable: { x: 1820, y: 0 },
  storyboard: { x: 2620, y: 0 },
  workbench: { x: 3360, y: 120 },
} satisfies Record<ProductionFlowNodeId, { x: number; y: number }>;

const FIT_VIEW_OPTIONS = {
  padding: 0.18,
  minZoom: 0.28,
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
  assets: { x: 160, y: 560 },
  scriptPlan: { x: 160, y: 940 },
  storyboardTable: { x: 160, y: 1260 },
  storyboard: { x: 160, y: 1580 },
  workbench: { x: 160, y: 1900 },
} satisfies Record<ProductionFlowNodeId, { x: number; y: number }>;

type ProductionFlowReactNode = Node<ProductionNodeData>;

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
}: {
  projectName: string;
  nodes: ProductionFlowNodeModel[];
  onStageChange: (stage: ProductionFlowStage) => void;
  onNodeEdit?: (nodeId: ProductionFlowNodeId) => void;
  onNodeAction?: (action: ProductionFlowNodeAction) => void | Promise<void>;
  onOpenAssetImageWorkflow?: (context: ImageWorkflowOpenContext) => void;
}) {
  const [layout, setLayout] = useState<"LR" | "TB">("LR");
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ProductionFlowReactNode, Edge> | null>(null);
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
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      return initialReactFlowNodes.map((node) => {
        const current = currentById.get(node.id);
        if (!current) return node;
        return {
          ...node,
          position: current.position,
          selected: current.selected,
          dragging: current.dragging,
        };
      });
    });
  }, [initialReactFlowNodes, setReactFlowNodes]);
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
        className: "production-flow-edge",
        markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--foreground))" },
        style: { stroke: "hsl(var(--foreground))", strokeWidth: 4 },
      })),
    [],
  );
  const toggleLayout = useCallback(() => {
    setLayout((current) => (current === "LR" ? "TB" : "LR"));
  }, []);
  useEffect(() => {
    if (!flowInstance) return;
    fitCanvasAfterLayout(flowInstance);
  }, [flowInstance, layout, nodes]);

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
            className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card/88 px-3 text-xs text-card-foreground backdrop-blur-md hover:bg-muted"
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
