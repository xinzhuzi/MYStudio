import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageWorkflowFlowView } from "./ImageWorkflowFlowView";
import {
  MarkerType,
  type Edge,
  type ReactFlowInstance,
  useUpdateNodeInternals,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
  findStoryboardWorkflowForContext,
  focusNodeIdsForGenerated,
  isAssetOpenContext,
  openContextTargetLabel,
  resolveActionGeneratedNode,
  nextNodePosition,
  resolveGenerationTargetNodeId,
  workflowTargetLabel,
} from "./image-workflow-graph-utils";
import { createImageWorkflowReactNodes } from "./image-workflow-react-nodes";
import {
  createConnectedImageNode,
  type ConnectCreateInput,
} from "@/lib/studio/image-workflow/connect-create";
import { ImageWorkflowScopedPending } from "./image-workflow-scoped-pending";
import { useImageWorkflowGeneration } from "./use-image-workflow-generation";
import { useImageWorkflowUpscale } from "./use-image-workflow-upscale";
import { denoiseModeToOpts, type UpscaleDenoiseMode } from "./upscale-denoise-mode";
import { useImageWorkflowActions } from "./use-image-workflow-actions";
import { useImageWorkflowCommands } from "./use-image-workflow-commands";
import { CropFrameDialog } from "./crop-frame-dialog";
import { SplitGridDialog } from "./split-grid-dialog";
import { MaskInpaintDialog } from "./mask-inpaint-dialog";
import { exportMaskOverlay, buildInpaintPrompt } from "@/lib/studio/image-workflow/mask-export";
import {
  reversePromptFromImage,
} from "@/lib/studio/image-workflow/reverse-prompt";
import { addPromptImageNode } from "@/lib/studio/image-workflow/graph-build";
import { toPreviewSrc } from "@/lib/media/preview-src";
import { useDerivedReferenceLanding } from "./use-derived-reference-landing";
import {
  cellRect,
  cropImageData,
  createBrowserCanvasCodec,
  splitImageData,
} from "@/lib/studio/image-workflow/extraction-pixels";
import {
  addGeneratedImageNode,
  connectImageWorkflowNodes,
} from "@/lib/studio/image-workflow/graph-build";
import type { NormRect } from "@/lib/studio/image-workflow/crop-geometry";
import { ImageWorkflowSidebar } from "./image-workflow-sidebar";
import { ImageWorkflowCanvasToolbar } from "./image-workflow-canvas-toolbar";
import {
  ImageWorkflowBatchUpscaleDialog,
  ImageWorkflowBatchUpscaleProgress,
} from "./image-workflow-batch-upscale-dialog";

export const nodeTypes = { imageWorkflow: ImageWorkflowNodeCard };
// 上下让位:顶部悬浮工具栏(返回/风格依据/整理布局≈140px)与左下视口控件+
// 右下小地图会盖住贴边节点(实弹审查实证),fitView 用方向 padding 避让
export const FIT_VIEW_OPTIONS = {
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

  // 画布取材(09-01-extraction-crop):裁剪产物经 infra 通道落血缘参考节点
  const landDerived = useDerivedReferenceLanding({
    activeGraph,
    saveGraph,
    storyboards: chapterStoryboards,
    addMaterial,
    setSelectedNodeId,
  });
  const [cropTarget, setCropTarget] = useState<{
    nodeId: string;
    imageUrl: string;
    title: string;
  } | null>(null);
  const [splitTarget, setSplitTarget] = useState<{
    nodeId: string;
    imageUrl: string;
    title: string;
  } | null>(null);
  const [maskTarget, setMaskTarget] = useState<{
    nodeId: string;
    imageUrl: string;
    title: string;
  } | null>(null);
  const [reverseState, setReverseState] = useState<{
    nodeId: string;
    imageUrl: string;
    title: string;
    running: boolean;
  } | null>(null);

  const handleCropConfirm = useCallback(
    async (rect: NormRect) => {
      const target = cropTarget;
      if (!target) return;
      setCropTarget(null);
      try {
        const codec = createBrowserCanvasCodec();
        const sourcePixels = await codec.decode(target.imageUrl);
        const cropped = cropImageData(sourcePixels, rect);
        const dataUrl = codec.encode(cropped);
        assertLanded(
          await landDerived([
            {
              sourceNodeId: target.nodeId,
              pixels: { dataUrl, width: cropped.width, height: cropped.height },
              title: `${target.title}·裁剪`,
              derivation: { kind: "crop", sourceNodeId: target.nodeId, region: rect },
            },
          ]),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "裁剪取材失败");
      }
    },
    [cropTarget, landDerived],
  );

  const extractImageUrl = (node: ImageWorkflowNode | undefined): string => {
    if (!node) return "";
    if (node.type === "reference") return node.imageUrl || "";
    if (node.type === "generated") return node.resultUrl || "";
    return "";
  };

  const handleExtractEntry = useCallback(
    (nodeId: string, tool: "crop" | "split" | "reverse" | "mask") => {
      if (!activeGraph) return;
      const node = activeGraph.nodes.find((item) => item.id === nodeId);
      const rawUrl = extractImageUrl(node);
      if (!node || !rawUrl) return;
      const target = { nodeId, imageUrl: toPreviewSrc(rawUrl), title: node.title };
      if (tool === "crop") setCropTarget(target);
      else if (tool === "split") setSplitTarget(target);
      else if (tool === "mask") setMaskTarget(target);
      else setReverseState({ ...target, running: false });
    },
    [activeGraph],
  );

  const handleSplitConfirm = useCallback(
    async (rows: number, cols: number) => {
      const target = splitTarget;
      if (!target) return;
      setSplitTarget(null);
      try {
        const codec = createBrowserCanvasCodec();
        const sourcePixels = await codec.decode(target.imageUrl);
        const pieces = splitImageData(sourcePixels, rows, cols);
        assertLanded(
          await landDerived(
            pieces.map((piece, index) => {
            const row = Math.floor(index / cols);
            const col = index % cols;
            return {
              sourceNodeId: target.nodeId,
              pixels: { dataUrl: codec.encode(piece), width: piece.width, height: piece.height },
              title: `${target.title}·${row + 1}-${col + 1}`,
              derivation: {
                kind: "split" as const,
                sourceNodeId: target.nodeId,
                cell: { row, col },
                region: cellRect(rows, cols, row, col),
              },
            };
          }),
          ),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "切图取材失败");
      }
    },
    [landDerived, splitTarget],
  );

  const handleMaskConfirm = useCallback(
    async (payload: { request: string; maskData: { data: Uint8ClampedArray; width: number; height: number } }) => {
      const target = maskTarget;
      if (!target || !activeGraph) return;
      setMaskTarget(null);
      try {
        const codec = createBrowserCanvasCodec();
        const basePixels = await codec.decode(target.imageUrl);
        const exportResult = exportMaskOverlay(basePixels, payload.maskData, (image) => codec.encode(image));
        if (!exportResult) throw new Error("蒙版为空");
        // 新成图节点经 appendGraph 与落图合并为一次 saveGraph(单步撤销,
        // 09-01 mask 深审修复);生成链从 store 读最新图
        const genId = `gen-${Date.now()}`;
        assertLanded(
          await landDerived(
            [
              {
                sourceNodeId: target.nodeId,
                pixels: {
                  dataUrl: exportResult.overlayDataUrl,
                  width: payload.maskData.width,
                  height: payload.maskData.height,
                },
                title: `${target.title}·重绘区`,
                derivation: {
                  kind: "mask-inpaint",
                  sourceNodeId: target.nodeId,
                  region: exportResult.region,
                },
              },
            ],
            {
              appendGraph: (graph, landedIds) => {
                const refId = landedIds[0];
                const withGen = addGeneratedImageNode(graph, {
                  id: genId,
                  title: `${target.title}·局部重绘`,
                  prompt: buildInpaintPrompt(payload.request),
                  position: nextNodePosition(graph, "generated"),
                });
                return refId
                  ? connectImageWorkflowNodes(withGen, { source: refId, target: genId })
                  : withGen;
              },
            },
          ),
        );
        void generateNode(genId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "局部重绘失败");
      }
    },
    [activeGraph, generateNode, landDerived, maskTarget],
  );

  const runReversePrompt = useCallback(async () => {
    const target = reverseState;
    if (!target || target.running) return;
    setReverseState({ ...target, running: true });
    try {
      const prompt = await reversePromptFromImage(target.imageUrl);
      if (!activeGraph) return;
      const generatedTarget = resolveGenerationTargetNodeId(activeGraph, target.nodeId);
      saveGraph(
        addPromptImageNode(activeGraph, {
          title: `${target.title}·反推`,
          prompt,
          position: nextNodePosition(activeGraph, "prompt"),
          ...(generatedTarget ? { targetNodeId: generatedTarget } : {}),
        }),
      );
      setReverseState(null);
      toast.success("反推提示词已建节点");
    } catch (error) {
      setReverseState(null);
      toast.error(error instanceof Error ? error.message : "反推提示词失败");
    }
  }, [activeGraph, reverseState, saveGraph]);

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
        onExtract: handleExtractEntry,
      }),
    [
      activeGraph,
      applyNodeToStoryboard,
      handleExtractEntry,
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


/** 取材落图结果检查:任一失败即 toast 并返回 false(此前静默吞 outcome 是实弹排查出的缺陷) */
function assertLanded(outcomes: Array<{ nodeId: string } | { error: string }>): boolean {
  const failed = outcomes.find((outcome) => "error" in outcome) as { error: string } | undefined;
  if (failed) {
    toast.error(failed.error);
    return false;
  }
  return true;
}

  // 反推入口设定后自动执行(与一键生成同款无中间确认)
  useEffect(() => {
    if (reverseState && !reverseState.running) void runReversePrompt();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reverseState]);

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
      <CropFrameDialog
        open={Boolean(cropTarget)}
        imageUrl={cropTarget?.imageUrl ?? null}
        sourceTitle={cropTarget?.title ?? ""}
        onClose={() => setCropTarget(null)}
        onConfirm={(rect) => void handleCropConfirm(rect)}
      />
      <SplitGridDialog
        open={Boolean(splitTarget)}
        imageUrl={splitTarget?.imageUrl ?? null}
        sourceTitle={splitTarget?.title ?? ""}
        onClose={() => setSplitTarget(null)}
        onConfirm={(rows, cols) => void handleSplitConfirm(rows, cols)}
      />
      {reverseState ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm text-card-foreground">
            {reverseState.running ? "正在反推提示词…" : "准备反推…"}
          </div>
        </div>
      ) : null}
      <MaskInpaintDialog
        open={Boolean(maskTarget)}
        imageUrl={maskTarget?.imageUrl ?? null}
        sourceTitle={maskTarget?.title ?? ""}
        onClose={() => setMaskTarget(null)}
        onConfirm={(payload) => void handleMaskConfirm(payload)}
      />
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


export function ImageWorkflowVisibilityMeasurementRefresh({
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


export { ImageWorkflowFlowView } from "./ImageWorkflowFlowView";
