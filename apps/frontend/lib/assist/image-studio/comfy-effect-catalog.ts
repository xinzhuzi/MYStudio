// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 效果节点目录(09-08 三期收官,流X):
 * - 策展效果包(prd 裁定 6 默认层):内置 10 个常用 classType 的中文映射+端口/
 *   widget 配方(手写快照,零引擎依赖——高级开关关着的普通用户直接可用);
 * - object_info 单类条目 → 通用节点 descriptor 解析器(高级层全量直放);
 * - 搜索过滤(策展按中文名/关键词;高级层按英文 classType 前缀/包含)。
 * License 边界:object_info 是引擎运行时数据(数据非代码),解析器为自研。
 */

import type { ImageWorkflowComfyPortSnapshot, ImageWorkflowComfyWidgetSnapshot } from "@/types/studio";

/** 通用节点 descriptor(与 types 侧快照结构同形;structurally compatible
 *  with components/ui/comfy 的 ComfyGenericPortDef / ComfyWidgetSchema) */
export interface ComfyEffectNodeDescriptor {
  ports: ImageWorkflowComfyPortSnapshot[];
  widgets: ImageWorkflowComfyWidgetSnapshot[];
}

/** 策展效果条目(默认层;license=核心 ComfyUI 自带即引擎侧自洽) */
export interface ComfyCuratedEffectEntry {
  classType: string;
  /** 中文名(大白话层标题) */
  zhName: string;
  /** 一句话说明 */
  description: string;
  /** 搜索关键词(中文) */
  keywords: string[];
  descriptor: ComfyEffectNodeDescriptor;
}

// ── 策展效果包(10 个;全部 ComfyUI 核心 IMAGE→IMAGE 节点,开箱即用) ──

export const CURATED_COMFY_EFFECTS: readonly ComfyCuratedEffectEntry[] = [
  {
    classType: "ImageScaleToTotalPixels",
    zhName: "调整图片大小",
    description: "按目标百万像素缩放图片(保持比例)",
    keywords: ["缩放", "尺寸", "大小", "分辨率"],
    descriptor: {
      ports: [
        { id: "image", label: "图片", type: "IMAGE", side: "input" },
        { id: "0", label: "缩放后图片", type: "IMAGE", side: "output" },
      ],
      widgets: [
        { id: "upscale_method", label: "upscale_method", zhLabel: "缩放算法", type: "COMBO", default: "lanczos", options: ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"] },
        { id: "megapixels", label: "megapixels", zhLabel: "目标百万像素", type: "FLOAT", default: 1, min: 0.25, max: 128, step: 0.25 },
      ],
    },
  },
  {
    classType: "ImageScaleBy",
    zhName: "按倍率缩放",
    description: "按倍率放大/缩小图片(1.0=不变)",
    keywords: ["缩放", "倍率", "放大", "缩小"],
    descriptor: {
      ports: [
        { id: "image", label: "图片", type: "IMAGE", side: "input" },
        { id: "0", label: "缩放后图片", type: "IMAGE", side: "output" },
      ],
      widgets: [
        { id: "upscale_method", label: "upscale_method", zhLabel: "缩放算法", type: "COMBO", default: "bilinear", options: ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"] },
        { id: "scale_by", label: "scale_by", zhLabel: "倍率", type: "FLOAT", default: 1, min: 0.01, max: 16, step: 0.05 },
      ],
    },
  },
  {
    classType: "ImageBlur",
    zhName: "模糊",
    description: "高斯模糊(半径越大越糊)",
    keywords: ["模糊", "虚化", "羽化"],
    descriptor: {
      ports: [
        { id: "image", label: "图片", type: "IMAGE", side: "input" },
        { id: "0", label: "模糊后图片", type: "IMAGE", side: "output" },
      ],
      widgets: [
        { id: "blur_radius", label: "blur_radius", zhLabel: "模糊半径", type: "INT", default: 1, min: 1, max: 128, step: 1 },
        { id: "sigma", label: "sigma", zhLabel: "强度", type: "FLOAT", default: 1, min: 0.1, max: 64, step: 0.1 },
      ],
    },
  },
  {
    classType: "ImageSharpen",
    zhName: "锐化",
    description: "增强边缘细节(数值过大会有白边)",
    keywords: ["锐化", "清晰", "细节"],
    descriptor: {
      ports: [
        { id: "image", label: "图片", type: "IMAGE", side: "input" },
        { id: "0", label: "锐化后图片", type: "IMAGE", side: "output" },
      ],
      widgets: [
        { id: "sharpen_radius", label: "sharpen_radius", zhLabel: "锐化半径", type: "INT", default: 2, min: 1, max: 32, step: 1 },
        { id: "sigma", label: "sigma", zhLabel: "强度", type: "FLOAT", default: 1, min: 0.01, max: 16, step: 0.01 },
        { id: "alpha", label: "alpha", zhLabel: "混合比例", type: "FLOAT", default: 1, min: 0, max: 4, step: 0.05 },
      ],
    },
  },
  {
    classType: "ImageInvert",
    zhName: "色彩反转",
    description: "颜色反相(负片效果)",
    keywords: ["反转", "负片", "反相"],
    descriptor: {
      ports: [
        { id: "image", label: "图片", type: "IMAGE", side: "input" },
        { id: "0", label: "反转后图片", type: "IMAGE", side: "output" },
      ],
      widgets: [],
    },
  },
  {
    classType: "ImageFlip",
    zhName: "翻转",
    description: "水平/垂直镜像翻转",
    keywords: ["翻转", "镜像", "flip"],
    descriptor: {
      ports: [
        { id: "image", label: "图片", type: "IMAGE", side: "input" },
        { id: "0", label: "翻转后图片", type: "IMAGE", side: "output" },
      ],
      widgets: [
        { id: "axis", label: "axis", zhLabel: "翻转方向", type: "COMBO", default: "horizontal", options: ["horizontal", "vertical"] },
      ],
    },
  },
  {
    classType: "ImageRotate",
    zhName: "旋转",
    description: "旋转 90/180/270 度",
    keywords: ["旋转", "转向"],
    descriptor: {
      ports: [
        { id: "image", label: "图片", type: "IMAGE", side: "input" },
        { id: "0", label: "旋转后图片", type: "IMAGE", side: "output" },
      ],
      widgets: [
        { id: "angle", label: "angle", zhLabel: "角度", type: "COMBO", default: "90", options: ["90", "180", "270"] },
      ],
    },
  },
  {
    classType: "ImageBlend",
    zhName: "图像叠加混合",
    description: "两张图按混合模式叠加(A 为主图,B 为叠加图)",
    keywords: ["混合", "叠加", "合成", "blend"],
    descriptor: {
      ports: [
        { id: "image1", label: "主图", type: "IMAGE", side: "input" },
        { id: "image2", label: "叠加图", type: "IMAGE", side: "input" },
        { id: "mask", label: "范围蒙版", type: "MASK", side: "input" },
        { id: "0", label: "混合后图片", type: "IMAGE", side: "output" },
      ],
      widgets: [
        { id: "blend_factor", label: "blend_factor", zhLabel: "混合强度", type: "FLOAT", default: 0.5, min: 0, max: 1, step: 0.01 },
        { id: "blend_mode", label: "blend_mode", zhLabel: "混合模式", type: "COMBO", default: "normal", options: ["normal", "multiply", "screen", "overlay", "soft_light"] },
      ],
    },
  },
  {
    classType: "ImageCompositeMasked",
    zhName: "按遮罩合成",
    description: "把来源图按遮版贴到目标图上(局部替换)",
    keywords: ["合成", "遮罩", "局部", "替换"],
    descriptor: {
      ports: [
        { id: "destination", label: "目标图", type: "IMAGE", side: "input" },
        { id: "source", label: "来源图", type: "IMAGE", side: "input" },
        { id: "mask", label: "遮罩", type: "MASK", side: "input" },
        { id: "0", label: "合成后图片", type: "IMAGE", side: "output" },
      ],
      widgets: [
        { id: "x", label: "x", zhLabel: "横向偏移", type: "INT", default: 0, min: -4096, max: 4096, step: 1 },
        { id: "y", label: "y", zhLabel: "纵向偏移", type: "INT", default: 0, min: -4096, max: 4096, step: 1 },
        { id: "resize_source", label: "resize_source", zhLabel: "来源图适配尺寸", type: "BOOLEAN", default: false },
      ],
    },
  },
  {
    classType: "CreateEmptyImage",
    zhName: "新建空白画布",
    description: "生成纯色画布(可作合成底图)",
    keywords: ["空白", "画布", "纯色", "底图"],
    descriptor: {
      ports: [
        { id: "0", label: "空白画布", type: "IMAGE", side: "output" },
      ],
      widgets: [
        { id: "width", label: "width", zhLabel: "宽度", type: "INT", default: 1024, min: 16, max: 16384, step: 1 },
        { id: "height", label: "height", zhLabel: "高度", type: "INT", default: 1024, min: 16, max: 16384, step: 1 },
        { id: "batch_size", label: "batch_size", zhLabel: "每批数量", type: "INT", default: 1, min: 1, max: 64, step: 1 },
        { id: "color", label: "color", zhLabel: "颜色(0=黑 255=白)", type: "INT", default: 0, min: 0, max: 255, step: 1 },
      ],
    },
  },
];

/** 策展条目搜索(中文名/关键词/英文 classType 包含匹配,大小写不敏感) */
export function searchCuratedEffects(query: string): ComfyCuratedEffectEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...CURATED_COMFY_EFFECTS];
  return CURATED_COMFY_EFFECTS.filter((entry) =>
    entry.zhName.toLowerCase().includes(needle)
    || entry.classType.toLowerCase().includes(needle)
    || entry.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
  );
}

// ── object_info 单类条目 → descriptor 解析(高级层全量直放) ──────────

const WIDGET_TYPES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN"]);

/** 类型口判定:[[TYPE]] 形状=连线口;单元素大写类型名(可带逗号组合) */
function isLinkTypeSpec(first: unknown): first is string[] {
  return (
    Array.isArray(first)
    && first.length >= 1
    && first.every((item) => typeof item === "string")
    && first.every((item) => /^[A-Z][A-Z0-9_,]*$/.test(item))
  );
}

/**
 * object_info 单类条目(经 sidecar ?class= 详情端点)→ 通用节点 descriptor。
 * input 条目形状(ComfyUI 约定):
 *   "seed": ["INT", {default/min/max…}]        → 数值/文本/开关 widget
 *   "sampler": [["euler", …]]                  → COMBO(选项表)
 *   "model": [["MODEL"]]                       → MODEL 类型连线口
 *   "any": ["CUSTOM_TYPE", {…}]                → 非五类 widget 视作连线口
 */
export function objectInfoEntryToDescriptor(
  entry: Record<string, unknown>,
): ComfyEffectNodeDescriptor {
  const ports: ImageWorkflowComfyPortSnapshot[] = [];
  const widgets: ImageWorkflowComfyWidgetSnapshot[] = [];
  const input = entry.input as Record<string, unknown> | undefined;
  for (const [key, spec] of Object.entries(input ?? {})) {
    if (!Array.isArray(spec) || spec.length === 0) continue;
    const first = spec[0];
    if (Array.isArray(first)) {
      if (isLinkTypeSpec(first)) {
        // 连线口:[[TYPE]](可能多输出类型,取第一个做口色语义)
        ports.push({ id: key, label: key, type: first[0] ?? "CUSTOM", side: "input" });
      } else {
        // COMBO:选项表(字符串列表;可带第二项配置对象)
        const options = first.filter((item): item is string => typeof item === "string");
        const config = spec[1] as Record<string, unknown> | undefined;
        const def = typeof config?.default === "string" ? config.default : options[0];
        widgets.push({ id: key, label: key, type: "COMBO", default: def, options });
      }
      continue;
    }
    if (typeof first === "string" && WIDGET_TYPES.has(first)) {
      const config = spec[1] as Record<string, unknown> | undefined;
      const widget: ImageWorkflowComfyWidgetSnapshot = { id: key, label: key, type: first as ImageWorkflowComfyWidgetSnapshot["type"] };
      if (config?.default !== undefined && (typeof config.default === "number" || typeof config.default === "string" || typeof config.default === "boolean")) {
        widget.default = config.default;
      }
      if (typeof config?.min === "number") widget.min = config.min;
      if (typeof config?.max === "number") widget.max = config.max;
      if (typeof config?.step === "number") widget.step = config.step;
      if (typeof config?.multiline === "boolean") widget.placeholder = "输入文本";
      widgets.push(widget);
      continue;
    }
    // 非五类声明(第三方自定义 widget 形状不可穷举):按连线口兜底
    if (typeof first === "string" && first) {
      ports.push({ id: key, label: key, type: first, side: "input" });
    }
  }
  // 输出口:output 数组的类型名逐个成口(id=槽位序号,连线边 sourceHandle 用)
  const outputs = Array.isArray(entry.output) ? entry.output : [];
  outputs.forEach((type, index) => {
    if (typeof type !== "string" || !type) return;
    ports.push({
      id: String(index),
      label: outputs.length > 1 ? `${type} ${index + 1}` : type,
      type,
      side: "output",
    });
  });
  if (ports.length === 0 && widgets.length === 0) {
    // 完全解析不出(结构漂移防御):至少给输出口,节点不至于零口
    ports.push({ id: "0", label: "输出", type: "*", side: "output" });
  }
  return { ports, widgets };
}

/** object_info 详情应答(sidecar ?class= 端点)归一成 descriptor */
export function objectInfoDetailReplyToDescriptor(
  reply: { detail?: Record<string, unknown> | null; error?: string | null },
  classType: string,
): { ok: true; descriptor: ComfyEffectNodeDescriptor } | { ok: false; error: string } {
  if (!reply.detail || typeof reply.detail !== "object") {
    return { ok: false, error: reply.error || `引擎没有「${classType}」的节点声明(引擎未运行或插件已卸载)` };
  }
  return { ok: true, descriptor: objectInfoEntryToDescriptor(reply.detail) };
}
