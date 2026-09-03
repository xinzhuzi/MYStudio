import { CanvasViewportControls } from "../CanvasViewportControls";
import { GenerationFailedDialog } from "@/components/ui/generation-failed-dialog";
import { nodeTypes, FIT_VIEW_OPTIONS, ImageWorkflowVisibilityMeasurementRefresh } from "./ImageWorkflowCanvas";
import { useCanvasGestureKernel } from "../use-canvas-gesture-kernel";
import type { CanvasHistoryController } from "../use-canvas-history";
import { ImageWorkflowConnectCreateMenu } from "./image-workflow-connect-create-menu";
import { imageWorkflowTargetKey } from "./image-workflow-graph-utils";
import { ImageWorkflowReactNode } from "./image-workflow-node-card";
import { ConnectCreateInput, connectCreateDirection, getCreatableImageNodeTypes } from "@/lib/studio/image-workflow/connect-create";
import type { ImageWorkflowGraph, ImageWorkflowOpenContext } from "@/types/studio";
import {
  Background,
  BackgroundVariant,
  Edge,
  FinalConnectionState,
  OnConnect,
  ReactFlow,
  ReactFlowInstance,
  useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * 画布流视图子组件——React Flow 实例装配与连线/选择/键盘交互(主 Canvas 的 JSX 主体,~230 行)。file-size-reduction P3 拆出,体逐字保留。
 */
export function ImageWorkflowFlowView({
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
  const [backgroundMode, setBackgroundMode] = useState<"dots" | "lines" | "blank">(() => {
    try {
      const saved = window.localStorage.getItem("studio-canvas-background");
      return saved === "lines" || saved === "blank" ? saved : "dots";
    } catch {
      return "dots";
    }
  });
  // 节点集按成员签名判等(assist 面实弹失焦根修的同款隐患):打字只改节点
  // 内容不改集合,防每键全量 updateNodeInternals → 重测窗口节点隐藏失焦。
  const nodeIdsSignature = activeGraph.nodes.map((node) => node.id).join("\u0001");
  const measurementNodeIds = useMemo(
    () => nodeIdsSignature.split("\u0001"),
    [nodeIdsSignature],
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

  const connectCreateOptions = useMemo(() => {
    if (!connectCreateAnchor) return [];
    const options = getCreatableImageNodeTypes(
      connectCreateDirection(connectCreateAnchor.fromHandleType),
    );
    // upstream(从成图输入手柄拖出)且该成图已挂提示词源:不再提供提示词候选
    // ——一个成图只接一根提示词边(09-03),提供必被单源拒绝的死选项只会困惑
    if (connectCreateAnchor.fromHandleType === "target") {
      const graph = activeGraph;
      const hasPrompt =
        graph &&
        graph.edges.some(
          (edge) =>
            edge.target === connectCreateAnchor.fromNodeId &&
            graph.nodes.find((node) => node.id === edge.source)?.type === "prompt",
        );
      if (hasPrompt) return options.filter((option) => option.type !== "prompt");
    }
    return options;
  }, [connectCreateAnchor, activeGraph]);

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
        isValidConnection={(connection) =>
          connection.target !== connection.source &&
          activeGraph?.nodes.find((node) => node.id === connection.target)?.type === "generated" &&
          !(
            connection.source &&
            activeGraph?.nodes.find((node) => node.id === connection.source)?.type === "prompt" &&
            activeGraph.edges.some(
              (edge) =>
                edge.target === connection.target &&
                activeGraph.nodes.find((node) => node.id === edge.source)?.type === "prompt",
            )
          )
        }
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
        {backgroundMode === "blank" ? null : (
          <Background
            variant={backgroundMode === "dots" ? BackgroundVariant.Dots : BackgroundVariant.Lines}
            color="hsl(var(--border))"
            gap={28}
            size={1}
          />
        )}
        <CanvasViewportControls
          onFit={onFitView}
          history={canvasHistory}
          onBackgroundModeChange={setBackgroundMode}
        />
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
      <GenerationFailedDialog surface="image-workflow" />
    </div>
  );
}
