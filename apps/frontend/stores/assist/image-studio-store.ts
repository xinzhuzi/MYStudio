// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  addGeneratedImageNode,
  addGroupNode,
  addPromptImageNode,
  addStickyNoteNode,
  addReferenceImageNode,
  connectImageWorkflowNodes,
  createId,
  createImageWorkflowGraph,
  removeImageWorkflowEdge,
  removeImageWorkflowNode,
  setGeneratedImageResult,
  setGeneratedImageStatus,
  updateImageWorkflowNode,
} from "@/lib/studio/image-workflow/graph-build";
import {
  layoutImageStudioGraph,
  nextColumnPosition,
} from "@/lib/assist/image-studio/layout";
import { createImageStudioProjectStorage } from "@/lib/storage/image-studio-project-storage";
import { logEvent } from "@/lib/diagnostics/logger";
import type { ImageWorkflowEdge,
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowGroupNode,
  ImageWorkflowNode,
  ImageWorkflowNodePosition,
  ImageWorkflowViewport,
} from "@/types/studio";

/**
 * 图片工作室(辅助面板·自由画布)多画布 store。
 *
 * 与分镜工作流 useStudioStore.imageWorkflows 的分工:后者项目内分片持久化
 * (studio-workflow 分片随项目走),本 store 09-03 起同为**项目侧持久化**:
 * `_p/<activeProjectId>/image-studio.json`(经 fileStorage IPC)——画布是
 * 生产内容,随项目复制/备份/迁移(用户裁定;旧 localStorage 住址已废弃,
 * 升级首读自动迁移)。图模型复用 ImageWorkflowGraph(target.kind="free"),
 * 节点/边 CRUD 全部经 lib/studio/image-workflow/graph-build(单一实现源)。
 */
export interface ImageStudioStoreState {
  workflows: ImageWorkflowGraph[];
  activeWorkflowId: string | null;
  /** 模型专属附加参数(MJ/Ideogram)按节点 id 存放;节点模型不含该字段(类型冻结) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodeExtras: Record<string, Record<string, any>>;
}

export interface ImageStudioNodeGroup {
  referenceNodeId?: string;
  promptNodeId: string;
  generatedNodeId: string;
}

export interface ImageStudioStoreActions {
  ensureDefaultWorkflow: () => string;
  createWorkflow: (name?: string) => string;
  renameWorkflow: (workflowId: string, name: string) => void;
  deleteWorkflow: (workflowId: string) => void;
  switchWorkflow: (workflowId: string) => void;
  updateActiveWorkflow: (mutate: (graph: ImageWorkflowGraph) => ImageWorkflowGraph) => void;
  updateNode: (nodeId: string, updates: Partial<ImageWorkflowNode>) => void;
  moveNode: (nodeId: string, position: ImageWorkflowNodePosition) => void;
  /** 分组成员登记(09-03 wave3):拖入吸附/拖出移除;幂等 */
  setGroupMembership: (groupId: string, nodeId: string, isMember: boolean) => void;
  removeNode: (nodeId: string) => void;
  /** 右键复制:同类型新节点携同类字段(prompt/图),落原位右下偏移 */
  duplicateNode: (nodeId: string) => string | null;
  /** 导入画布 JSON(09-02 R2):校验形状→新画布落节点;media 失效节点降级占位 */
  importWorkflow: (payload: unknown) => { ok: true; id: string } | { ok: false; error: string };
  connect: (source: string, target: string) => void;
  removeEdge: (edgeId: string) => void;
  setViewport: (viewport: ImageWorkflowViewport) => void;
  applyLayout: () => void;
  addReferenceNode: (input: { imageUrl: string; title?: string; position?: ImageWorkflowNodePosition }) => string;
  addPromptNode: (input?: { prompt?: string; negativePrompt?: string; position?: ImageWorkflowNodePosition }) => string;
  /** 便利贴(09-03 wave3):画布标注件 */
  addStickyNote: (input?: { text?: string; color?: "yellow" | "green" | "blue" | "pink" | "gray"; position?: ImageWorkflowNodePosition }) => string;
  /** Group 框组(09-03 wave3):视觉容器 */
  addGroup: (input?: { label?: string; position?: ImageWorkflowNodePosition }) => string;
  addGeneratedNode: (input?: { prompt?: string; model?: string }) => string;
  /** 一键建组:文生图=提示词+成图;带参考图地址则为图生图三件套 */
  addGenerationGroup: (input?: {
    prompt?: string;
    negativePrompt?: string;
    model?: string;
    referenceImageUrl?: string;
    /** 右键落点:成图列锚位(提示词落其左列) */
    position?: ImageWorkflowNodePosition;
  }) => ImageStudioNodeGroup;
  /** 复原生成记录(09-03 弹窗):单快照重建 参考图×N+提示词(含反向)+成图+连线+result 回填 */
  restoreGenerationGroup: (input: {
    prompt: string;
    negativePrompt?: string;
    model?: string;
    aspectRatio?: string;
    references?: string[];
    result: { imageUrl: string; mediaId?: string };
    batchImageUrls?: string[];
    generatedAt?: number;
  }) => ImageStudioNodeGroup;
  setNodeStatus: (
    nodeId: string,
    status: ImageWorkflowGeneratedNode["status"],
    errorReason?: string,
  ) => void;
  setNodeResult: (nodeId: string, result: { imageUrl: string; mediaId?: string }) => void;
  /** 批量组落图(09-02):images[primaryIndex] 为主图,组外消费零改动 */
  setNodeBatchResult: (nodeId: string, images: string[], mediaId?: string) => void;
  setBatchPrimary: (nodeId: string, index: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setNodeExtras: (nodeId: string, extras: Record<string, any>) => void;
}

export type ImageStudioStore = ImageStudioStoreState & ImageStudioStoreActions;

export function selectActiveImageStudioWorkflow(
  state: Pick<ImageStudioStoreState, "workflows" | "activeWorkflowId">,
): ImageWorkflowGraph | undefined {
  return state.workflows.find((workflow) => workflow.id === state.activeWorkflowId);
}

function nextCanvasName(workflows: ImageWorkflowGraph[]): string {
  const numbers = workflows
    .map((workflow) => /^画布 (\d+)$/.exec(workflow.name.trim())?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  const next = (numbers.length === 0 ? 0 : Math.max(...numbers)) + 1;
  return `画布 ${next}`;
}

/** 持久化净化:节点图片地址禁 data:/blob:(内存爆炸+跨会话失真),写入前剥离 */
export function sanitizeWorkflowsForPersist(workflows: ImageWorkflowGraph[]): ImageWorkflowGraph[] {
  return workflows.map((workflow) => ({
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      if (node.type === "reference" && node.imageUrl.startsWith("data:")) {
        return { ...node, imageUrl: "" } as ImageWorkflowNode;
      }
      if (
        node.type === "generated"
        && node.resultUrl
        && node.resultUrl.startsWith("data:")
      ) {
        return {
          ...node,
          resultUrl: undefined,
          resultMediaId: undefined,
          status: "idle",
          errorReason: "地址未落库,请重新生成",
        } as ImageWorkflowNode;
      }
      return node;
    }),
  }));
}

/** 水合复位:生成中状态不跨会话(进程中断会永久卡「生成中」) */
function resetTransientNodeStatus(state?: Partial<ImageStudioStoreState>): void {
  if (!state?.workflows) return;
  state.workflows = state.workflows.map((workflow) => ({
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      if (node.type !== "generated") return node;
      if (node.status !== "generating" && node.status !== "queued") return node;
      return { ...node, status: "idle" } as ImageWorkflowNode;
    }),
  }));
}

/** 持久化前净化单个画布:瞬态媒体(data:/blob:)禁入项目分片 */
function sanitizePersistedCanvas(canvas: ImageWorkflowGraph): ImageWorkflowGraph {
  return sanitizeWorkflowsForPersist([canvas])[0] ?? canvas;
}

const imageStudioProjectStorage = createImageStudioProjectStorage<ImageWorkflowGraph>({
  sanitizeWorkflow: sanitizePersistedCanvas,
});

/** add 类动作自愈:画布被删光/激活失效时先确保默认画布存在 */
function ensureActiveCanvas(
  get: () => ImageStudioStore,
  set: (partial: Partial<ImageStudioStoreState>) => void,
): void {
  if (selectActiveImageStudioWorkflow(get())) {
    return;
  }
  if (get().workflows.length === 0) {
    get().createWorkflow();
  } else {
    set({ activeWorkflowId: get().workflows[0].id });
  }
}

export const useImageStudioStore = create<ImageStudioStore>()(
  persist(
    (set, get) => ({
      workflows: [],
      activeWorkflowId: null,
      nodeExtras: {},

      ensureDefaultWorkflow: () => {
        const { workflows, activeWorkflowId } = get();
        const activeExists = workflows.some((workflow) => workflow.id === activeWorkflowId);
        if (workflows.length === 0) {
          const id = get().createWorkflow();
          return id;
        }
        if (!activeExists) {
          set({ activeWorkflowId: workflows[0].id });
        }
        return activeExists ? (activeWorkflowId as string) : workflows[0].id;
      },

      createWorkflow: (name) => {
        const graph = createImageWorkflowGraph({
          id: createId("studio-canvas"),
          name: name?.trim() || nextCanvasName(get().workflows),
          target: { kind: "free" },
        });
        set((state) => ({
          workflows: [...state.workflows, graph],
          activeWorkflowId: graph.id,
        }));
        return graph.id;
      },

      renameWorkflow: (workflowId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => ({
          workflows: state.workflows.map((workflow) =>
            workflow.id === workflowId
              ? { ...workflow, name: trimmed, updatedAt: Date.now() }
              : workflow,
          ),
        }));
      },

      deleteWorkflow: (workflowId) => {
        set((state) => {
          const remaining = state.workflows.filter((workflow) => workflow.id !== workflowId);
          const removed = state.workflows.find((workflow) => workflow.id === workflowId);
          const nodeExtras = { ...state.nodeExtras };
          if (removed) {
            for (const node of removed.nodes) delete nodeExtras[node.id];
          }
          const activeWorkflowId =
            state.activeWorkflowId === workflowId
              ? (remaining[0]?.id ?? null)
              : state.activeWorkflowId;
          return { workflows: remaining, activeWorkflowId, nodeExtras };
        });
      },

      switchWorkflow: (workflowId) => {
        if (get().workflows.some((workflow) => workflow.id === workflowId)) {
          const target = get().workflows.find((workflow) => workflow.id === workflowId);
          void logEvent({
            category: "action",
            level: "info",
            message: "[canvas-switch-race] switchWorkflow",
            context: {
              workflowId,
              from: get().activeWorkflowId,
              nodeCount: target?.nodes.length ?? 0,
            },
          });
          set({ activeWorkflowId: workflowId });
        }
      },

      updateActiveWorkflow: (mutate) => {
        set((state) => ({
          workflows: state.workflows.map((workflow) =>
            workflow.id === state.activeWorkflowId ? mutate(workflow) : workflow,
          ),
        }));
      },

      updateNode: (nodeId, updates) => {
        get().updateActiveWorkflow((graph) => updateImageWorkflowNode(graph, nodeId, updates));
      },

      moveNode: (nodeId, position) => {
        get().updateActiveWorkflow((graph) => {
          const moved = graph.nodes.find((node): node is ImageWorkflowGroupNode => node.id === nodeId && node.type === "group");
          // 分组框(09-03 wave3):移动组带动成员(同位移;单次 updateActiveWorkflow=
          // 单份撤销快照)
          const memberDelta = moved
            ? { dx: position.x - moved.position.x, dy: position.y - moved.position.y }
            : null;
          const members = moved ? new Set(moved.memberIds) : null;
          const delta = memberDelta!;
          return {
            ...graph,
            nodes: graph.nodes.map((node) => {
              if (node.id === nodeId) return { ...node, position } as ImageWorkflowNode;
              if (members?.has(node.id)) {
                return {
                  ...node,
                  position: { x: node.position.x + delta.dx, y: node.position.y + delta.dy },
                } as ImageWorkflowNode;
              }
              return node;
            }),
            updatedAt: Date.now(),
          };
        });
      },

      setGroupMembership: (groupId, nodeId, isMember) => {
        get().updateActiveWorkflow((graph) => ({
          ...graph,
          nodes: graph.nodes.map((node) => {
            if (node.id !== groupId || node.type !== "group") return node;
            const set = new Set(node.memberIds);
            if (isMember) set.add(nodeId);
            else set.delete(nodeId);
            return { ...node, memberIds: [...set], updatedAt: Date.now() };
          }),
          updatedAt: Date.now(),
        }));
      },

      importWorkflow: (payload) => {
        const data = payload as {
          schemaVersion?: number;
          name?: unknown;
          nodes?: unknown;
          edges?: unknown;
        };
        if (!data || typeof data !== "object") return { ok: false, error: "文件不是有效 JSON 对象" };
        if (data.schemaVersion !== 1) return { ok: false, error: "schemaVersion 不支持" };
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
          return { ok: false, error: "缺少 nodes/edges 数组" };
        }
        const validTypes = new Set(["reference", "prompt", "generated"]);
        const nodes = (data.nodes as Array<Record<string, unknown>>).filter(
          (node) => typeof node.id === "string" && typeof node.type === "string" && validTypes.has(node.type),
        );
        if (nodes.length === 0) return { ok: false, error: "没有有效节点" };
        const nodeIds = new Set(nodes.map((node) => node.id as string));
        const nodeTypeById = new Map(nodes.map((node) => [node.id as string, node.type as string]));
        // 边域规则与单源对齐(connectImageWorkflowNodes 三条):目标必须成图/
        // 非自环/同向去重——不合规边丢弃(与 media 失效降级同哲学:宽容导入)
        const seenEdgePairs = new Set<string>();
        const edges = (data.edges as Array<Record<string, unknown>>).filter((edge) => {
          if (
            typeof edge.id !== "string" ||
            typeof edge.source !== "string" ||
            typeof edge.target !== "string" ||
            !nodeIds.has(edge.source as string) ||
            !nodeIds.has(edge.target as string)
          ) {
            return false;
          }
          if (edge.source === edge.target) return false;
          if (nodeTypeById.get(edge.target as string) !== "generated") return false;
          const pair = `${edge.source}->${edge.target}`;
          if (seenEdgePairs.has(pair)) return false;
          seenEdgePairs.add(pair);
          return true;
        });
        const id = get().createWorkflow(
          typeof data.name === "string" ? `${data.name}(导入)` : undefined,
        );
        set((state) => ({
          workflows: state.workflows.map((workflow) =>
            workflow.id === id
              ? {
                  ...workflow,
                  nodes: nodes.map((node) => ({
                    ...node,
                    // media 失效引用降级空占位不报错
                    imageUrl: typeof node.imageUrl === "string" ? node.imageUrl : "",
                    position:
                      node.position && typeof node.position === "object"
                        ? node.position
                        : { x: 80, y: 0 },
                  })) as ImageWorkflowNode[],
                  edges: edges.map((edge) => ({
                    id: edge.id as string,
                    source: edge.source as string,
                    target: edge.target as string,
                  })) as ImageWorkflowEdge[],
                }
              : workflow,
          ),
        }));
        return { ok: true, id };
      },

      duplicateNode: (nodeId) => {
        ensureActiveCanvas(get, set);
        const graph = selectActiveImageStudioWorkflow(get());
        const source = graph?.nodes.find((node) => node.id === nodeId);
        if (!graph || !source) return null;
        const offset = { x: source.position.x + 48, y: source.position.y + 48 };
        const id = createId(source.type === "generated" ? "gen" : source.type === "reference" ? "ref" : "prompt");
        get().updateActiveWorkflow((current) => {
          if (source.type === "reference") {
            return addReferenceImageNode(current, {
              id,
              title: `${source.title} 副本`,
              imageUrl: source.imageUrl,
              position: offset,
            });
          }
          if (source.type === "prompt") {
            return addPromptImageNode(current, {
              id,
              title: `${source.title} 副本`,
              prompt: source.prompt,
              negativePrompt: source.negativePrompt,
              position: offset,
            });
          }
          if (source.type === "sticky") {
            return addStickyNoteNode(current, {
              id,
              title: `${source.title} 副本`,
              text: source.text,
              color: source.color,
              position: offset,
            });
          }
          if (source.type === "group") {
            return addGroupNode(current, {
              id,
              label: `${source.title} 副本`,
              memberIds: [...source.memberIds],
              position: offset,
            });
          }
          return addGeneratedImageNode(current, {
            id,
            title: `${source.title} 副本`,
            prompt: source.prompt,
            negativePrompt: source.negativePrompt,
            model: source.model,
            position: offset,
          });
        });
        return id;
      },

      removeNode: (nodeId) => {
        get().updateActiveWorkflow((graph) => ({
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.type === "group" && node.memberIds.includes(nodeId)
              ? { ...node, memberIds: node.memberIds.filter((id) => id !== nodeId), updatedAt: Date.now() }
              : node,
          ),
          updatedAt: Date.now(),
        }));

        set((state) => {
          const nodeExtras = { ...state.nodeExtras };
          delete nodeExtras[nodeId];
          return { nodeExtras };
        });
        get().updateActiveWorkflow((graph) => removeImageWorkflowNode(graph, nodeId));
      },

      connect: (source, target) => {
        get().updateActiveWorkflow((graph) =>
          connectImageWorkflowNodes(graph, { source, target }),
        );
      },

      removeEdge: (edgeId) => {
        get().updateActiveWorkflow((graph) => removeImageWorkflowEdge(graph, edgeId));
      },

      setViewport: (viewport) => {
        get().updateActiveWorkflow((graph) => ({ ...graph, viewport }));
      },

      applyLayout: () => {
        get().updateActiveWorkflow((graph) => ({
          ...layoutImageStudioGraph(graph),
          updatedAt: Date.now(),
        }));
      },

      addReferenceNode: ({ imageUrl, title, position }) => {
        ensureActiveCanvas(get, set);
        const id = createId("ref");
        get().updateActiveWorkflow((current) =>
          addReferenceImageNode(current, {
            id,
            title: title ?? "参考图",
            imageUrl,
            position: position ?? nextColumnPosition(current, "reference"),
          }),
        );
        return id;
      },

      addStickyNote: (input) => {
        ensureActiveCanvas(get, set);
        let id = "";
        set((state) => ({
          workflows: state.workflows.map((workflow) => {
            if (workflow.id !== get().activeWorkflowId) return workflow;
            id = createId("sticky");
            return addStickyNoteNode(workflow, { id, ...input });
          }),
        }));
        return id;
      },

      addGroup: (input) => {
        ensureActiveCanvas(get, set);
        let id = "";
        set((state) => ({
          workflows: state.workflows.map((workflow) => {
            if (workflow.id !== get().activeWorkflowId) return workflow;
            id = createId("group");
            return addGroupNode(workflow, { id, ...input });
          }),
        }));
        return id;
      },

      addPromptNode: (input) => {
        ensureActiveCanvas(get, set);
        const id = createId("prompt");
        get().updateActiveWorkflow((current) =>
          addPromptImageNode(current, {
            id,
            title: "提示词",
            prompt: input?.prompt ?? "",
            negativePrompt: input?.negativePrompt,
            position: input?.position ?? nextColumnPosition(current, "prompt"),
          }),
        );
        return id;
      },

      addGeneratedNode: (input) => {
        const id = createId("gen");
        get().updateActiveWorkflow((current) =>
          addGeneratedImageNode(current, {
            id,
            title: "生成图",
            prompt: input?.prompt ?? "",
            model: input?.model,
            position: nextColumnPosition(current, "generated"),
          }),
        );
        return id;
      },

      addGenerationGroup: (input) => {
        ensureActiveCanvas(get, set);
        const graph = selectActiveImageStudioWorkflow(get());
        if (!graph) {
          throw new Error("画布未就绪");
        }
        const group: ImageStudioNodeGroup = { promptNodeId: "", generatedNodeId: "" };
        let current = graph;
        // 右键落点(可选):组内以落点为成图列基准,提示词在其左列
        const anchor = input?.position;
        // 空串=空参考图位(「图生图」直建组用,与文生图同款零弹窗;用户
        // 在参考图节点内点上传/拖图填充)——undefined 才是「不建参考图」
        if (input?.referenceImageUrl !== undefined) {
          const referenceNodeId = createId("ref");
          current = addReferenceImageNode(current, {
            id: referenceNodeId,
            title: "参考图",
            imageUrl: input.referenceImageUrl,
            position: nextColumnPosition(current, "reference"),
          });
          group.referenceNodeId = referenceNodeId;
        }
        const promptNodeId = createId("prompt");
        current = addPromptImageNode(current, {
          id: promptNodeId,
          title: "提示词",
          prompt: input?.prompt ?? "",
          negativePrompt: input?.negativePrompt,
          position: anchor
            ? { x: anchor.x - 380, y: anchor.y }
            : nextColumnPosition(current, "prompt"),
        });
        group.promptNodeId = promptNodeId;
        const generatedNodeId = createId("gen");
        current = addGeneratedImageNode(current, {
          id: generatedNodeId,
          title: "生成图",
          prompt: input?.prompt ?? "",
          model: input?.model,
          position: anchor ?? nextColumnPosition(current, "generated"),
        });
        group.generatedNodeId = generatedNodeId;
        if (group.referenceNodeId) {
          current = connectImageWorkflowNodes(current, {
            source: group.referenceNodeId,
            target: generatedNodeId,
          });
        }
        current = connectImageWorkflowNodes(current, {
          source: promptNodeId,
          target: generatedNodeId,
        });
        get().updateActiveWorkflow(() => current);
        return group;
      },

      restoreGenerationGroup: (input) => {
        ensureActiveCanvas(get, set);
        const graph = selectActiveImageStudioWorkflow(get());
        if (!graph) {
          throw new Error("画布未就绪");
        }
        // 整组建构走图纯函数、最后一次 updateActiveWorkflow=单份撤销快照
        let current = graph;
        const references = (input.references ?? []).slice(0, 4);
        const referenceNodeIds: string[] = [];
        for (const imageUrl of references) {
          const referenceNodeId = createId("ref");
          referenceNodeIds.push(referenceNodeId);
          current = addReferenceImageNode(current, {
            id: referenceNodeId,
            title: "参考图",
            imageUrl,
            position: nextColumnPosition(current, "reference"),
          });
        }
        const promptNodeId = createId("prompt");
        current = addPromptImageNode(current, {
          id: promptNodeId,
          title: "提示词",
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          position: nextColumnPosition(current, "prompt"),
        });
        const generatedNodeId = createId("gen");
        current = addGeneratedImageNode(current, {
          id: generatedNodeId,
          title: "生成图",
          prompt: input.prompt,
          model: input.model,
          position: nextColumnPosition(current, "generated"),
        });
        for (const referenceNodeId of referenceNodeIds) {
          current = connectImageWorkflowNodes(current, {
            source: referenceNodeId,
            target: generatedNodeId,
          });
        }
        current = connectImageWorkflowNodes(current, {
          source: promptNodeId,
          target: generatedNodeId,
        });
        if (input.aspectRatio) {
          current = updateImageWorkflowNode(current, generatedNodeId, {
            aspectRatio: input.aspectRatio,
          });
        }
        current = setGeneratedImageResult(current, generatedNodeId, {
          imageUrl: input.result.imageUrl,
          mediaId: input.result.mediaId,
          generatedAt: input.generatedAt,
        });
        get().updateActiveWorkflow(() => current);
        if (input.batchImageUrls && input.batchImageUrls.length > 1) {
          get().setNodeBatchResult(generatedNodeId, input.batchImageUrls, input.result.mediaId);
        }
        return { promptNodeId, generatedNodeId };
      },

      setNodeStatus: (nodeId, status, errorReason) => {
        // 生成生命周期写入按「节点所在画布」定位,而非当前激活画布——
        // 生成期间用户切换画布时,回写必须落在发起生成的那张画布上
        set((state) => ({
          workflows: state.workflows.map((workflow) =>
            workflow.nodes.some((node) => node.id === nodeId)
              ? setGeneratedImageStatus(workflow, nodeId, status, errorReason)
              : workflow,
          ),
        }));
      },

      setNodeResult: (nodeId, result) => {
        set((state) => ({
          workflows: state.workflows.map((workflow) =>
            workflow.nodes.some((node) => node.id === nodeId)
              ? setGeneratedImageResult(workflow, nodeId, result)
              : workflow,
          ),
        }));
      },

      setNodeBatchResult: (nodeId, images, mediaId) => {
        if (images.length === 0) return;
        set((state) => ({
          workflows: state.workflows.map((workflow) => ({
            ...workflow,
            nodes: workflow.nodes.map((node) => {
              if (node.id !== nodeId || node.type !== "generated") return node;
              const next = setGeneratedImageResult(workflow, nodeId, {
                imageUrl: images[0],
                mediaId,
              }).nodes.find((item) => item.id === nodeId);
              return next
                ? {
                    ...next,
                    imageBatch: images.length > 1 ? { images, primaryIndex: 0 } : undefined,
                  }
                : node;
            }),
          })),
        }));
      },

      setBatchPrimary: (nodeId, index) => {
        set((state) => ({
          workflows: state.workflows.map((workflow) => ({
            ...workflow,
            nodes: workflow.nodes.map((node) => {
              if (node.id !== nodeId || node.type !== "generated" || !node.imageBatch) return node;
              const safeIndex = Math.max(0, Math.min(index, node.imageBatch.images.length - 1));
              return safeIndex === node.imageBatch.primaryIndex
                ? node
                : {
                    ...node,
                    resultUrl: node.imageBatch.images[safeIndex],
                    imageBatch: { ...node.imageBatch, primaryIndex: safeIndex },
                  };
            }),
          })),
        }));
      },

      setNodeExtras: (nodeId, extras) => {
        set((state) => ({
          nodeExtras: { ...state.nodeExtras, [nodeId]: extras },
        }));
      },
    }),
    {
      name: "mystudio-image-studio",
      version: 1,
      storage: createJSONStorage(() => imageStudioProjectStorage),
      partialize: (state) => ({
        workflows: state.workflows,
        activeWorkflowId: state.activeWorkflowId,
        nodeExtras: state.nodeExtras,
      }),
      onRehydrateStorage: () => (state) => resetTransientNodeStatus(state),
    },
  ),
);
