// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackgroundVariant,
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
import { GenerationFailedDialog } from "@/components/ui/generation-failed-dialog";
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
import { useProjectStore } from "@/stores/project/project-store";
import { useAssistCanvasHistory } from "./use-assist-canvas-history";
import { useImageStudioCommands } from "./use-image-studio-commands";
import { copyNodesToClipboard, pasteFromClipboard, clipboardSize } from "./canvas-clipboard";
import { CanvasAssistantDialog } from "./canvas-assistant-dialog";
import { relatedEdges } from "@/lib/studio/image-workflow/relation-graph";
import { useCanvasGestureKernel } from "@/components/panels/studio/use-canvas-gesture-kernel";
// 画布手势内核与分镜画布共用(08-30 收敛 Phase2 之后再整体上提 features/)
import { findPromptNodeForGenerated, hasPromptSource } from "@/lib/studio/image-workflow/graph-build";
import { saveReferenceFile } from "@/lib/assist/image-studio/reference-upload";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import type { ImageWorkflowGraph, ImageWorkflowNode } from "@/types/studio";
import { GenerationHistoryDialog } from "./generation-history-dialog";
import { useMouseButtonPan } from "@/hooks/use-mouse-button-pan";
import { SaveToPropsDialog } from "../SaveToPropsDialog";
import {
  imageStudioNodeTypes,
  type ImageStudioReactNode,
} from "./image-studio-node-card";
import { ImageStudioToolbar } from "./image-studio-toolbar";
import { useImageStudioGeneration } from "./use-image-studio-generation";
import { PaneCreateMenu, type PaneCanvasAction, type PaneCreateKind } from "./pane-create-menu";
import { NodeContextMenu } from "./node-context-menu";
import { effectiveBatchImages } from "./image-studio-batch";
import { buildNodeClearPlan } from "@/lib/assist/image-studio/clear-node";
import { referenceIndexOf } from "@/lib/assist/image-studio/reference-order";
import { logEvent } from "@/lib/diagnostics/logger";
import { CanvasHints } from "./canvas-hints";
import { useImageDrop } from "./use-image-drop";

const FIT_VIEW_OPTIONS = { padding: 0.18, minZoom: 0.35, maxZoom: 1.1 } as const;

type UploadTarget =
  | { mode: "new-reference" }
  | { mode: "replace"; nodeId: string };

/**
 * 图片工作室无限画布(辅助面板)。
 *
 * 交互模式与分镜画布(ImageWorkflowCanvas)同源:React Flow + 手势内核;
 * 差异是自由域——多画布本地切换、无分镜指纹/资产桥/回写链,
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

  // 撤销重做(09-02):订阅 activeGraph 引用变化提交快照(防抖合并)
  const { history: canvasHistory, commitSnapshot } = useAssistCanvasHistory({ workflow: activeGraph });
  // 生成编排先取再注入执行器(trigger-node-action "generate" 走同一状态机)
  const { generateNode, stopNode, upscaleNode } = useImageStudioGeneration();
  useImageStudioCommands({ workflow: activeGraph, generateNode });
  const [assistantOpen, setAssistantOpen] = useState(false);
  useEffect(() => {
    commitSnapshot();
  }, [commitSnapshot]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // onSelectionChange 在 jsdom 里可能被重复派发(同 id 新数组),裸 setState 会造出
  // 「回调→重渲染→再回调」的无限微任务循环把 worker 饿死;同值必须复用旧引用断链。
  const handleSelectionIds = useCallback((nodeIds: string[]) => {
    setSelectedIds((prev) =>
      prev.length === nodeIds.length && prev.every((id, i) => id === nodeIds[i])
        ? prev
        : nodeIds,
    );
  }, []);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // 导出/导入画布 JSON(09-02 R2:导出保引用不打包;导入校验+失效降级)
  const handleExportCanvas = useCallback(() => {
    if (!activeGraph) return;
    const payload = {
      schemaVersion: 1,
      name: activeGraph.name,
      nodes: activeGraph.nodes,
      edges: activeGraph.edges,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeGraph.name || "画布"}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("画布已导出");
  }, [activeGraph]);

  const handleImportCanvas = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const result = useImageStudioStore.getState().importWorkflow(parsed);
      if (result.ok) {
        useImageStudioStore.getState().ensureDefaultWorkflow();
        useImageStudioStore.setState({ activeWorkflowId: result.id });
        toast.success("画布已导入");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("文件不是有效 JSON");
    }
  }, []);
  // Ctrl+C/V 剪贴板(09-02 R1;输入框聚焦不抢)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "v" && key !== "a") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      if (key === "a") {
        event.preventDefault();
        // React Flow 无命令式全选 API:给全部节点下 selected 变更
        useImageStudioStore.getState().updateActiveWorkflow((graph) => ({
          ...graph,
          nodes: graph.nodes.map((node) => ({ ...node, selected: true })),
        }));
        return;
      }
      if (key === "c") {
        const count = copyNodesToClipboard(selectedIds);
        if (count > 0) toast.success(`已复制 ${count} 个节点`);
        return;
      }
      if (clipboardSize() === 0) return;
      event.preventDefault();
      const pasted = pasteFromClipboard();
      if (pasted.length > 0) toast.success(`已粘贴 ${pasted.length} 个节点`);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [propsDialog, setPropsDialog] = useState<{ imageUrls: string[]; primaryUrl?: string; prompt: string } | null>(null);
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

  // 项目侧持久化(09-03)后水合是异步的:默认画布种子必须等水合完成,
  // 否则会把空态写进项目分片覆盖真实画布(storage 层另有写守卫兜底)
  useEffect(() => {
    const store = useImageStudioStore;
    if (store.persist.hasHydrated()) {
      store.getState().ensureDefaultWorkflow();
      return;
    }
    const unsubscribe = store.persist.onFinishHydration(() => {
      unsubscribe();
      store.getState().ensureDefaultWorkflow();
    });
    return () => unsubscribe();
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

  const flowInstanceRef = useRef<ReactFlowInstance<ImageStudioReactNode, Edge> | null>(null);
  flowInstanceRef.current = flowInstance;

  // 拖拽图片到画布(09-02 对账缺口#1):松手位置建参考图节点(项目内落盘)
  const { handlers: dropHandlers, dragOver } = useImageDrop({
    projectId: useProjectStore.getState().activeProjectId ?? undefined,
    flowApi: {
      screenToFlowPosition: (point) =>
        flowInstanceRef.current?.screenToFlowPosition(point) ?? point,
    },
    addReferenceNode: (input) => useImageStudioStore.getState().addReferenceNode(input),
  });

  // 右键创建(09-02,参考 infinite-canvas NodeCreateMenu 交互):落点即建位
  const [paneCreate, setPaneCreate] = useState<{
    x: number;
    y: number;
    world: { x: number; y: number };
  } | null>(null);

  const defaultModel = useCallback(
    () => useFreedomStore.getState().selectedImageModel || undefined,
    [],
  );

  // 09-02 真机根修收尾:新建节点在 React Flow 完成测量前渲染为 visibility:hidden,
  // 该窗口内用户点进提示词所落焦点会被浏览器丢弃(首字符即丢焦的三次报障根因)。
  // 建组后等节点测完可见,自动把光标放进正向提示词——「点文生图→直接打字」
  // 从交互上闭环;用户已聚焦在其他输入框打字时不抢焦点。
  const focusPromptNodeWhenReady = useCallback((nodeId: string | undefined) => {
    if (!nodeId) return;
    let attempts = 0;
    const tryFocus = () => {
      attempts += 1;
      const wrapper = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
      const textarea = wrapper?.querySelector<HTMLTextAreaElement>("textarea");
      if (wrapper && textarea && getComputedStyle(wrapper).visibility === "visible") {
        const active = document.activeElement;
        const userTypingElsewhere =
          active instanceof HTMLElement &&
          active !== document.body &&
          active !== textarea &&
          (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
        if (!userTypingElsewhere) {
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
        return;
      }
      if (attempts < 40) window.requestAnimationFrame(tryFocus);
    };
    window.requestAnimationFrame(tryFocus);
  }, []);

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

  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent) => {
      // 竞态修复②兜底改道(09-03 任务根因:切换画布后测量窗口未闭合,节点
      // visibility:hidden 致右键 target 与 elementFromPoint 双双穿透):改用
      // 几何命中——遍历节点 rect 含右键坐标(hidden 元素 rect 依然有效),
      // 症状层面保证右键节点永远得到节点菜单,不依赖测量状态
      const hitNodeId =
        [...document.querySelectorAll<HTMLElement>(".react-flow__node")].find((el) => {
          const q = el.getBoundingClientRect();
          return (
            q.width > 0 &&
            event.clientX >= q.left &&
            event.clientX <= q.right &&
            event.clientY >= q.top &&
            event.clientY <= q.bottom
          );
        })?.getAttribute("data-id") ?? null;
      void logEvent({
        category: "action",
        level: "info",
        message: "[canvas-switch-race] pane menu open",
        context: {
          targetClass: (event.target as HTMLElement | null)?.className?.toString().slice(0, 60) ?? null,
          hitInsideNode: hitNodeId,
          rerouted: Boolean(hitNodeId),
        },
      });
      if (hitNodeId) {
        event.preventDefault();
        setNodeMenu({ x: event.clientX, y: event.clientY, nodeId: hitNodeId });
        return;
      }
      const world = flowInstanceRef.current?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setPaneCreate({ x: event.clientX, y: event.clientY, world: world ?? { x: 0, y: 0 } });
    },
    [],
  );

  // 分组吸附(09-03 wave3):节点拖放落点几何命中分组框→入组;曾是成员且
  // 落点在所有组外→移出。命中用 DOM rect(hidden 元素 rect 依然有效,同右键
  // 菜单几何改道先例),分组框自身不参与(组套组不支持)
  const handleNodeDropMembership = useCallback(
    (nodeId: string) => {
      const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
      if (!graph) return;
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node || node.type === "group") return;
      const groups = graph.nodes.filter((item) => item.type === "group");
      if (groups.length === 0) return;
      const rectOf = (id: string) =>
        document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect();
      const nodeRect = rectOf(nodeId);
      if (!nodeRect) return;
      const cx = nodeRect.left + nodeRect.width / 2;
      const cy = nodeRect.top + nodeRect.height / 2;
      const hit =
        groups.find((group) => {
          const q = rectOf(group.id);
          if (!q) return false;
          return cx >= q.left && cx <= q.right && cy >= q.top && cy <= q.bottom;
        }) ?? null;
      const current = groups.find((group) => group.memberIds.includes(nodeId)) ?? null;
      if (hit?.id === current?.id) return; // 幂等:成员关系未变
      const store = useImageStudioStore.getState();
      if (current) store.setGroupMembership(current.id, nodeId, false);
      if (hit) store.setGroupMembership(hit.id, nodeId, true);
    },
    [],
  );

  // 双击空白建节点(09-03 wave3 吸收):双击=高频快捷入口,复用创建菜单
  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && !target.classList.contains("react-flow__pane")) return;
      const world = flowInstanceRef.current?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setPaneCreate({ x: event.clientX, y: event.clientY, world: world ?? { x: 0, y: 0 } });
    },
    [],
  );

  const handleNodeContextMenu = useCallback((event: MouseEvent, nodeId: string) => {
    event.preventDefault();
    void logEvent({
      category: "action",
      level: "info",
      message: "[canvas-switch-race] node menu open",
      context: { nodeId },
    });
    setNodeMenu({ x: event.clientX, y: event.clientY, nodeId });
  }, []);

  const handleNodeDuplicate = useCallback(() => {
    if (nodeMenu) useImageStudioStore.getState().duplicateNode(nodeMenu.nodeId);
  }, [nodeMenu]);

  const handleNodeRemove = useCallback(() => {
    if (nodeMenu) useImageStudioStore.getState().removeNode(nodeMenu.nodeId);
  }, [nodeMenu]);

  /**
   * 右键「清空内容」(09-02 用户需求):清理文本框+该节点已存在/已生成的
   * 图片,节点本身保留;分型计划见 buildNodeClearPlan(纯函数,含测试)。
   * 全链诊断日志走 diagnostics(action 类),排查「点了没反应」类反馈。
   */
  const handleNodeClear = useCallback(() => {
    if (!nodeMenu) return;
    const storeState = useImageStudioStore.getState();
    const graph = selectActiveImageStudioWorkflow(storeState);
    if (!graph) return;
    const node = graph.nodes.find((item) => item.id === nodeMenu.nodeId);
    void logEvent({
      category: "action",
      level: "info",
      message: "[image-studio-clear] menu action received",
      context: {
        nodeId: nodeMenu.nodeId,
        nodeType: node?.type ?? null,
        status: node?.type === "generated" ? node.status : null,
        hadResult: node?.type === "generated" ? Boolean(node.resultUrl) : null,
        batchCount: node?.type === "generated" && node.imageBatch ? node.imageBatch.images.length : null,
        promptLength: node && (node.type === "generated" || node.type === "prompt") ? node.prompt.length : null,
      },
    });
    const plan = buildNodeClearPlan(graph, nodeMenu.nodeId);
    if (plan.busy) {
      void logEvent({
        category: "action",
        level: "info",
        message: "[image-studio-clear] blocked: generation in flight",
        context: { nodeId: nodeMenu.nodeId },
      });
      toast.info("正在生成中,停止后再清理");
      return;
    }
    for (const target of plan.targets) {
      storeState.updateNode(target.nodeId, target.updates);
      void logEvent({
        category: "action",
        level: "info",
        message: "[image-studio-clear] update applied",
        context: { nodeId: target.nodeId, clearedKeys: Object.keys(target.updates) },
      });
    }
    void logEvent({
      category: "action",
      level: "info",
      message: "[image-studio-clear] done",
      context: { nodeId: nodeMenu.nodeId, targetCount: plan.targets.length },
    });
  }, [nodeMenu]);

  const handlePaneCreate = useCallback(
    (kind: PaneCreateKind | PaneCanvasAction) => {
      // 画布操作(09-02 业界对齐:右键菜单兼带画布级操作)
      if (kind === "tidy-layout") {
        useImageStudioStore.getState().applyLayout();
        return;
      }
      if (kind === "fit-view") {
        flowInstanceRef.current?.fitView(FIT_VIEW_OPTIONS);
        return;
      }
      const store = useImageStudioStore.getState();
      if (kind === "generation-group") {
        const group = store.addGenerationGroup({ model: defaultModel(), position: paneCreate?.world });
        focusPromptNodeWhenReady(group?.promptNodeId);
      } else if (kind === "generation-group-i2i") {
        // 图生图=文生图同款直建组+空参考图节点已连线(09-03 用户裁定)
        const group = store.addGenerationGroup({
          model: defaultModel(),
          position: paneCreate?.world,
          referenceImageUrl: "",
        });
        focusPromptNodeWhenReady(group?.promptNodeId);
      } else if (kind === "uncloth") {
        store.addUnclothNode({ position: paneCreate?.world });
      } else if (kind === "reference") {
        store.addReferenceNode({ imageUrl: "", position: paneCreate?.world });
      } else if (kind === "sticky") {
        store.addStickyNote({ position: paneCreate?.world });
      } else if (kind === "group") {
        store.addGroup({ position: paneCreate?.world });
      } else {
        store.addPromptNode({ position: paneCreate?.world });
      }
    },
    [defaultModel, focusPromptNodeWhenReady, paneCreate?.world],
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
        // 生效组整组进弹窗(不变量:超分/单张重生成后回落主图);每张自动编号落库
        const imageUrls = effectiveBatchImages(node);
        if (imageUrls.length === 0) return;
        // 弹窗 prompt 标签取生效提示词(连线提示词节点优先,成图节点内联回落)
        const promptNode = graph ? findPromptNodeForGenerated(graph, nodeId) : undefined;
        setPropsDialog({
          imageUrls,
          primaryUrl: node.resultUrl,
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
        referenceIndex:
          node.type === "reference" ? referenceIndexOf(activeGraph, node.id) : undefined,
        referenceCount:
          node.type === "generated"
            ? activeGraph.edges.filter((edge) => {
                // 只数指向本成图的边(存量缺口:此前漏了 target 限定,
                // 多组画布上每个节点都显示全图总数)
                if (edge.target !== node.id) return false;
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

  // 上下游高亮(09-02-relation-highlight):选中节点时相关边金色加粗、无关边降暗
  const relatedEdgeIds = useMemo(
    () => relatedEdges(activeGraph?.edges ?? [], selectedNodeId),
    [activeGraph?.edges, selectedNodeId],
  );

  const reactFlowEdges = useMemo<Edge[]>(
    () =>
      (activeGraph?.edges ?? []).map((edge) => {
        const related = selectedNodeId && relatedEdgeIds.has(edge.id);
        const dim = selectedNodeId && relatedEdgeIds.size > 0 && !related;
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#67e8f9" },
          interactionWidth: 10,
          style: {
            stroke: related ? "#fbbf24" : "#67e8f9",
            strokeWidth: related ? 3 : 2,
            ...(dim ? { strokeOpacity: 0.22 } : {}),
          },
        };
      }),
    [activeGraph?.edges, relatedEdgeIds, selectedNodeId],
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
      const source = graph?.nodes.find((node) => node.id === connection.source);
      if (source?.type === "prompt" && graph && hasPromptSource(graph, connection.target)) {
        toast.error("该成图已接提示词:一个成图只接一根提示词连线,请先断开原有的再连");
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
        onSwitch={(id) => useImageStudioStore.getState().switchWorkflow(id)}
        onCreate={() => useImageStudioStore.getState().createWorkflow()}
        onRename={() => {
          setRenameValue(currentName);
          setRenameOpen(true);
        }}
        onDelete={() => setDeleteOpen(true)}
        onAddTextToImage={() => {
          const group = useImageStudioStore.getState().addGenerationGroup({ model: defaultModel() });
          focusPromptNodeWhenReady(group?.promptNodeId);
        }}
        onAddImageToImage={() => {
          // 与文生图同款直建组(09-03 用户裁定:不先弹选图器)——多一个
          // 空参考图节点并已连线,用户在节点内上传/拖图即成图生图
          const group = useImageStudioStore.getState().addGenerationGroup({
            model: defaultModel(),
            referenceImageUrl: "",
          });
          focusPromptNodeWhenReady(group?.promptNodeId);
        }}
        onAddUncloth={() => useImageStudioStore.getState().addUnclothNode()}
        onAddReference={() => openPicker({ mode: "new-reference" })}
        onAddPrompt={() => useImageStudioStore.getState().addPromptNode()}
        onTidy={() => useImageStudioStore.getState().applyLayout()}
        onOpenHistory={() => setHistoryDialogOpen(true)}
        onOpenAssistant={() => setAssistantOpen(true)}
        onExport={handleExportCanvas}
        onImport={() => importInputRef.current?.click()}
        onOpenFolder={() => {
          // 生成图落在媒体库 ai-image 分类(<mediaRoot>/ai-image);主进程解析目录
          // 并在 Finder 中揭示。桥缺席(非 Electron/测试)给可操作提示。
          const bridge = typeof window !== "undefined" ? window.imageStorage : undefined;
          if (!bridge?.openCategoryFolder) {
            toast.error("当前环境不支持打开本地文件夹");
            return;
          }
          void bridge.openCategoryFolder("ai-image").then((result) => {
            if (!result?.success) {
              toast.error(`打开生成文件夹失败：${result?.error ?? "未知错误"}`);
            }
          });
        }}
      />
      <div className="flex min-h-0 flex-1">
        <ImageStudioFlowView
          graph={activeGraph}
          canvasHistory={canvasHistory}
          reactFlowNodes={reactFlowNodes}
          reactFlowEdges={reactFlowEdges}
          onInit={setFlowInstance}
          onNodeClick={setSelectedNodeId}
          onPaneClick={() => setSelectedNodeId(null)}
          onPaneContextMenu={handlePaneContextMenu}
          onPaneDoubleClick={handlePaneDoubleClick}
          onSelection={handleSelectionIds}
          dropHandlers={dropHandlers}
          onNodeContextMenu={handleNodeContextMenu}
          onConnect={handleConnect}
          onNodesDelete={(ids) => ids.forEach((id) => removeNode(id))}
          onEdgesDelete={(ids) => ids.forEach((id) => removeEdge(id))}
          onNodeDragStop={(nodeId, position) => {
            moveNode(nodeId, position);
            handleNodeDropMembership(nodeId);
          }}
          onViewportSettled={handleViewportSettled}
        />
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => {
            void handleImportCanvas(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {assistantOpen ? (
          <CanvasAssistantDialog
            open
            onOpenChange={(next) => {
              if (!next) setAssistantOpen(false);
            }}
            selectedNodeId={selectedNodeId}
          />
        ) : null}
        {dragOver ? (
          <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-info/60 bg-info/5">
            <span className="rounded-lg bg-card/90 px-3 py-1.5 text-sm font-medium text-card-foreground shadow-md backdrop-blur-md">
              松手放入画布 → 参考图节点
            </span>
          </div>
        ) : null}
        <CanvasHints />
        {nodeMenu ? (
          <NodeContextMenu
            x={nodeMenu.x}
            y={nodeMenu.y}
            onDuplicate={handleNodeDuplicate}
            onClear={handleNodeClear}
            onDelete={handleNodeRemove}
            onClose={() => setNodeMenu(null)}
          />
        ) : null}
        {paneCreate ? (
          <PaneCreateMenu
            x={paneCreate.x}
            y={paneCreate.y}
            onSelect={handlePaneCreate}
            onClose={() => setPaneCreate(null)}
          />
        ) : null}
        {historyDialogOpen ? (
          <GenerationHistoryDialog
            open
            onOpenChange={(next) => setHistoryDialogOpen(next)}
          />
        ) : null}
        <GenerationFailedDialog surface="image-studio" />
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
          imageUrls={propsDialog.imageUrls}
          previewUrl={propsDialog.primaryUrl}
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

  // 09-02 实弹复现根修:用户点文生图建组后立刻点进提示词打字(约 80-200ms 内),
  // 节点集变化触发的全量 updateNodeInternals 让 React Flow 进入重测窗口
  // (节点 visibility:hidden),隐藏元素不可聚焦 → 首字符即焦点丢给 body
  // (用户三次报障的真时序;c1b27d0 只断了「打字触发」没断「建组后打字」)。
  // 两全修法=防抖 + 排除焦点所在节点:正在输入的节点永不进入隐藏窗口,其尺寸
  // 变化由 ResizeObserver 自然跟随(与打字路径一致);其余节点照刷保住
  // handleBounds/连线可见性(08-31 连线零渲染案的既有承担,不可丢)。
  useEffect(() => {
    if (!isVisible || nodeIds.length === 0) return;

    const refreshTimer = window.setTimeout(() => {
      const focusedNode = document.activeElement?.closest(".react-flow__node");
      const focusedNodeId = focusedNode?.getAttribute("data-id");
      const ids = focusedNodeId ? nodeIds.filter((id) => id !== focusedNodeId) : nodeIds;
      if (ids.length > 0) {
        updateNodeInternals(ids);
      }
    }, 250);
    return () => window.clearTimeout(refreshTimer);
  }, [isVisible, nodeIds, updateNodeInternals]);

  return null;
}

function ImageStudioFlowView({
  graph,
  canvasHistory,
  reactFlowNodes,
  reactFlowEdges,
  onInit,
  onNodeClick,
  onPaneClick,
  onPaneContextMenu,
  onPaneDoubleClick,
  onSelection,
  dropHandlers,
  onNodeContextMenu,
  onConnect,
  onNodesDelete,
  onEdgesDelete,
  onNodeDragStop,
  onViewportSettled,
}: {
  graph: ImageWorkflowGraph | undefined;
  canvasHistory: Parameters<typeof CanvasViewportControls>[0]["history"];
  reactFlowNodes: ImageStudioReactNode[];
  reactFlowEdges: Edge[];
  onInit: (instance: ReactFlowInstance<ImageStudioReactNode, Edge>) => void;
  onNodeClick: (nodeId: string) => void;
  onPaneClick: () => void;
  onPaneContextMenu: (event: MouseEvent) => void;
  onPaneDoubleClick: (event: React.MouseEvent | MouseEvent) => void;
  onSelection: (nodeIds: string[]) => void;
  dropHandlers: {
    onDragEnter: (event: React.DragEvent) => void;
    onDragOver: (event: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: React.DragEvent) => void;
  };
  onNodeContextMenu: (event: MouseEvent, nodeId: string) => void;
  onConnect: (connection: { source: string | null; target: string | null }) => void;
  onNodesDelete: (nodeIds: string[]) => void;
  onEdgesDelete: (edgeIds: string[]) => void;
  onNodeDragStop: (nodeId: string, position: { x: number; y: number }) => void;
  onViewportSettled: (viewport: { x: number; y: number; zoom: number }) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<ImageStudioReactNode>(reactFlowNodes);

  // 回调身份稳定:内联箭头每次渲染换新引用,会放大 jsdom 下 selection 派发循环
  const handleSelectionChange = useCallback(
    (selected: { nodes: Array<{ id: string }> }) => {
      onSelection(selected.nodes.map((node) => node.id));
    },
    [onSelection],
  );


  useEffect(() => {
    // 09-02 日志终局根修:[isi] 实录每键 setNodes measured=0 → RF 判节点未测量
    // → wrapper visibility:hidden 等重测 → 中文输入法组合会话被隐藏闪断,焦点丢
    // BODY(用户五报「输入1字符即退出」的真因果链)。重建受控数组必须携带旧节点
    // 已测尺寸;RF 视节点为已测量则永不进入隐藏窗口。下方测量刷新组件只是该
    // 缺陷时代的创可贴(handleBounds 重置同根),保留作保底。
    setNodes((current) => {
      let carried = 0;
      const next = reactFlowNodes.map((node) => {
        const prev = current.find((n) => n.id === node.id);
        if (prev?.measured) carried += 1;
        return prev?.measured ? { ...node, measured: prev.measured } : node;
      });
      if (reactFlowNodes.length > 0 && carried < reactFlowNodes.length) {
        void logEvent({
          category: "action",
          level: "info",
          message: "[canvas-switch-race] nodes rebuilt (partial/no measured carry)",
          context: { total: reactFlowNodes.length, carried },
        });
      }
      return next;
    });
  }, [reactFlowNodes, setNodes]);

  // 竞态修复①(09-03-canvas-switch-rc-race):跨画布切换=全新节点 id,measured
  // 零携带(carry 按 id 匹配),RF 需重测;实测该窗口在重建循环下可达数秒不
  // 闭合(节点 visibility:hidden→右键穿透为 pane)。切换后 rAF 轮询直读 DOM
  // 尺寸注入 measured(与上方 carry 同机制),一步闭合 hasDimensions。
  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    let raf = 0;
    let tries = 0;
    const poll = () => {
      let patchedCount = 0;
      setNodes((current) => {
        if (current.every((node) => node.measured)) return current;
        const patched = current.map((node) => {
          if (node.measured) return node;
          const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`);
          if (!el || el.offsetWidth === 0) return node;
          patchedCount += 1;
          return { ...node, measured: { width: el.offsetWidth, height: el.offsetHeight } };
        });
        return patchedCount > 0 ? patched : current;
      });
      tries += 1;
      if (tries < 30) raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
    // graph?.id=画布身份信号:仅切换画布时重跑;节点增删由上方 carry/刷新链负责
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph?.id, setNodes]);

  // 节点集合签名判等(实弹报障根修):此前 deps=[graph?.nodes] 每次输入都产新数组
  // → visibility refresh 每键全量 updateNodeInternals → React Flow 清空测量重测,
  // 重测窗口内节点 visibility:hidden → 提示词 textarea 隐没失焦(「输入1字符退出」)。
  // 打字只改节点内容不改节点集,按成员签名保持引用稳定,仅增删节点时刷新测量。
  const nodeIdsSignature = graph?.nodes.map((node) => node.id).join("\u0001") ?? "";
  const measurementNodeIds = useMemo(
    () => (nodeIdsSignature ? nodeIdsSignature.split("\u0001") : []),
    [nodeIdsSignature],
  );

  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ImageStudioReactNode, Edge> | null>(null);
  // 09-03 用户裁定:左键不得拖拽画布(上游 d3 过滤器左键永远放行,props 挡不住)
  // → panOnDrag={false} 全禁 d3 拖拽平移,右键/中键由本钩子接管
  const mouseButtonPan = useMouseButtonPan((dx, dy) => {
    if (!flowInstance) return;
    const viewport = flowInstance.getViewport();
    flowInstance.setViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom });
  });
  const [backgroundMode, setBackgroundMode] = useState<"dots" | "lines" | "blank">(() => {
    try {
      const saved = window.localStorage.getItem("studio-canvas-background");
      return saved === "lines" || saved === "blank" ? saved : "dots";
    } catch {
      return "dots";
    }
  });

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
      </div>
      <ReactFlow
        className="absolute inset-0 bg-muted/20"
        nodes={nodes}
        edges={reactFlowEdges}
        nodeTypes={imageStudioNodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onNodeClick(node.id)}
        onPaneClick={onPaneClick}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).classList.contains("react-flow__pane")) onPaneDoubleClick(event);
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          onPaneContextMenu(event as unknown as MouseEvent);
        }}
        onDragEnter={dropHandlers.onDragEnter}
        onDragOver={dropHandlers.onDragOver}
        onDragLeave={dropHandlers.onDragLeave}
        onDrop={dropHandlers.onDrop}
        onNodeContextMenu={(event, node) => {
          onNodeContextMenu(event as unknown as MouseEvent, node.id);
        }}
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
        onPointerDown={mouseButtonPan.onPointerDown}
        onPointerMove={mouseButtonPan.onPointerMove}
        onPointerUp={mouseButtonPan.onPointerUp}
        onPointerCancel={mouseButtonPan.onPointerCancel}
        onContextMenuCapture={mouseButtonPan.onContextMenuCapture}
        onNodesDelete={(deleted) => onNodesDelete(deleted.map((node) => node.id))}
        onEdgesDelete={(deleted) => onEdgesDelete(deleted.map((edge) => edge.id))}
        isValidConnection={(connection) =>
          connection.target !== connection.source &&
          graph?.nodes.find((node) => node.id === connection.target)?.type === "generated" &&
          !(
            connection.source &&
            graph?.nodes.find((node) => node.id === connection.source)?.type === "prompt" &&
            hasPromptSource(graph, connection.target)
          )
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
        selectionOnDrag
        autoPanOnNodeDrag={false}
        autoPanOnConnect={false}
        autoPanOnSelection={false}
        onSelectionChange={handleSelectionChange}
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
        {backgroundMode === "blank" ? null : (
          <Background
            variant={backgroundMode === "dots" ? BackgroundVariant.Dots : BackgroundVariant.Lines}
            color="hsl(var(--border))"
            gap={28}
            size={1}
          />
        )}
        <CanvasViewportControls
            onFit={() => flowInstance?.fitView(FIT_VIEW_OPTIONS)}
            history={canvasHistory}
            onBackgroundModeChange={setBackgroundMode}
          />
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
