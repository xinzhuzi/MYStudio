import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  CheckCircle2,
  GitBranch,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Plus,
  Save,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LocalImage } from "@/components/ui/local-image";
import { Textarea } from "@/components/ui/textarea";
import { readImageAsBase64 } from "@/lib/image-storage";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  addGeneratedImageNode,
  addReferenceImageNode,
  buildImageWorkflowGenerationRequest,
  connectImageWorkflowNodes,
  createId,
  removeImageWorkflowEdge,
  removeImageWorkflowNode,
  setGeneratedImageResult,
  setGeneratedImageStatus,
  updateImageWorkflowNode,
  updateImageWorkflowNodePosition,
} from "@/lib/studio/image-workflow";
import { prepareImageWorkflowReferenceImages } from "@/lib/studio/image-workflow-references";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowReferenceNode,
  StoryboardItem,
  StudioMaterial,
} from "@/types/studio";
import { cn } from "@/lib/utils";
import { ModelSelector } from "@/components/panels/assist/ModelSelector";

interface ImageWorkflowNodeData extends Record<string, unknown> {
  node: ImageWorkflowNode;
  selected: boolean;
  storyboards: StoryboardItem[];
  onUpdate: (nodeId: string, updates: Partial<ImageWorkflowNode>) => void;
  onGenerate: (nodeId: string) => void;
  onApplyToStoryboard: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}

type ImageWorkflowReactNode = Node<ImageWorkflowNodeData>;

const nodeTypes = { imageWorkflow: ImageWorkflowNodeCard };
const FIT_VIEW_OPTIONS = { padding: 0.18, minZoom: 0.35, maxZoom: 1.1 } as const;
const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const QUALITY_OPTIONS: Array<ImageWorkflowGeneratedNode["quality"]> = ["draft", "standard", "hd"];

export function ImageWorkflowCanvas({ projectName }: { projectName: string }) {
  const {
    imageWorkflows,
    materials,
    storyboards,
    addMaterial,
    createImageWorkflow,
    upsertImageWorkflow,
    updateImageWorkflow,
    applyImageWorkflowResultToStoryboard,
  } = useStudioStore();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [targetStoryboardId, setTargetStoryboardId] = useState("");
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ImageWorkflowReactNode, Edge> | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const activeGraph = useMemo(
    () => imageWorkflows.find((item) => item.id === activeWorkflowId) ?? imageWorkflows[0],
    [activeWorkflowId, imageWorkflows],
  );
  const imageMaterials = useMemo(
    () => materials.filter((item) => item.kind === "image"),
    [materials],
  );
  const storyboardImages = useMemo(
    () => storyboards.filter((item) => item.mediaRef?.kind === "image" && item.mediaRef.path),
    [storyboards],
  );

  useEffect(() => {
    if (activeGraph) {
      if (activeWorkflowId !== activeGraph.id) setActiveWorkflowId(activeGraph.id);
      if (activeGraph.target.kind === "storyboard" && activeGraph.target.id) {
        setTargetStoryboardId(activeGraph.target.id);
      }
      return;
    }
    const id = createImageWorkflow({
      name: `${projectName} 图像工作流`,
      target: { kind: "free" },
    });
    setActiveWorkflowId(id);
  }, [activeGraph, activeWorkflowId, createImageWorkflow, projectName]);

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

  const createNewFlow = useCallback(() => {
    const id = createImageWorkflow({
      name: `${projectName} 图像工作流 ${imageWorkflows.length + 1}`,
      target: targetStoryboardId ? { kind: "storyboard", id: targetStoryboardId } : { kind: "free" },
    });
    setActiveWorkflowId(id);
    setSelectedNodeId(null);
  }, [createImageWorkflow, imageWorkflows.length, projectName, targetStoryboardId]);

  const bindTargetStoryboard = useCallback(() => {
    if (!activeGraph || !targetStoryboardId) return;
    updateImageWorkflow(activeGraph.id, { target: { kind: "storyboard", id: targetStoryboardId } });
    toast.success("已绑定分镜");
  }, [activeGraph, targetStoryboardId, updateImageWorkflow]);

  const addReferenceFromMaterial = useCallback(
    (material: StudioMaterial) => {
      if (!activeGraph) return;
      const id = createId("ref");
      saveGraph(addReferenceImageNode(activeGraph, {
        id,
        title: material.name,
        imageUrl: material.localPath,
        source: { kind: "material", id: material.id },
        position: nextNodePosition(activeGraph, "reference"),
      }));
      setSelectedNodeId(id);
    },
    [activeGraph, saveGraph],
  );

  const addReferenceFromStoryboard = useCallback(
    (storyboard: StoryboardItem) => {
      if (!activeGraph || !storyboard.mediaRef?.path) return;
      const id = createId("ref");
      saveGraph(addReferenceImageNode(activeGraph, {
        id,
        title: `分镜 ${storyboard.index}`,
        imageUrl: storyboard.mediaRef.path,
        source: { kind: "storyboard", id: storyboard.id },
        position: nextNodePosition(activeGraph, "reference"),
      }));
      setSelectedNodeId(id);
    },
    [activeGraph, saveGraph],
  );

  const addGeneratedNode = useCallback(() => {
    if (!activeGraph) return;
    const id = createId("gen");
    const targetStoryboard = storyboards.find((item) => item.id === targetStoryboardId);
    saveGraph(addGeneratedImageNode(activeGraph, {
      id,
      title: targetStoryboard ? `分镜 ${targetStoryboard.index} 成图` : "生成图",
      prompt: targetStoryboard?.prompt ?? "",
      aspectRatio: "16:9",
      quality: "standard",
      position: nextNodePosition(activeGraph, "generated"),
    }));
    setSelectedNodeId(id);
  }, [activeGraph, saveGraph, storyboards, targetStoryboardId]);

  const deleteNode = useCallback(
    (nodeId: string) => {
      if (!activeGraph) return;
      saveGraph(removeImageWorkflowNode(activeGraph, nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [activeGraph, saveGraph, selectedNodeId],
  );

  const deleteSelectedEdge = useCallback(() => {
    if (!activeGraph || !selectedEdgeId) return;
    saveGraph(removeImageWorkflowEdge(activeGraph, selectedEdgeId));
    setSelectedEdgeId(null);
  }, [activeGraph, saveGraph, selectedEdgeId]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!activeGraph || !connection.source || !connection.target) return;
      saveGraph(connectImageWorkflowNodes(activeGraph, {
        source: connection.source,
        target: connection.target,
      }));
    },
    [activeGraph, saveGraph],
  );

  const handleUploadReference = useCallback(
    async (file?: File) => {
      if (!file || !activeGraph) return;
      try {
        if (!activeProjectId) throw new Error("请先选择项目");
        const bytes = await file.arrayBuffer();
        const id = createId("ref");
        const saved = await window.projectFiles?.writeBinary({
          projectId: activeProjectId,
          relativePath: workflowImageRelativePath(activeGraph.id, createWorkflowFilename("ref", id, file.name)),
          bytes,
        });
        if (!saved?.success || !saved.url) {
          throw new Error(saved?.error || "项目内参考图保存失败");
        }
        const imageUrl = saved.url;
        const materialId = addMaterial({
          name: file.name,
          localPath: imageUrl,
          size: saved?.size ?? file.size,
        });
        saveGraph(addReferenceImageNode(activeGraph, {
          id,
          title: file.name,
          imageUrl,
          source: { kind: "material", id: materialId },
          position: nextNodePosition(activeGraph, "reference"),
        }));
        setSelectedNodeId(id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "参考图导入失败");
      } finally {
        if (uploadInputRef.current) uploadInputRef.current.value = "";
      }
    },
    [activeGraph, activeProjectId, addMaterial, saveGraph],
  );

  const generateNode = useCallback(
    async (nodeId: string) => {
      const graph = useStudioStore.getState().imageWorkflows.find((item) => item.id === activeGraph?.id);
      if (!graph) return;
      const request = buildImageWorkflowGenerationRequest(graph, nodeId);
      if (!request.prompt.trim()) {
        toast.error("请先填写生成提示词");
        return;
      }
      saveGraph(setGeneratedImageStatus(graph, nodeId, "generating"));
      try {
        const projectId = useProjectStore.getState().activeProjectId;
        if (!projectId) throw new Error("请先选择项目");
        const referenceImages = await prepareReferenceImages(request.referenceImages);
        const result = await aiManager.freedomImage({
          prompt: request.prompt,
          model: request.model,
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          negativePrompt: request.negativePrompt,
          referenceImages,
          extraParams: request.quality === "hd" ? { quality: "hd" } : undefined,
        });
        const node = graph.nodes.find((item) => item.id === nodeId);
        const saved = await window.projectFiles?.saveImage({
          projectId,
          relativePath: workflowImageRelativePath(graph.id, createWorkflowFilename("gen", nodeId, `${node?.title || "workflow-image"}.png`)),
          source: result.url,
        });
        if (!saved?.success || !saved.url) {
          throw new Error(saved?.error || "项目内图片保存失败");
        }
        const localPath = saved.url;
        const materialId = addMaterial({
          name: `${node?.title || "workflow-image"}.png`,
          localPath,
          size: saved.size ?? 0,
        });
        const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
        saveGraph(setGeneratedImageResult(latest, nodeId, {
          imageUrl: localPath,
          mediaId: materialId ?? result.mediaId,
        }));
        toast.success("图片已生成并保存到当前项目");
      } catch (error) {
        const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
        saveGraph(setGeneratedImageStatus(latest, nodeId, "failed", error instanceof Error ? error.message : "生成失败"));
        toast.error(error instanceof Error ? error.message : "生成失败");
      }
    },
    [activeGraph?.id, addMaterial, saveGraph],
  );

  const applyNodeToStoryboard = useCallback(
    (nodeId: string) => {
      if (!activeGraph) return;
      const storyboardId =
        activeGraph.target.kind === "storyboard" && activeGraph.target.id
          ? activeGraph.target.id
          : targetStoryboardId;
      if (!storyboardId) {
        toast.error("请先选择要回写的分镜");
        return;
      }
      applyImageWorkflowResultToStoryboard(storyboardId, activeGraph.id, nodeId);
      toast.success("已回写到分镜媒体");
    },
    [activeGraph, applyImageWorkflowResultToStoryboard, targetStoryboardId],
  );

  const reactFlowNodes = useMemo<ImageWorkflowReactNode[]>(
    () =>
      (activeGraph?.nodes ?? []).map((node) => ({
        id: node.id,
        type: "imageWorkflow",
        position: node.position,
        data: {
          node,
          selected: node.id === selectedNodeId,
          storyboards,
          onUpdate: updateNode,
          onGenerate: (nodeId: string) => void generateNode(nodeId),
          onApplyToStoryboard: (nodeId: string) => applyNodeToStoryboard(nodeId),
          onDelete: (nodeId: string) => deleteNode(nodeId),
        },
      })),
    [activeGraph, applyNodeToStoryboard, deleteNode, generateNode, selectedNodeId, storyboards, updateNode],
  );
  const [nodes, setNodes, onNodesChange] =
    useNodesState<ImageWorkflowReactNode>(reactFlowNodes);

  useEffect(() => {
    setNodes(reactFlowNodes);
  }, [reactFlowNodes, setNodes]);

  if (!activeGraph) {
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
    <section className="grid h-full min-h-[calc(100vh-190px)] grid-cols-[minmax(0,1fr)_320px] overflow-hidden rounded-lg border border-white/10 bg-[#181917] text-zinc-100">
      <div className="relative min-w-0 overflow-hidden">
        <ReactFlow
          className="absolute inset-0 bg-[#1f201e]"
          nodes={nodes}
          edges={reactFlowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id);
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
          <Background color="rgba(255,255,255,0.08)" gap={28} size={1} />
          <Controls showInteractive={false} />
          <Panel position="top-left" className="nodrag nopan">
            <div className="flex max-w-[calc(100vw-420px)] flex-wrap items-center gap-2 rounded-md border border-white/12 bg-[#10110f]/90 p-2 shadow-lg backdrop-blur">
              <select
                value={activeGraph.id}
                onChange={(event) => {
                  setActiveWorkflowId(event.target.value);
                  setSelectedNodeId(null);
                }}
                className="h-8 max-w-[260px] rounded-md border border-white/12 bg-black/30 px-2 text-xs text-zinc-100 outline-none"
              >
                {imageWorkflows.map((graph) => (
                  <option key={graph.id} value={graph.id}>
                    {graph.name}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="secondary" onClick={createNewFlow}>
                <Plus className="h-3.5 w-3.5" />
                新建
              </Button>
              <Button size="sm" variant="outline" onClick={() => uploadInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />
                上传参考
              </Button>
              <Button size="sm" onClick={addGeneratedNode}>
                <WandSparkles className="h-3.5 w-3.5" />
                生成节点
              </Button>
              {selectedEdgeId ? (
                <Button size="sm" variant="destructive" onClick={deleteSelectedEdge}>
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
          </Panel>
        </ReactFlow>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => void handleUploadReference(event.target.files?.[0])}
        />
      </div>

      <aside className="flex min-h-0 flex-col border-l border-white/10 bg-[#111210]">
        <div className="border-b border-white/10 p-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-cyan-200" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{activeGraph.name}</h3>
              <p className="text-[11px] text-zinc-500">{projectName}</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            <select
              value={targetStoryboardId}
              onChange={(event) => setTargetStoryboardId(event.target.value)}
              className="h-8 rounded-md border border-white/12 bg-black/30 px-2 text-xs text-zinc-100 outline-none"
            >
              <option value="">选择回写分镜</option>
              {storyboards.map((storyboard) => (
                <option key={storyboard.id} value={storyboard.id}>
                  分镜 {storyboard.index} · {storyboard.prompt.slice(0, 18)}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" onClick={bindTargetStoryboard} disabled={!targetStoryboardId}>
              <Save className="h-3.5 w-3.5" />
              绑定当前图
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <PaletteSection title="项目参考图" emptyText="当前项目暂无参考图">
            {imageMaterials.slice(0, 24).map((material) => (
              <PaletteImageButton
                key={material.id}
                title={material.name}
                imageUrl={material.localPath}
                onClick={() => addReferenceFromMaterial(material)}
              />
            ))}
          </PaletteSection>
          <PaletteSection title="分镜成图" emptyText="分镜尚未绑定图片">
            {storyboardImages.slice(0, 24).map((storyboard) => (
              <PaletteImageButton
                key={storyboard.id}
                title={`分镜 ${storyboard.index}`}
                imageUrl={storyboard.mediaRef!.path}
                onClick={() => addReferenceFromStoryboard(storyboard)}
              />
            ))}
          </PaletteSection>
        </div>
      </aside>
    </section>
  );
}

function ImageWorkflowNodeCard({ data }: NodeProps<ImageWorkflowReactNode>) {
  const node = data.node;
  const borderClass = data.selected
    ? "border-amber-300/80 shadow-[0_18px_42px_rgba(251,191,36,0.22)]"
    : node.type === "generated" && node.status === "ready"
      ? "border-emerald-300/45"
      : "border-white/12";

  return (
    <div
      className={cn(
        "w-[420px] rounded-md border bg-[#151614]/96 p-3 text-zinc-100 shadow-[0_22px_54px_rgba(0,0,0,0.36)]",
        borderClass,
      )}
    >
      {node.type === "generated" ? (
        <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-cyan-100 !bg-cyan-300" />
      ) : null}
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-cyan-100 !bg-cyan-300" />
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/12 bg-white/[0.06]">
            {node.type === "reference" ? <ImageIcon className="h-4 w-4" /> : <WandSparkles className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <input
              value={node.title}
              onChange={(event) => data.onUpdate(node.id, { title: event.target.value } as Partial<ImageWorkflowNode>)}
              className="nodrag nopan w-full truncate bg-transparent text-sm font-semibold outline-none"
            />
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              {node.type}
            </div>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="删除节点"
          onClick={() => data.onDelete(node.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {node.type === "reference" ? (
        <ReferenceNodeEditor node={node} onUpdate={data.onUpdate} />
      ) : (
        <GeneratedNodeEditor
          node={node}
          onUpdate={data.onUpdate}
          onGenerate={data.onGenerate}
          onApplyToStoryboard={data.onApplyToStoryboard}
        />
      )}
    </div>
  );
}

function ReferenceNodeEditor({
  node,
  onUpdate,
}: {
  node: ImageWorkflowReferenceNode;
  onUpdate: ImageWorkflowNodeData["onUpdate"];
}) {
  return (
    <div className="space-y-2">
      <div className="aspect-video overflow-hidden rounded-md border border-white/10 bg-black/30">
        {node.imageUrl ? (
          <LocalImage src={node.imageUrl} alt={node.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">暂无图片</div>
        )}
      </div>
      <input
        value={node.imageUrl}
        onChange={(event) => onUpdate(node.id, { imageUrl: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="project-file://、local-image:// 或 https://"
        className="nodrag nopan h-8 w-full rounded-md border border-white/10 bg-black/25 px-2 text-xs text-zinc-200 outline-none"
      />
      <Textarea
        value={node.notes ?? ""}
        onChange={(event) => onUpdate(node.id, { notes: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="参考说明"
        className="nodrag nopan min-h-[58px] border-white/10 bg-black/25 text-xs text-zinc-200"
      />
    </div>
  );
}

function GeneratedNodeEditor({
  node,
  onUpdate,
  onGenerate,
  onApplyToStoryboard,
}: {
  node: ImageWorkflowGeneratedNode;
  onUpdate: ImageWorkflowNodeData["onUpdate"];
  onGenerate: ImageWorkflowNodeData["onGenerate"];
  onApplyToStoryboard: ImageWorkflowNodeData["onApplyToStoryboard"];
}) {
  const generating = node.status === "generating" || node.status === "queued";
  return (
    <div className="space-y-3">
      <Textarea
        value={node.prompt}
        onChange={(event) => onUpdate(node.id, { prompt: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="描述要生成的图片"
        className="nodrag nopan min-h-[92px] border-white/10 bg-black/25 text-xs leading-5 text-zinc-200"
      />
      <div className="nodrag nopan">
        <ModelSelector
          type="image"
          value={node.model ?? ""}
          onChange={(model) => onUpdate(node.id, { model } as Partial<ImageWorkflowNode>)}
          className="w-full"
        />
      </div>
      <div className="nodrag nopan flex flex-wrap gap-1.5">
        {ASPECT_RATIOS.map((ratio) => (
          <button
            key={ratio}
            type="button"
            className={cn(
              "h-7 rounded-md border px-2 text-[11px]",
              node.aspectRatio === ratio
                ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100"
                : "border-white/10 bg-white/[0.04] text-zinc-400",
            )}
            onClick={() => onUpdate(node.id, { aspectRatio: ratio } as Partial<ImageWorkflowNode>)}
          >
            {ratio}
          </button>
        ))}
        <select
          value={node.quality}
          onChange={(event) =>
            onUpdate(node.id, { quality: event.target.value as ImageWorkflowGeneratedNode["quality"] } as Partial<ImageWorkflowNode>)
          }
          className="h-7 rounded-md border border-white/10 bg-black/25 px-2 text-[11px] text-zinc-200 outline-none"
        >
          {QUALITY_OPTIONS.map((quality) => (
            <option key={quality} value={quality}>
              {quality}
            </option>
          ))}
        </select>
      </div>
      <div className="aspect-video overflow-hidden rounded-md border border-white/10 bg-black/30">
        {node.resultUrl ? (
          <LocalImage src={node.resultUrl} alt={node.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            {node.status === "failed" ? node.errorReason || "生成失败" : "等待生成"}
          </div>
        )}
      </div>
      <div className="nodrag nopan flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
          {node.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : null}
          {node.status}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => onApplyToStoryboard(node.id)} disabled={!node.resultUrl}>
            <Save className="h-3.5 w-3.5" />
            回写
          </Button>
          <Button size="sm" onClick={() => onGenerate(node.id)} disabled={generating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
            生成
          </Button>
        </div>
      </div>
    </div>
  );
}

function PaletteSection({
  title,
  emptyText,
  children,
}: {
  title: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="mb-4">
      <h4 className="mb-2 text-xs font-semibold text-zinc-300">{title}</h4>
      {hasChildren ? (
        <div className="grid grid-cols-2 gap-2">{children}</div>
      ) : (
        <div className="rounded-md border border-white/10 bg-black/20 px-3 py-4 text-center text-xs text-zinc-500">
          {emptyText}
        </div>
      )}
    </section>
  );
}

function PaletteImageButton({
  title,
  imageUrl,
  onClick,
}: {
  title: string;
  imageUrl: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group overflow-hidden rounded-md border border-white/10 bg-black/25 text-left hover:border-cyan-300/50"
      onClick={onClick}
    >
      <div className="aspect-video bg-black/30">
        <LocalImage src={imageUrl} alt={title} className="h-full w-full object-cover" />
      </div>
      <div className="truncate px-2 py-1.5 text-[11px] text-zinc-300 group-hover:text-cyan-100">
        {title}
      </div>
    </button>
  );
}

function nextNodePosition(graph: ImageWorkflowGraph, type: ImageWorkflowNode["type"]) {
  const count = graph.nodes.filter((node) => node.type === type).length;
  return type === "reference"
    ? { x: 80, y: 80 + count * 260 }
    : { x: 620, y: 120 + count * 300 };
}

async function prepareReferenceImages(values: string[]) {
  return prepareImageWorkflowReferenceImages(values, {
    readProjectFileAsBase64: async (url) =>
      window.projectFiles?.readAsBase64(url),
    readLocalImageAsBase64: readImageAsBase64,
  });
}

function workflowImageRelativePath(workflowId: string, filename: string) {
  return `workflow-images/${safePathSegment(workflowId)}/${safePathSegment(filename)}`;
}

function createWorkflowFilename(prefix: "ref" | "gen", id: string, sourceName: string) {
  const ext = safeExtension(sourceName);
  const base = safePathSegment(sourceName.replace(/\.[^.]+$/, "")) || prefix;
  return `${prefix}-${safePathSegment(id)}-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

function safePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "file";
}

function safeExtension(value: string) {
  const match = value.match(/\.([a-z0-9]{2,8})$/i);
  return match ? `.${match[1].toLowerCase()}` : ".png";
}
