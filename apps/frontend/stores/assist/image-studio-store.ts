// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import {
  addGeneratedImageNode,
  addPromptImageNode,
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
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowNodePosition,
  ImageWorkflowViewport,
} from "@/types/studio";

/**
 * 图片工作室(辅助面板·自由画布)多画布 store。
 *
 * 与分镜工作流 useStudioStore.imageWorkflows 的分工:后者项目内分片持久化
 * (studio-workflow 分片随项目走),本 store 应用级 localStorage——自由画布
 * 不依赖打开项目。图模型复用 ImageWorkflowGraph(target.kind="free"),
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
  removeNode: (nodeId: string) => void;
  connect: (source: string, target: string) => void;
  removeEdge: (edgeId: string) => void;
  setViewport: (viewport: ImageWorkflowViewport) => void;
  applyLayout: () => void;
  addReferenceNode: (input: { imageUrl: string; title?: string; position?: ImageWorkflowNodePosition }) => string;
  addPromptNode: (input?: { prompt?: string; negativePrompt?: string; position?: ImageWorkflowNodePosition }) => string;
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
  setNodeStatus: (
    nodeId: string,
    status: ImageWorkflowGeneratedNode["status"],
    errorReason?: string,
  ) => void;
  setNodeResult: (nodeId: string, result: { imageUrl: string; mediaId?: string }) => void;
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
function sanitizeWorkflowsForPersist(workflows: ImageWorkflowGraph[]): ImageWorkflowGraph[] {
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

const sanitizedLocalStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    try {
      const parsed = JSON.parse(value) as {
        state?: { workflows?: ImageWorkflowGraph[] };
      };
      if (parsed.state?.workflows) {
        parsed.state.workflows = sanitizeWorkflowsForPersist(parsed.state.workflows);
      }
      localStorage.setItem(name, JSON.stringify(parsed));
    } catch {
      localStorage.setItem(name, value);
    }
  },
  removeItem: (name) => localStorage.removeItem(name),
};

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
        get().updateActiveWorkflow((graph) => ({
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.id === nodeId ? ({ ...node, position } as ImageWorkflowNode) : node,
          ),
          updatedAt: Date.now(),
        }));
      },

      removeNode: (nodeId) => {
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
        if (input?.referenceImageUrl) {
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

      setNodeExtras: (nodeId, extras) => {
        set((state) => ({
          nodeExtras: { ...state.nodeExtras, [nodeId]: extras },
        }));
      },
    }),
    {
      name: "mystudio-image-studio",
      version: 1,
      storage: createJSONStorage(() => sanitizedLocalStorage),
      partialize: (state) => ({
        workflows: state.workflows,
        activeWorkflowId: state.activeWorkflowId,
        nodeExtras: state.nodeExtras,
      }),
      onRehydrateStorage: () => (state) => resetTransientNodeStatus(state),
    },
  ),
);
