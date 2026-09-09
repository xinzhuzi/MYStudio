// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ComfyUI 工作流导入分析器(09-08 二期,纯函数、夹具驱动)。
 *
 * 吃 API 格式 workflow JSON({nodeId:{class_type,inputs:{k: v | [srcId,slot]}}}),
 * 做三件事:
 * 1. 边界口分析——inputs 值为数组=内部连线(不外露),原始值=widget 参数;
 *    STRING 型 widget(无内部来源)→候选 prompt-text 口;LoadImage 类节点
 *    (或 IMAGE 型输入且无来源)→图口。产出 descriptor 供注册接线
 *    (流C合流后 descriptor→节点注册表;本模块零画布依赖)。
 * 2. widget 清单——INT/FLOAT/COMBO/STRING/BOOLEAN 五类(值形状推断;
 *    /object_info 摘要可作可选注入升级 STRING→COMBO / 补 range/options)。
 * 3. 缺插件检测——classTypesUsed 对照 availableClassTypes(来自
 *    /comfy/engine 的 object_info 摘要),检测函数独立纯化可测。
 *
 * License 边界(父任务裁定 3):workflow JSON 是数据,分析只读不改动,
 * 不拷贝任何 ComfyUI 代码。
 */

/** API 格式节点(inputs 值=widget 原始值;数组 [srcId, slot]=内部连线) */
export interface ComfyApiWorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

/** API 格式工作流(nodeId → 节点定义) */
export type ComfyApiWorkflow = Record<string, ComfyApiWorkflowNode>;

/** 边界口类型:提示词文本口(prompt-text)/图口(image) */
export type ComfyWorkflowPortType = "prompt-text" | "image";

/** 边界口描述符:导入成节点卡后外露的口(注册接线由集成者落地) */
export interface ComfyWorkflowPortDescriptor {
  /** 稳定标识:`${nodeId}.${inputKey}`(接线后可作 targetHandle) */
  id: string;
  type: ComfyWorkflowPortType;
  /** 中文大白话标签(大白话裁定:不露英文 class_type) */
  label: string;
  nodeId: string;
  inputKey: string;
  /** 提示词口极性:由输出连线走向(KSampler.positive/negative)推断;未知省略 */
  polarity?: "positive" | "negative";
}

/** widget 参数类型(照 /object_info 五类控件口径) */
export type ComfyWidgetType = "INT" | "FLOAT" | "COMBO" | "STRING" | "BOOLEAN";

/** 内部 widget 描述符:全收进节点编辑器「高级参数」折叠区,默认值不动即可跑 */
export interface ComfyWorkflowWidgetDescriptor {
  id: string;
  type: ComfyWidgetType;
  label: string;
  /** 工作流现值(执行时不动它就能跑) */
  default: number | string | boolean;
  /** 数值范围(object_info 注入时补全;未注入省略) */
  range?: { min: number; max: number; step?: number };
  /** COMBO 选项(object_info 注入时补全;未注入省略) */
  options?: string[];
  nodeId: string;
  inputKey: string;
}

/** 工作流分析产物:节点定义描述符(注册接线的唯一输入) */
export interface ComfyWorkflowDescriptor {
  ports: ComfyWorkflowPortDescriptor[];
  widgets: ComfyWorkflowWidgetDescriptor[];
  /** 工作流用到的全部 class_type(去重、排序;缺插件检测的输入) */
  classTypesUsed: string[];
  nodeCount: number;
  /** 缺失 class_type(仅 analyzeComfyWorkflow 传 availableClassTypes 时计算) */
  missing: string[];
  /** 载荷格式(09-09 阶段2:迁移器产 UI 格式入库;api=传统 API 图)。
   * UI 格式=降级描述符:classTypes/nodeCount 齐备(缺插件检测/列表计数用),
   * ports/widgets 留空——「导入成节点卡」面后续按需补 UI 提取。 */
  format?: "api" | "ui";
}

/** object_info 摘要(可选注入):按 class_type 提供输入 schema,升级 widget 类型 */
export interface ComfyObjectInfoHint {
  /** 输入 key → 类型(INT/FLOAT/COMBO/STRING/BOOLEAN) */
  inputs?: Record<string, string>;
  /** COMBO 输入 key → 选项表 */
  combos?: Record<string, string[]>;
  /** 数值输入 key → 范围 */
  ranges?: Record<string, { min: number; max: number; step?: number }>;
}

export type ComfyWorkflowAnalyzeResult =
  | { ok: true; descriptor: ComfyWorkflowDescriptor }
  | { ok: false; error: string };

/** 文本类输入 key(STRING widget → 候选 prompt-text 口)。
 *  system_prompt 不在其中:照 09-07 口语义终裁,system_prompt 回归节点
 *  编辑器字段,不占输入口。 */
const TEXT_INPUT_KEYS = new Set([
  "text",
  "prompt",
  "positive",
  "negative",
  "caption",
  "string",
  "text_a",
  "text_b",
]);

/** 图片类输入 key(IMAGE 型输入且无来源 → 图口) */
const IMAGE_INPUT_KEYS = new Set([
  "image",
  "image_a",
  "image_b",
  "images",
  "pixels",
  "output_image",
  "mask",
]);

/** API 格式里的隐藏/控制字段(不是 widget,不进清单) */
const HIDDEN_INPUT_KEYS = new Set(["extra_pnginfo", "unique_id"]);

/** 已知枚举型输入 key(值形状是字符串,但语义是下拉选择 → COMBO)。
 *  options 不猜(版本相关),object_info 注入时补全。 */
const KNOWN_COMBO_KEYS = new Set([
  "sampler_name",
  "scheduler",
  "upscale_method",
  "weight_dtype",
  "device",
  "fit_mode",
]);

/** widget 中文标签表(大白话裁定;未命中回落英文 key,进 tooltip 不进正文) */
const WIDGET_LABELS: Record<string, string> = {
  seed: "随机种子",
  steps: "步数",
  cfg: "提示词强度",
  width: "宽度",
  height: "高度",
  batch_size: "每批数量",
  sampler_name: "采样器",
  scheduler: "调度器",
  denoise: "重绘幅度",
  filename_prefix: "文件名前缀",
  megapixels: "目标百万像素",
  resolution_steps: "分辨率步进",
  grounding_px: "定位像素",
  ref_boost: "参考增强",
  ref_boost_a: "参考增强A",
  ref_boost_b: "参考增强B",
  multiplier: "倍率",
  per_layer_weights: "分层权重",
  strength_model: "模型强度",
  unet_name: "模型文件",
  clip_name: "文本编码器",
  vae_name: "VAE文件",
  lora_name: "LoRA文件",
  image: "图片文件",
  upscale_method: "放大算法",
  weight_dtype: "精度",
  type: "类型",
  device: "设备",
  fit_mode: "适配模式",
  system_prompt: "系统提示词",
  text: "文本",
  prompt: "提示词",
};

function widgetLabel(inputKey: string): string {
  return WIDGET_LABELS[inputKey] ?? inputKey;
}

/** inputs 值 → widget 类型(值形状推断,object_info 未注入时的基线) */
function inferWidgetType(
  value: unknown,
  inputKey: string,
  hint?: ComfyObjectInfoHint,
): ComfyWidgetType | null {
  if (hint?.inputs?.[inputKey]) {
    const hinted = hint.inputs[inputKey];
    if (hinted === "INT" || hinted === "FLOAT" || hinted === "COMBO" || hinted === "STRING" || hinted === "BOOLEAN") {
      return hinted;
    }
  }
  if (KNOWN_COMBO_KEYS.has(inputKey)) return "COMBO";
  if (typeof value === "number") return Number.isInteger(value) ? "INT" : "FLOAT";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "string") return "STRING";
  return null;
}

/** 值校验:widget 默认值只收原始类型(对象/数组外的连线索材不算) */
function isLinkValue(value: unknown): value is [string, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number"
  );
}

/**
 * 缺插件检测(独立纯化,可测):classTypesUsed 对照 availableClassTypes。
 * availableClassTypes 来自 /comfy/engine 的 object_info 摘要(类名集合)。
 */
export function detectMissingClassTypes(
  classTypesUsed: readonly string[],
  availableClassTypes: Iterable<string>,
): string[] {
  const available = availableClassTypes instanceof Set
    ? availableClassTypes
    : new Set(availableClassTypes);
  return [...new Set(classTypesUsed)]
    .filter((classType) => !available.has(classType))
    .sort();
}

/**
 * 边界口分析主函数(纯函数)。
 *
 * @param workflow API 格式工作流(或本仓库桥模板的 `{schemaVersion, graph}` 包装)
 * @param options.availableClassTypes 可选,object_info 类名集合(给了就顺带算 missing)
 * @param options.objectInfoByClassType 可选,class_type → 输入 schema 摘要(升级 widget)
 */
export function analyzeComfyWorkflow(
  workflow: unknown,
  options?: {
    availableClassTypes?: Iterable<string>;
    objectInfoByClassType?: Record<string, ComfyObjectInfoHint>;
  },
): ComfyWorkflowAnalyzeResult {
  // UI 格式(画布格式)分支(09-09 阶段2):迁移器/原生前端导出的 nodes/links
  // 载荷——降级描述符(classTypes+nodeCount),端口/挂件提取留后续。
  if (workflow && typeof workflow === "object" && !Array.isArray(workflow)) {
    const record = workflow as Record<string, unknown>;
    if (Array.isArray(record.nodes) && record.nodes.length > 0
      && record.nodes.every((node) => node && typeof node === "object" && typeof (node as { type?: unknown }).type === "string")) {
      const nodes = record.nodes as Array<{ type: string }>;
      const classTypes = [...new Set(nodes.map((node) => node.type))].sort();
      const available = options?.availableClassTypes ? new Set(options.availableClassTypes) : null;
      const missing = available ? classTypes.filter((cls) => !available.has(cls)) : [];
      return {
        ok: true,
        descriptor: { ports: [], widgets: [], classTypesUsed: classTypes, nodeCount: nodes.length, missing, format: "ui" },
      };
    }
  }

  const unwrapped = unwrapComfyApiGraph(workflow);
  if (!unwrapped.ok) return { ok: false, error: unwrapped.error };
  const graph = unwrapped.graph;

  const ports: ComfyWorkflowPortDescriptor[] = [];
  const widgets: ComfyWorkflowWidgetDescriptor[] = [];
  const classTypes = new Set<string>();
  /** 极性推断表:nodeId → positive/negative(输出连线走向 KSampler 的哪个口) */
  const polarityByNode = new Map<string, "positive" | "negative">();

  // 第一遍:收 class_type + 极性(src 节点的输出被谁、以什么身份消费)
  for (const [nodeId, node] of Object.entries(graph)) {
    if (!node || typeof node !== "object" || typeof node.class_type !== "string") {
      return { ok: false, error: `节点 ${nodeId} 缺少 class_type` };
    }
    classTypes.add(node.class_type);
    for (const [inputKey, value] of Object.entries(node.inputs ?? {})) {
      if (!isLinkValue(value)) continue;
      const [sourceId] = value;
      if (inputKey === "positive" || inputKey === "positive_cond") {
        polarityByNode.set(sourceId, "positive");
      } else if (inputKey === "negative" || inputKey === "negative_cond") {
        polarityByNode.set(sourceId, "negative");
      }
    }
  }

  // 第二遍:边界口 + widget 清单(迭代顺序=JSON 键序,产物确定性)
  let imagePortIndex = 0;
  for (const [nodeId, node] of Object.entries(graph)) {
    const hint = options?.objectInfoByClassType?.[node.class_type];
    const isLoadImage = node.class_type === "LoadImage";
    for (const [inputKey, value] of Object.entries(node.inputs ?? {})) {
      if (HIDDEN_INPUT_KEYS.has(inputKey)) continue;
      if (isLinkValue(value)) continue; // 内部连线,不外露
      const type = inferWidgetType(value, inputKey, hint);
      if (!type) continue;

      // 图口:LoadImage 节点本身,或 IMAGE 型输入且无来源(原始值占位)
      if (isLoadImage || (IMAGE_INPUT_KEYS.has(inputKey) && typeof value === "string")) {
        imagePortIndex += 1;
        ports.push({
          id: `${nodeId}.${inputKey}`,
          type: "image",
          label: `参考图 ${imagePortIndex}`,
          nodeId,
          inputKey,
        });
        // LoadImage 的 image 字段本质是"选文件"widget,同时收进高级参数
        widgets.push({
          id: `${nodeId}.${inputKey}`,
          type,
          label: widgetLabel(inputKey),
          default: value as string,
          nodeId,
          inputKey,
        });
        continue;
      }

      // 提示词口:STRING 型 widget(无内部来源)且 key 是文本类
      if (type === "STRING" && TEXT_INPUT_KEYS.has(inputKey)) {
        const polarity = polarityByNode.get(nodeId);
        ports.push({
          id: `${nodeId}.${inputKey}`,
          type: "prompt-text",
          label: polarity === "positive" ? "正向提示词" : polarity === "negative" ? "负向提示词" : "提示词",
          nodeId,
          inputKey,
          ...(polarity ? { polarity } : {}),
        });
        continue;
      }

      widgets.push({
        id: `${nodeId}.${inputKey}`,
        type,
        label: widgetLabel(inputKey),
        default: value as number | string | boolean,
        ...(hint?.combos?.[inputKey] && type === "COMBO" ? { options: hint.combos[inputKey] } : {}),
        ...(hint?.ranges?.[inputKey] && (type === "INT" || type === "FLOAT")
          ? { range: hint.ranges[inputKey] }
          : {}),
        nodeId,
        inputKey,
      });
    }
  }

  const classTypesUsed = [...classTypes].sort();
  return {
    ok: true,
    descriptor: {
      ports,
      widgets,
      classTypesUsed,
      nodeCount: Object.keys(graph).length,
      missing: options?.availableClassTypes
        ? detectMissingClassTypes(classTypesUsed, options.availableClassTypes)
        : [],
    },
  };
}

export type ComfyApiGraphUnwrapResult =
  | { ok: true; graph: ComfyApiWorkflow }
  | { ok: false; error: string };

/**
 * 归一化输入:裸 API 格式直接过;本仓库桥模板 `{schemaVersion, graph}` 包装
 * 取 graph;ComfyUI 画布 UI 格式(nodes/links 数组)明确拦截并指路——
 * UI 格式需先在 ComfyUI 里导出 API 格式(转换策略待事实核验,先不静默猜)。
 */
export function unwrapComfyApiGraph(workflow: unknown): ComfyApiGraphUnwrapResult {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    return { ok: false, error: "不是有效的工作流 JSON 对象" };
  }
  const record = workflow as Record<string, unknown>;
  // UI 格式识别:nodes 数组 + 每项带 type/pos(画布格式),或带 links 数组
  if (Array.isArray(record.nodes)) {
    return {
      ok: false,
      error: "这是 ComfyUI 画布格式(UI 格式),暂不支持直接导入:请在 ComfyUI 里用「导出(API 格式)」另存后再选",
    };
  }
  let graph: unknown = record;
  // 桥模板包装:取 graph 字段
  if (record.graph && typeof record.graph === "object" && !Array.isArray(record.graph)) {
    graph = record.graph;
  }
  const entries = graph as Record<string, unknown>;
  let sawNode = false;
  for (const node of Object.values(entries)) {
    if (!node || typeof node !== "object") continue;
    const candidate = node as { class_type?: unknown };
    if (typeof candidate.class_type === "string") {
      sawNode = true;
    } else {
      return { ok: false, error: "不是 API 格式工作流(节点缺少 class_type)" };
    }
  }
  if (!sawNode) return { ok: false, error: "工作流里没有节点" };
  return { ok: true, graph: entries as ComfyApiWorkflow };
}

/** 文件文本 → 分析(导入弹窗预览用:JSON 解析错误也归一成大白话 error) */
export function analyzeComfyWorkflowText(
  text: string,
  options?: {
    availableClassTypes?: Iterable<string>;
    objectInfoByClassType?: Record<string, ComfyObjectInfoHint>;
  },
): ComfyWorkflowAnalyzeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "文件不是有效 JSON" };
  }
  return analyzeComfyWorkflow(parsed, options);
}

/** 缺失插件的大白话指路文案(照非 Krea2 引擎阻断文案模式,不静默降级) */
export function formatMissingClassTypesMessage(missing: readonly string[]): string {
  if (missing.length === 0) return "";
  return `缺 ${missing.length} 个节点类型(${missing.join("、")}):先到「设置 → 本地配置 → ComfyUI 引擎」装好对应插件再导入`;
}
