// H3 工作流组装器共用底层(1123 D17 自 h3-shot-video-workflow.ts 拆出):画布件/执行图两种形态的
// 类型、取节点与写控件工具、镜号标签、文案逐字自检门。叶子模块——不依赖任何组装器,
// 供 h3-shot-video-workflow.ts 与 h3-multiseg-video-workflow.ts 共用(单向依赖,无环)。
import { extractPlannedDialogueTexts, verifyPlannedTextVerbatim, type H3AudioPolicy } from "./h3-shot-prompt";

export interface WorkflowNode {
  id: number;
  type: string;
  mode?: number;
  inputs?: Array<Record<string, unknown>>;
  outputs?: Array<Record<string, unknown>>;
  widgets_values?: unknown[];
  widgets_values_named?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}


export interface H3WorkflowTemplate {
  nodes: WorkflowNode[];
  links?: unknown[][];
  last_link_id?: number;
  [key: string]: unknown;
}

export function getNode(template: H3WorkflowTemplate, id: number, type: string): WorkflowNode {
  const node = template.nodes.find((item) => item.id === id);
  if (!node || node.type !== type) throw new Error(`h3-shot-template drift: node ${id} must be ${type}`);
  return node;
}

export function setFirstWidget(node: WorkflowNode, value: unknown): void {
  if (!Array.isArray(node.widgets_values)) throw new Error(`h3-shot-template drift: node ${node.id} widgets_values missing`);
  node.widgets_values[0] = value;
}


export function setNamedWidget(node: WorkflowNode, key: string, value: unknown): void {
  if (node.widgets_values_named) node.widgets_values_named[key] = value;
}

export type ApiGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export function getApiNode(apiGraph: ApiGraph, id: string, classType: string): { class_type: string; inputs: Record<string, unknown> } {
  const node = apiGraph[id];
  if (!node || node.class_type !== classType) throw new Error(`h3-shot-template.api.json drift: node ${id} must be ${classType}`);
  return node;
}

export function safeImageId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, "_");
}


export function shotLabel(index: number): string {
  return `S${String(index).padStart(2, "0")}`;
}


/** 文案逐字自检门(docs/comfyui-kb/参考_文案逐字自检门.md §一,10-01-a7 代码化):
 * 产出 prompt 之后、注入工作流(=入队派发)之前逐条验「计划文案一字不差在场」,
 * 任一缺席即抛大白话中文错误阻断派发(冒泡至桥消费 onError→toast,不静默不放行)。
 * 清单口径:仅 full 档台词进 prompt 才入清单(与 renderDialogue 同一解析源);
 * ambient/bare 档台词走 TTS 线不进 prompt(「No dialogue」),清单为空不拦。 */
export function assertPlannedTextVerbatimGate(shot: { index: number; lines?: string }, policy: H3AudioPolicy, prompt: string): void {
  const plannedTexts = policy === "full" ? extractPlannedDialogueTexts(shot.lines) : [];
  const { ok, missing } = verifyPlannedTextVerbatim(prompt, plannedTexts);
  if (ok) return;
  const items = missing.map((text) => `「${text}」`).join("");
  throw new Error(
    `文案逐字自检未通过,${shotLabel(shot.index)} 这镜已禁止派发:有 ${missing.length} 条计划台词没有一字不差地进入最终提示词——${items}。请回上一环节把文案修正到一字不差(含标点)后再派发。`,
  );
}
