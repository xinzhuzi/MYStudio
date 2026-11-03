// 工作流绑定 store(11-02-engine-model-workflow-hub Q3 裁定:全局每类型一绑——
// 文生图一件/图生图一件;空=null=不绑=现行为(引擎按操作类型自动选模板,道劫默认零迁移)。
// 出图联动(S3):run-image-workflow-node-generation 的 buildRequest 读
// resolveBoundTemplateForGeneration 注入 extraParams.template,经 ai-sdk-bridge
// Object.assign 透传进 sidecar /v1/images/generations body(server.py:361→pipeline
// template=…);分镜批量恒 qi21 既有裁定,不走绑定注入。
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { LOCAL_IMAGE_MODELS } from "@/stores/ai/api-config-provider-helpers";

export const WORKFLOW_BINDINGS_STORAGE_KEY = "mystudio-workflow-bindings";

export type BoundWorkflowKind = "t2i" | "i2i";

interface WorkflowBindingsState {
  /** 文生图绑定工作流 id(list_workflows 的库内相对路径);null=不绑走默认。 */
  t2iWorkflowId: string | null;
  /** 图生图绑定工作流 id(编辑件同域,随图生图类型);null=不绑走默认。 */
  i2iWorkflowId: string | null;
  setBinding: (kind: BoundWorkflowKind, workflowId: string | null) => void;
}

export const useWorkflowBindingsStore = create<WorkflowBindingsState>()(
  persist(
    (set) => ({
      t2iWorkflowId: null,
      i2iWorkflowId: null,
      setBinding: (kind, workflowId) => set({ [`${kind}WorkflowId`]: workflowId } as Partial<WorkflowBindingsState>),
    }),
    {
      name: WORKFLOW_BINDINGS_STORAGE_KEY,
      partialize: (state) => ({
        t2iWorkflowId: state.t2iWorkflowId,
        i2iWorkflowId: state.i2iWorkflowId,
      }),
      // 工作流 id 属非敏感 UI 资产,明文 localStorage 即可(engine-presets 走
      // safeStorage 是因其共键范式;此 store 无密件,不引加密链)
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/**
 * 绑定 id(库内画布路径)→ 引擎 API 模板键映射(1102 收口轮语义定谳修复:
 * load_template 只吃 API 模板名,画布路径进不去——道劫三件与 API 模板同源
 * (builder 从画布展平生成),故仅此三件可绑;其余库内件返回 null=无引擎模板)。
 */
const BINDABLE_WORKFLOW_TEMPLATES: { match: RegExp; templateKey: string }[] = [
  { match: /1_文生图\/qi21-道劫-t2i/, templateKey: "qwen21_道劫_t2i_api" },
  { match: /2_图生图\/qi21-道劫-i2i/, templateKey: "qwen21_道劫_i2i_api" },
  { match: /2_图生图\/qi21-edit/, templateKey: "qwen21_道劫_i2i_api" },
];

/** 绑定件是否可被引擎执行(有道劫 API 模板同源件);UI 候选行据此开/关绑定钮。 */
export function isBindableWorkflow(workflowId: string): boolean {
  return BINDABLE_WORKFLOW_TEMPLATES.some((entry) => entry.match.test(workflowId));
}

/**
 * 出图绑定解析(S3 注入点消费):大模型才有模板绑定语义(云端/桥模型返回
 * undefined=现行为);hasReferences 决定类型(有参考图=图生图位,否则文生图位);
 * 绑定 id 经映射层转引擎模板键(1102 修复:原样传库内路径引擎吃不到)。
 */
export function resolveBoundTemplateForGeneration(model: string, hasReferences: boolean): string | undefined {
  if (!(LOCAL_IMAGE_MODELS as readonly string[]).includes(model)) return undefined;
  const state = useWorkflowBindingsStore.getState();
  const bound = hasReferences ? state.i2iWorkflowId : state.t2iWorkflowId;
  if (!bound) return undefined;
  const hit = BINDABLE_WORKFLOW_TEMPLATES.find((entry) => entry.match.test(bound));
  return hit?.templateKey;
}
