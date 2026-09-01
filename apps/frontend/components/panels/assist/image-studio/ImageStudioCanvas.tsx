// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  MarkerType,
  ReactFlow,
  type Edge,
  type ReactFlowInstance,
  useNodesState,
  useUpdateNodeInternals,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CanvasViewportControls } from "@/components/panels/studio/CanvasViewportControls";
import { InteractionDeferHint } from "@/components/panels/studio/previews/interaction-defer-hint";
import { useCanvasGestureKernel } from "@/components/panels/studio/use-canvas-gesture-kernel";
// 画布手势内核/门闸提示与分镜画布共用(08-30 收敛 Phase2 之后再整体上提 features/)
import { findPromptNodeForGenerated } from "@/lib/studio/image-workflow/graph-build";
import { saveReferenceFile } from "@/lib/assist/image-studio/reference-upload";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import type { ImageWorkflowGraph, ImageWorkflowNode } from "@/types/studio";
import { GenerationHistory } from "../GenerationHistory";
import { SaveToPropsDialog } from "../SaveToPropsDialog";
import {
  imageStudioNodeTypes,
  type ImageStudioReactNode,
} from "./image-studio-node-card";
import { ImageStudioToolbar } from "./image-studio-toolbar";
import { useImageStudioGeneration } from "./use-image-studio-generation";

const FIT_VIEW_OPTIONS = { padding: 0.18, minZoom: 0.35, maxZoom: 1.1 } as const;

type UploadTarget =
  | { mode: "new-group" }
  | { mode: "new-reference" }
  | { mode: "replace"; nodeId: string };

/**
 * 图片工作室无限画布(辅助面板)。
 *
 * 交互模式与分镜画布(ImageWorkflowCanvas)同源:React Flow + 手势内核 +
 * 交互门闸;差异是自由域——多画布本地切换、无分镜指纹/资产桥/回写链,
 * 节点操作全部走 image-studio-store(应用级持久化,不依赖项目)。
 */
export function ImageStudioCanvas() {
  const workflows = useImageStudioStore((state) => state.workflows);
  const activeWorkflowId = useImageStudioStore((state) => state.activeWorkflowId);
  const nodeExtras = useImageStudioStore((state) => state.nodeExtras);
  const updateNode = useImageStudioStore((state) => state.updateNode);
  const setNodeExtras = useImageStudioStore((state) => state.setNodeExtras);
  const removeNode = useImageStudioStore((state) => state.removeNode);
  const connect = useImageStudioStore((state) => state.connect);
  const removeEdge = useImageStudioStore((state) => state.removeEdge);
  const moveNode = useImageStudioStore((state) => state.moveNode);
  const setViewport = useImageStudioStore((state) => state.setViewport);

  const activeGraph = useMemo(
    () => workflows.find((workflow) => workflow.id === activeWorkflowId),
    [workflows, activeWorkflowId],
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [propsDialog, setPropsDialog] = useState<{ imageUrl: string; prompt: string } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [flowInstance, setFlowInstance] = useState<
    ReactFlowInstance<ImageStudioReactNode, Edge> | null
  >(null);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<UploadTarget | null>(null);
  const seedDoneRef = useRef(false);
  const viewportSaveTimer = useRef<number | null>(null);

  const { generateNode, stopNode, upscaleNode } = useImageStudioGeneration();

  useEffect(() => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
  }, []);

  // 种子提示词(资产弹窗「带入图片工作室」):进入时物化一次生成组
  const seedPrompt = useFreedomStore((state) => state.imagePrompt);
  const seedModel = useFreedomStore((state) => state.selectedImageModel);
  useEffect(() => {
    const trimmed = seedPrompt.trim();
    if (!trimmed) {
      seedDoneRef.current = false;
      return;
    }
    if (seedDoneRef.current) return;
    seedDoneRef.current = true;
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    store.addGenerationGroup({ prompt: trimmed, model: seedModel || undefined });
    useFreedomStore.getState().setImagePrompt("");
  }, [seedPrompt, seedModel]);

  const defaultModel = useCallback(
    () => useFreedomStore.getState().selectedImageModel || undefined,
    [],
  );

  const openPicker = useCallback((target: UploadTarget) => {
    uploadTargetRef.current = target;
    uploadInputRef.current?.click();
  }, []);

  const handleUploadFile = useCallback(async (file: File | undefined) => {
    const target = uploadTargetRef.current;
    uploadTargetRef.current = null;
    if (!file) return;
    try {
      const imageUrl = await saveReferenceFile(file);
      const store = useImageStudioStore.getState();
      if (target?.mode === "replace") {
        store.updateNode(target.nodeId, { imageUrl } as Partial<ImageWorkflowNode>);
      } else if (target?.mode === "new-group") {
        store.addGenerationGroup({
          referenceImageUrl: imageUrl,
          model: useFreedomStore.getState().selectedImageModel || undefined,
        });
      } else {
        store.addReferenceNode({ imageUrl });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "参考图上传失败");
    }
  }, []);

  const handleGenerate = useCallback(
    (nodeId: string) => {
      void generateNode(nodeId);
    },
    [generateNode],
  );
  const handleUpscale = useCallback(
    (nodeId: string) => {
      void upscaleNode(nodeId);
    },
    [upscaleNode],
  );
  const handleSaveToProps = useCallback(
    (nodeId: string) => {
      const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
      const node = graph?.nodes.find((item) => item.id === nodeId);
      if (node?.type === "generated" && node.resultUrl) {
        // 弹窗 prompt 标签取生效提示词(连线提示词节点优先,成图节点内联回落)
        const promptNode = graph ? findPromptNodeForGenerated(graph, nodeId) : undefined;
        setPropsDialog({
          imageUrl: node.resultUrl,
          prompt: promptNode?.prompt || node.prompt,
        });
      }
    },
    [],
  );

  const reactFlowNodes = useMemo<ImageStudioReactNode[]>(() => {
    if (!activeGraph) return [];
    const nodesById = new Map(activeGraph.nodes.map((node) => [node.id, node]));
    return activeGraph.nodes.map((node) => ({
      id: node.id,
      type: "imageStudio",
      position: node.position,
      data: {
        node,
        promptNode:
          node.type === "generated"
            ? findPromptNodeForGenerated(activeGraph, node.id)
            : undefined,
        selected: node.id === selectedNodeId,
        referenceCount:
          node.type === "generated"
            ? activeGraph.edges.filter((edge) => {
                const source = nodesById.get(edge.source);
                return (
                  (source?.type === "reference" && Boolean(source.imageUrl)) ||
                  (source?.type === "generated" && Boolean(source.resultUrl))
                );
              }).length
            : 0,
        extras: nodeExtras[node.id],
        onUpdate: updateNode,
        onUpdateExtras: setNodeExtras,
        onPickImage: (nodeId: string) => openPicker({ mode: "replace", nodeId }),
        onGenerate: handleGenerate,
        onStop: stopNode,
        onUpscale: handleUpscale,
        onSaveToProps: handleSaveToProps,
        onDelete: removeNode,
      },
    }));
  }, [
    activeGraph,
    selectedNodeId,
    nodeExtras,
    updateNode,
    setNodeExtras,
    openPicker,
    handleGenerate,
    stopNode,
    handleUpscale,
    handleSaveToProps,
    removeNode,
  ]);

  const reactFlowEdges = useMemo<Edge[]>(
    () =>
      (activeGraph?.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#67e8f9" },
        interactionWidth: 10,
        style: { stroke: "#67e8f9", strokeWidth: 2 },
      })),
    [activeGraph?.edges],
  );

  const handleConnect = useCallback(
    (connection: { source: string | null; target: string | null }) => {
      if (!connection.source || !connection.target) return;
      const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
      const target = graph?.nodes.find((node) => node.id === connection.target);
      if (target?.type !== "generated") {
        toast.error("连线目标必须是成图节点");
        return;
      }
      connect(connection.source, connection.target);
    },
    [connect],
  );

  const handleViewportSettled = useCallback(
    (viewport: { x: number; y: number; zoom: number }) => {
      if (viewportSaveTimer.current !== null) {
        window.clearTimeout(viewportSaveTimer.current);
      }
      viewportSaveTimer.current = window.setTimeout(() => {
        setViewport(viewport);
      }, 400);
    },
    [setViewport],
  );

  // 换画布:恢复保存的视口,无保存则 fitView(fitView 纪律:仅换画布/首挂触发;
  // restoredWorkflowRef 挡住「防抖保存 viewport→effect 又恢复」的回环)
  const restoredWorkflowRef = useRef<string | null>(null);
  useEffect(() => {
    if (!flowInstance || !activeWorkflowId) return;
    if (restoredWorkflowRef.current === activeWorkflowId) return;
    restoredWorkflowRef.current = activeWorkflowId;
    const saved = activeGraph?.viewport;
    if (saved) {
      flowInstance.setViewport(saved, { duration: 180 });
    } else {
      window.requestAnimationFrame(() => {
        flowInstance?.fitView({ ...FIT_VIEW_OPTIONS, duration: 180 });
      });
    }
  }, [activeWorkflowId, flowInstance, activeGraph?.viewport]);

  useEffect(() => {
    return () => {
      if (viewportSaveTimer.current !== null) {
        window.clearTimeout(viewportSaveTimer.current);
      }
    };
  }, []);

  const currentName = activeGraph?.name ?? "";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ImageStudioToolbar
        workflows={workflows}
        activeWorkflowId={activeWorkflowId}
        historyOpen={historyOpen}
        onSwitch={(id) => useImageStudioStore.getState().switchWorkflow(id)}
        onCreate={() => useImageStudioStore.getState().createWorkflow()}
        onRename={() => {
          setRenameValue(currentName);
          setRenameOpen(true);
        }}
        onDelete={() => setDeleteOpen(true)}
        onAddTextToImage={() =>
          useImageStudioStore.getState().addGenerationGroup({ model: defaultModel() })}
        onAddImageToImage={() => openPicker({ mode: "new-group" })}
        onAddReference={() => openPicker({ mode: "new-reference" })}
        onAddPrompt={() => useImageStudioStore.getState().addPromptNode()}
        onTidy={() => useImageStudioStore.getState().applyLayout()}
        onToggleHistory={() => setHistoryOpen((open) => !open)}
      />
      <div className="flex min-h-0 flex-1">
        <ImageStudioFlowView
          graph={activeGraph}
          reactFlowNodes={reactFlowNodes}
          reactFlowEdges={reactFlowEdges}
          onInit={setFlowInstance}
          onNodeClick={setSelectedNodeId}
          onPaneClick={() => setSelectedNodeId(null)}
          onConnect={handleConnect}
          onNodesDelete={(ids) => ids.forEach((id) => removeNode(id))}
          onEdgesDelete={(ids) => ids.forEach((id) => removeEdge(id))}
          onNodeDragStop={(nodeId, position) => moveNode(nodeId, position)}
          onViewportSettled={handleViewportSettled}
        />
        {historyOpen ? (
          <div className="w-[240px] shrink-0 border-l" data-image-studio-history-panel>
            <GenerationHistory
              type="image"
              onSelect={(entry) => {
                useImageStudioStore.getState().addGenerationGroup({
                  prompt: entry.prompt,
                  model: entry.model || undefined,
                  referenceImageUrl: entry.resultUrl || undefined,
                });
              }}
            />
          </div>
        ) : null}
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleUploadFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {propsDialog ? (
        <SaveToPropsDialog
          open={Boolean(propsDialog)}
          onOpenChange={(open) => {
            if (!open) setPropsDialog(null);
          }}
          imageUrl={propsDialog.imageUrl}
          prompt={propsDialog.prompt}
        />
      ) : null}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-[360px]">
          <DialogHeader>
            <DialogTitle>重命名画布</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder="画布名称"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setRenameOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (activeWorkflowId) {
                  useImageStudioStore.getState().renameWorkflow(activeWorkflowId, renameValue);
                }
                setRenameOpen(false);
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-[360px]">
          <DialogHeader>
            <DialogTitle>删除画布「{currentName}」</DialogTitle>
            <DialogDescription>
              画布上的节点与连线将一并删除;已生成的图片仍在素材库中,不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (activeWorkflowId) {
                  useImageStudioStore.getState().deleteWorkflow(activeWorkflowId);
                }
                setDeleteOpen(false);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImageStudioVisibilityMeasurementRefresh({
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

function ImageStudioFlowView({
  graph,
  reactFlowNodes,
  reactFlowEdges,
  onInit,
  onNodeClick,
  onPaneClick,
  onConnect,
  onNodesDelete,
  onEdgesDelete,
  onNodeDragStop,
  onViewportSettled,
}: {
  graph: ImageWorkflowGraph | undefined;
  reactFlowNodes: ImageStudioReactNode[];
  reactFlowEdges: Edge[];
  onInit: (instance: ReactFlowInstance<ImageStudioReactNode, Edge>) => void;
  onNodeClick: (nodeId: string) => void;
  onPaneClick: () => void;
  onConnect: (connection: { source: string | null; target: string | null }) => void;
  onNodesDelete: (nodeIds: string[]) => void;
  onEdgesDelete: (edgeIds: string[]) => void;
  onNodeDragStop: (nodeId: string, position: { x: number; y: number }) => void;
  onViewportSettled: (viewport: { x: number; y: number; zoom: number }) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<ImageStudioReactNode>(reactFlowNodes);

  useEffect(() => {
    setNodes(reactFlowNodes);
  }, [reactFlowNodes, setNodes]);

  // 节点集合签名判等(实弹报障根修):此前 deps=[graph?.nodes] 每次输入都产新数组
  // → visibility refresh 每键全量 updateNodeInternals → React Flow 清空测量重测,
  // 重测窗口内节点 visibility:hidden → 提示词 textarea 隐没失焦(「输入1字符退出」)。
  // 打字只改节点内容不改节点集,按成员签名保持引用稳定,仅增删节点时刷新测量。
  const nodeIdsSignature = graph?.nodes.map((node) => node.id).join("\u0001") ?? "";
  const measurementNodeIds = useMemo(
    () => (nodeIdsSignature ? nodeIdsSignature.split("\u0001") : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeIdsSignature],
  );

  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ImageStudioReactNode, Edge> | null>(null);

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

  return (
    <div ref={interactingRef} className="image-workflow-flow-host relative min-w-0 flex-1">
      <div className="pointer-events-none absolute bottom-3 left-3 z-10">
        <InteractionDeferHint />
      </div>
      <ReactFlow
        className="absolute inset-0 bg-muted/20"
        nodes={nodes}
        edges={reactFlowEdges}
        nodeTypes={imageStudioNodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onNodeClick(node.id)}
        onPaneClick={onPaneClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={(_, node) => {
          setInteracting(false);
          onNodeDragStop(node.id, node.position);
        }}
        onMoveStart={handleMoveStart}
        onMoveEnd={(_, viewport) => {
          handleMoveEnd();
          onViewportSettled(viewport);
        }}
        onConnect={onConnect}
        onNodesDelete={(deleted) => onNodesDelete(deleted.map((node) => node.id))}
        onEdgesDelete={(deleted) => onEdgesDelete(deleted.map((edge) => edge.id))}
        isValidConnection={(connection) =>
          connection.target !== connection.source &&
          graph?.nodes.find((node) => node.id === connection.target)?.type === "generated"
        }
        onInit={(instance) => {
          setFlowInstance(instance);
          onInit(instance);
        }}
        deleteKeyCode={["Backspace", "Delete"]}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
      >
        {/* 受控 nodes 数组被 effect 整体替换会重置 React Flow 的 handleBounds,
            尺寸未变时 ResizeObserver 不再触发,连线会被静默判为不可见——
            显式刷新节点 internals(分镜画布 ImageWorkflowVisibilityMeasurementRefresh
            同款根修,08-31 fork 时被误裁,装机 CDP 实证连线零渲染后补回)。 */}
        <ImageStudioVisibilityMeasurementRefresh
          isVisible={Boolean(flowInstance)}
          nodeIds={measurementNodeIds}
        />
        <Background color="hsl(var(--border))" gap={28} size={1} />
        <CanvasViewportControls onFit={() => flowInstance?.fitView(FIT_VIEW_OPTIONS)} />
      </ReactFlow>
      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
          <div className="max-w-sm rounded-md border border-border bg-card/92 px-4 py-3 text-sm text-card-foreground">
            <div className="font-semibold">空画布</div>
            <div className="mt-1 text-xs text-muted-foreground">
              点上方「文生图」或「图生图」开始;成图节点之间可以连线,用上一张结果继续精修。
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
