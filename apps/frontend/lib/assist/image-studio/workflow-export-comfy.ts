// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 存量画布迁移器(09-09 comfyui-frontend-swap 阶段2):
 * 自家 nodes/edges 图 → ComfyUI workflow 双格式(design.md 2.4 铁律:
 * UI 格式=原生前端打开可编辑;API 格式=无头复跑直提交 /prompt)。
 *
 * 拓扑(design 2.4 映射表):ManyingPrompt(正/负 STRING)→模板 Encode;
 * 参考图→原生 LoadImage(占位文件名,真图由 bridge 上传后同名替换);
 * 成图→K2 模板簇(平铺非子图,核实点② MVP 落法);SaveImage→
 * ManyingGenerated(回写终端)。同拓扑双格式表达。
 */

import type {
  ImageWorkflowEdge,
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowPromptNode,
  ImageWorkflowReferenceNode,
} from "@/types/studio";
import krea2T2i from "../../../../backend/engines/image_engine/workflows/MY-krea2_t2i.json";
import krea2EditRef from "../../../../backend/engines/image_engine/workflows/MY-krea2_edit_ref.json";

/** 画幅→宽高(与 engines/image_engine/comfyui_bridge.ASPECT_RATIOS 同源单点,改两处同步) */
const ASPECT_RATIOS: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1152, 640],
  "9:16": [640, 1152],
  "4:3": [1072, 808],
  "3:4": [808, 1072],
};

const DEFAULT_STEPS = 10;

/** 节点规格(冻结自 object_info@v0.34.6 + 模板 JSON 键序=原 UI widget 序);
 * linkInputs 序=模板键序(与 ComfyUI inputs 槽序一致)。 */
interface NodeSpec {
  widgets: string[];
  linkInputs: string[];
  outputs: Array<[name: string, type: string]>;
}

const NODE_SPEC: Record<string, NodeSpec> = {
  ManyingPrompt: { widgets: ["positive", "negative"], linkInputs: [], outputs: [["positive", "STRING"], ["negative", "STRING"]] },
  ManyingGenerated: { widgets: ["shot_target", "prompt", "meta"], linkInputs: ["images"], outputs: [] },
  UNETLoader: { widgets: ["unet_name", "weight_dtype"], linkInputs: [], outputs: [["MODEL", "MODEL"]] },
  LoraLoaderModelOnly: { widgets: ["lora_name", "strength_model"], linkInputs: ["model"], outputs: [["lora", "MODEL"]] },
  CLIPLoader: { widgets: ["clip_name", "type", "device"], linkInputs: [], outputs: [["CLIP", "CLIP"]] },
  VAELoader: { widgets: ["vae_name"], linkInputs: [], outputs: [["VAE", "VAE"]] },
  CLIPTextEncode: { widgets: ["text"], linkInputs: ["clip"], outputs: [["CONDITIONING", "CONDITIONING"]] },
  ConditioningZeroOut: { widgets: [], linkInputs: ["conditioning"], outputs: [["CONDITIONING", "CONDITIONING"]] },
  EmptyLatentImage: { widgets: ["width", "height", "batch_size"], linkInputs: [], outputs: [["LATENT", "LATENT"]] },
  EmptySD3LatentImage: { widgets: ["width", "height", "batch_size"], linkInputs: [], outputs: [["LATENT", "LATENT"]] },
  KSampler: { widgets: ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"], linkInputs: ["model", "positive", "negative", "latent_image"], outputs: [["LATENT", "LATENT"]] },
  VAEDecode: { widgets: [], linkInputs: ["samples", "vae"], outputs: [["IMAGE", "IMAGE"]] },
  VAEEncode: { widgets: [], linkInputs: ["pixels", "vae"], outputs: [["LATENT", "LATENT"]] },
  SaveImage: { widgets: ["filename_prefix"], linkInputs: ["images"], outputs: [] },
  LoadImage: { widgets: ["image", "upload"], linkInputs: [], outputs: [["IMAGE", "IMAGE"], ["MASK", "MASK"]] },
  ImageScaleToTotalPixels: { widgets: ["upscale_method", "megapixels", "resolution_steps"], linkInputs: ["image"], outputs: [["IMAGE", "IMAGE"]] },
  "GetImageSize+": { widgets: [], linkInputs: ["image"], outputs: [["width", "INT"], ["height", "INT"]] },
  Krea2EditGroundedEncode: { widgets: ["prompt", "grounding_px", "system_prompt"], linkInputs: ["clip", "image", "image_b"], outputs: [["CONDITIONING", "CONDITIONING"]] },
  Krea2EditModelPatch: {
    widgets: ["ref_boost", "ref_boost_a", "fit_mode"],
    linkInputs: ["model", "source_latent", "vae", "source_image", "source_latent_b", "source_image_b", "target_latent"],
    outputs: [["MODEL", "MODEL"]],
  },
};

/** 模板 JSON 形状(engines/image_engine/workflows/*.json,schemaVersion 1) */
interface K2Template {
  name: string;
  inputs: Record<string, { node: string; field: string; class_type?: string; slot?: number }[] | { node: string; field: string; class_type?: string }>;
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
}

const TEMPLATES: Record<"krea2_t2i" | "krea2_edit_ref", K2Template> = {
  "krea2_t2i": krea2T2i as unknown as K2Template,
  "krea2_edit_ref": krea2EditRef as unknown as K2Template,
};

/** 单值绑定或数组绑定(references)统一取形 */
function bindingOf(template: K2Template, key: string): { node: string; field: string } | null {
  const raw = template.inputs[key];
  if (!raw) return null;
  return Array.isArray(raw) ? { node: raw[0].node, field: raw[0].field } : { node: raw.node, field: raw.field };
}

function referenceBindings(template: K2Template): Array<{ node: string; field: string; slot?: number }> {
  const raw = template.inputs.references;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** 确定性占位文件名(bridge 上传后同名替换;hash 防撞) */
export function referencePlaceholder(index: number, sourceUrl: string): string {
  let hash = 5381;
  for (let i = 0; i < sourceUrl.length; i += 1) {
    hash = ((hash << 5) + hash + sourceUrl.charCodeAt(i)) >>> 0;
  }
  return `manying-ref-${index + 1}-${hash.toString(16).padStart(8, "0")}.png`;
}

/** ── 迁移计划:老图 → 成图块(每块=prompt+refs+模板簇+回写终端) ─────── */
interface GeneratedBlock {
  generated: ImageWorkflowGeneratedNode;
  prompt: ImageWorkflowPromptNode | null;
  references: ImageWorkflowReferenceNode[];
}

export interface MigrationPlan {
  blocks: GeneratedBlock[];
  skipped: Array<{ type: string; ids: string[] }>;
}

function incomingEdges(edges: ImageWorkflowEdge[], targetId: string): ImageWorkflowEdge[] {
  return edges.filter((edge) => edge.target === targetId);
}

export function planMigration(graph: ImageWorkflowGraph): MigrationPlan {
  const blocks: GeneratedBlock[] = [];
  const consumed = new Set<string>();
  const generatedNodes = graph.nodes.filter((node): node is ImageWorkflowGeneratedNode => node.type === "generated");
  for (const generated of generatedNodes) {
    const incoming = incomingEdges(graph.edges, generated.id);
    const promptEdge = incoming.find((edge) => graph.nodes.some((n) => n.id === edge.source && n.type === "prompt"));
    const prompt = promptEdge
      ? (graph.nodes.find((n) => n.id === promptEdge.source) as ImageWorkflowPromptNode | undefined) ?? null
      : null;
    if (prompt) consumed.add(prompt.id);
    const references = incoming
      .filter((edge) => graph.nodes.some((n) => n.id === edge.source && n.type === "reference"))
      .map((edge) => graph.nodes.find((n) => n.id === edge.source) as ImageWorkflowReferenceNode)
      .filter(Boolean);
    references.forEach((reference) => consumed.add(reference.id));
    blocks.push({ generated, prompt, references });
  }
  const skippedTypes = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (consumed.has(node.id) || node.type === "generated") continue;
    const ids = skippedTypes.get(node.type) ?? [];
    ids.push(node.id);
    skippedTypes.set(node.type, ids);
  }
  return { blocks, skipped: [...skippedTypes].map(([type, ids]) => ({ type, ids })) };
}

/** ── 公共:块 → 模板选择+注入值 ───────────────────────────────── */
interface BlockValues {
  templateKey: "krea2_t2i" | "krea2_edit_ref";
  positive: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  referenceNames: string[];
  shotTarget: string;
}

function blockValues(block: GeneratedBlock, graph: ImageWorkflowGraph): BlockValues {
  const generated = block.generated;
  const promptText = block.prompt?.prompt ?? generated.prompt ?? "";
  const negative = block.prompt?.negativePrompt ?? generated.negativePrompt ?? "";
  const [width, height] = ASPECT_RATIOS[generated.aspectRatio] ?? ASPECT_RATIOS["1:1"];
  const references = block.references.slice(0, 2); // 模板双参考槽上限,超出截断(报告记)
  return {
    templateKey: references.length > 0 ? "krea2_edit_ref" : "krea2_t2i",
    positive: promptText,
    negative,
    width,
    height,
    steps: DEFAULT_STEPS,
    referenceNames: references.map((reference, index) => referencePlaceholder(index, reference.imageUrl)),
    shotTarget: graph.target.kind === "storyboard" && graph.target.id ? graph.target.id : "",
  };
}

export interface ComfyWorkflowExportResult {
  /** UI 格式(nodes/links,原生前端「载入」) */
  ui: Record<string, unknown>;
  /** API 格式(节点ID→{class_type,inputs},/prompt 直提交) */
  api: Record<string, unknown>;
  report: {
    mapped: Record<string, number>;
    skipped: Array<{ type: string; count: number }>;
    notes: string[];
  };
}

/** edit_ref 单参考时裁掉第二参考链(镜像 comfyui_bridge.instantiate_template) */
function pruneSingleReference(graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>, templateName: string): void {
  if (templateName !== "krea2_edit_ref") return;
  for (const nodeId of ["46", "52", "53"]) delete graph[nodeId];
  for (const nodeId of ["34", "36"]) {
    const node = graph[nodeId];
    if (node) delete node.inputs.image_b;
  }
  const patch = graph["35"];
  if (patch) {
    delete patch.inputs.source_latent_b;
    delete patch.inputs.source_image_b;
  }
}

type ApiGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** ── API 格式:模板克隆+注入+ManyingPrompt/ManyingGenerated 改接 ── */
function buildApiBlock(values: BlockValues): { api: ApiGraph; linkTargets: { positive: [string, string]; negative: [string, string] }; decodeNode: string } {
  const template = TEMPLATES[values.templateKey];
  const graph: ApiGraph = JSON.parse(JSON.stringify(template.graph));
  if (values.referenceNames.length < 2) pruneSingleReference(graph, template.name);
  const set = (key: string, value: unknown) => {
    const binding = bindingOf(template, key);
    if (binding && graph[binding.node]) graph[binding.node].inputs[binding.field] = value;
  };
  set("steps", values.steps);
  set("width", values.width);
  set("height", values.height);
  for (const [index, binding] of referenceBindings(template).entries()) {
    const name = values.referenceNames[index];
    if (name && graph[binding.node]) graph[binding.node].inputs[binding.field] = name;
  }
  // SaveImage → ManyingGenerated(吃 VAEDecode 输出)
  let decodeNode = "";
  let decodeSlot = 0;
  for (const [nodeId, node] of Object.entries(graph)) {
    if (node.class_type === "SaveImage") {
      const source = node.inputs.images;
      if (Array.isArray(source)) {
        decodeNode = String(source[0]);
        decodeSlot = Number(source[1]) || 0;
      }
      delete graph[nodeId];
    }
  }
  graph["manying_generated"] = {
    class_type: "ManyingGenerated",
    inputs: {
      images: [decodeNode || "29", decodeSlot],
      shot_target: values.shotTarget,
      prompt: values.positive,
      meta: JSON.stringify({ migratedFrom: "image-workflow", aspect: `${values.width}x${values.height}`, references: values.referenceNames }),
    },
  };
  // ManyingPrompt:绑定口改接字符串链(正/负)
  const promptBinding = bindingOf(template, "prompt");
  const negativeBinding = bindingOf(template, "negative_prompt");
  graph["manying_prompt"] = { class_type: "ManyingPrompt", inputs: { positive: values.positive, negative: values.negative } };
  if (promptBinding && graph[promptBinding.node]) graph[promptBinding.node].inputs[promptBinding.field] = ["manying_prompt", 0];
  if (negativeBinding && graph[negativeBinding.node]) graph[negativeBinding.node].inputs[negativeBinding.field] = ["manying_prompt", 1];
  return {
    api: graph,
    linkTargets: {
      positive: promptBinding ? [promptBinding.node, promptBinding.field] : ["", ""],
      negative: negativeBinding ? [negativeBinding.node, negativeBinding.field] : ["", ""],
    },
    decodeNode,
  };
}

/** ── UI 格式 ─────────────────────────────────────────────────── */
interface UiNode {
  id: number;
  type: string;
  pos: [number, number];
  flags: Record<string, unknown>;
  order: number;
  mode: number;
  inputs: Array<{ name: string; type: string; link: number | null }>;
  outputs: Array<{ name: string; type: string; links: number[] | null; slot_index?: number }>;
  properties: Record<string, unknown>;
  widgets_values: unknown[];
}

type UiLink = [number, number, number, number, number, string];

function buildUiBlock(values: BlockValues, offsetX: number): { nodes: UiNode[]; links: UiLink[] } {
  const template = TEMPLATES[values.templateKey];
  const apiGraph: ApiGraph = JSON.parse(JSON.stringify(template.graph));
  if (values.referenceNames.length < 2) pruneSingleReference(apiGraph, template.name);
  const set = (key: string, value: unknown) => {
    const binding = bindingOf(template, key);
    if (binding && apiGraph[binding.node]) apiGraph[binding.node].inputs[binding.field] = value;
  };
  set("steps", values.steps);
  set("width", values.width);
  set("height", values.height);
  for (const [index, binding] of referenceBindings(template).entries()) {
    const name = values.referenceNames[index];
    if (name && apiGraph[binding.node]) apiGraph[binding.node].inputs[binding.field] = name;
  }
  const promptBinding = bindingOf(template, "prompt");
  const negativeBinding = bindingOf(template, "negative_prompt");
  if (promptBinding && apiGraph[promptBinding.node]) delete apiGraph[promptBinding.node].inputs[promptBinding.field];
  if (negativeBinding && apiGraph[negativeBinding.node]) delete apiGraph[negativeBinding.node].inputs[negativeBinding.field];

  const nodes: UiNode[] = [];
  const links: UiLink[] = [];
  let nextNodeId = 1;
  let nextLinkId = 1;
  const idOf = new Map<string, number>();
  const clusterOrder = Object.keys(template.graph);
  for (const templateId of clusterOrder) {
    idOf.set(templateId, nextNodeId);
    nextNodeId += 1;
  }
  const promptId = nextNodeId++;
  const generatedId = nextNodeId++;

  // 模板簇节点(宽 320 逐个纵排)
  clusterOrder.forEach((templateId, index) => {
    const source = apiGraph[templateId];
    // SaveImage 不发射:其输入链由 ManyingGenerated 的链取代(否则孤儿链)
    if (!source || source.class_type === "SaveImage") return;
    const spec = NODE_SPEC[source.class_type];
    if (!spec) throw new Error(`迁移器缺节点规格:${source.class_type}(先更新 NODE_SPEC)`);
    const boundEmpty =
      (promptBinding && templateId === promptBinding.node && promptBinding.field) ||
      (negativeBinding && templateId === negativeBinding.node && negativeBinding.field) ||
      "";
    const widgets = spec.widgets.map((widget) => (widget === boundEmpty ? "" : source.inputs[widget]));
    const inputs = spec.linkInputs.map((input) => {
      const value = source.inputs[input];
      if (Array.isArray(value)) {
        const fromId = idOf.get(String(value[0]));
        const fromSpec = NODE_SPEC[sourceOf(apiGraph, String(value[0])).class_type];
        const slot = Number(value[1]) || 0;
        const type = fromSpec?.outputs[slot]?.[1] ?? "IMAGE";
        const linkId = nextLinkId++;
        links.push([linkId, fromId ?? 0, slot, idOf.get(templateId) ?? 0, spec.linkInputs.indexOf(input), type]);
        return { name: input, type, link: linkId };
      }
      return { name: input, type: "IMAGE", link: null };
    });
    const outputs = spec.outputs.map(([name, type], slot) => ({ name, type, links: [], slot_index: slot }));
    nodes.push({
      id: idOf.get(templateId) ?? 0,
      type: source.class_type,
      pos: [offsetX + 700, 40 + index * 150],
      flags: {},
      order: idOf.get(templateId) ?? 0,
      mode: 0,
      inputs,
      outputs,
      properties: { "Node name for S&R": source.class_type },
      widgets_values: widgets,
    });
  });

  // ManyingPrompt → 正/负绑定口
  // 绑定口可能是 widget(t2i 的 Encode.text/edit 的 GroundedEncode.prompt):
  // 接 STRING 链=converted widget 语义(槽追加进 inputs[],widget 值从
  // widgets_values 删除)——ComfyUI 拖线到文本 widget 的原生等价物。
  const wireString = (targetNode: number, targetInput: string, promptSlot: number) => {
    const target = nodes.find((node) => node.id === targetNode);
    if (!target) return;
    const spec = NODE_SPEC[target.type];
    const linkId = nextLinkId++;
    let slotIndex = spec.linkInputs.indexOf(targetInput);
    if (slotIndex === -1) {
      slotIndex = target.inputs.length;
      target.inputs.push({ name: targetInput, type: "STRING", link: linkId });
      const widgetIndex = spec.widgets.indexOf(targetInput);
      if (widgetIndex >= 0) target.widgets_values.splice(widgetIndex, 1);
    } else {
      target.inputs[slotIndex] = { name: targetInput, type: "STRING", link: linkId };
    }
    links.push([linkId, promptId, promptSlot, targetNode, slotIndex, "STRING"]);
  };
  nodes.push({
    id: promptId, type: "ManyingPrompt", pos: [offsetX + 360, 40], flags: {}, order: promptId, mode: 0,
    inputs: [], outputs: NODE_SPEC.ManyingPrompt.outputs.map(([name, type], slot) => ({ name, type, links: [], slot_index: slot })),
    properties: { "Node name for S&R": "ManyingPrompt" },
    widgets_values: [values.positive, values.negative],
  });
  if (promptBinding && idOf.get(promptBinding.node)) wireString(idOf.get(promptBinding.node)!, promptBinding.field, 0);
  if (negativeBinding && idOf.get(negativeBinding.node)) wireString(idOf.get(negativeBinding.node)!, negativeBinding.field, 1);

  // ManyingGenerated ← VAEDecode(模板 SaveImage 的上游)
  const saveTemplateId = clusterOrder.find((id) => template.graph[id].class_type === "SaveImage");
  const saveInputs = saveTemplateId ? (template.graph[saveTemplateId].inputs as Record<string, unknown>) : {};
  const decodeSource = Array.isArray(saveInputs.images) ? saveInputs.images : [];
  const decodeId = decodeSource.length ? idOf.get(String(decodeSource[0])) ?? undefined : undefined;
  const generatedLink = nextLinkId++;
  links.push([generatedLink, decodeId ?? 0, 0, generatedId, 0, "IMAGE"]);
  nodes.push({
    id: generatedId, type: "ManyingGenerated", pos: [offsetX + 1360, 40], flags: {}, order: generatedId, mode: 0,
    inputs: [{ name: "images", type: "IMAGE", link: generatedLink }],
    outputs: [],
    properties: { "Node name for S&R": "ManyingGenerated" },
    widgets_values: [values.shotTarget, values.positive, JSON.stringify({ migratedFrom: "image-workflow" })],
  });
  return { nodes, links };
}

function sourceOf(graph: ApiGraph, nodeId: string): { class_type: string } {
  return graph[nodeId] ?? { class_type: "UNKNOWN" };
}

/** ── 主入口:老图 → 双格式 + 报告 ─────────────────────────────── */
export function exportImageWorkflowToComfy(graph: ImageWorkflowGraph): ComfyWorkflowExportResult {
  const plan = planMigration(graph);
  const api: Record<string, unknown> = {};
  const uiNodes: UiNode[] = [];
  const uiLinks: UiLink[] = [];
  const notes: string[] = [];
  const mapped: Record<string, number> = {};
  plan.blocks.forEach((block, index) => {
    const values = blockValues(block, graph);
    if (block.references.length > 2) {
      notes.push(`块${index + 1}:参考图 ${block.references.length} 张超模板双槽,截为前 2 张(其余可后续手接)`);
    }
    if (!block.prompt) notes.push(`块${index + 1}:无连线提示词节点,回落成图节点内嵌 prompt`);
    if (values.templateKey === "krea2_edit_ref") {
      notes.push(`块${index + 1}:编辑流需要生态插件(Krea2 指令编辑节点+Essentials),未装时引擎体检会指路`);
    }
    notes.push(`块${index + 1}:参考图占位名 ${values.referenceNames.join(", ") || "(无)"}——bridge 上传真图后同名替换`);
    const apiBlock = buildApiBlock(values);
    // 块前缀+内部链引用全量重映射(漏映射=引擎 validate 找不到上游节点)
    const prefix = `b${index + 1}_`;
    for (const [nodeId, node] of Object.entries(apiBlock.api)) api[prefix + nodeId] = node;
    for (const node of Object.values(apiBlock.api)) {
      for (const [key, value] of Object.entries(node.inputs)) {
        if (Array.isArray(value)) node.inputs[key] = [prefix + String(value[0]), value[1]];
      }
    }
    const uiBlock = buildUiBlock(values, index * 2100);
    uiNodes.push(...uiBlock.nodes);
    uiLinks.push(...uiBlock.links);
    mapped.prompt = (mapped.prompt ?? 0) + (block.prompt ? 1 : 0);
    mapped.reference = (mapped.reference ?? 0) + Math.min(block.references.length, 2);
    mapped.generated = (mapped.generated ?? 0) + 1;
  });
  notes.push("seed 未迁移(存量图未存种子,运行时随机/手填);布局为生成式四列,原画布坐标不保留");
  return {
    ui: {
      last_node_id: uiNodes.reduce((max, node) => Math.max(max, node.id), 0),
      last_link_id: uiLinks.reduce((max, link) => Math.max(max, link[0]), 0),
      nodes: uiNodes,
      links: uiLinks,
      groups: [],
      config: {},
      extra: {},
      version: 0.4,
    },
    api,
    report: {
      mapped,
      skipped: plan.skipped.map(({ type, ids }) => ({ type, count: ids.length })),
      notes,
    },
  };
}
