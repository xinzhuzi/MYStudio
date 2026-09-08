// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ComfyUI 端口类型 → 配色常量表(三期 通用节点)。
 *
 * 色彩语义沿用 ComfyUI 社区惯例(prd 裁定 6:端口配色沿用 ComfyUI 语义):
 * 同类端口同色、异类端口异色,用户在生态里养成的「看到紫色=图像口」直觉
 * 平移到自建画布。注意:具体数值不照抄 ComfyUI 前端代码(License 红线,
 * 代码一行不拷),由本仓库自选近似值;类型→色相的映射才是被沿用的语义。
 *
 * 双形式输出:
 * 1. `comfyPortCssColor(type)` → `var(--comfy-port-image, #7C6CF0)` 形式,
 *    供内联 style 使用——主题层注册了 CSS 变量即可整体调色,未注册时用
 *    兜底色(design-lint 拦硬编码 Tailwind 调色板类,端口色点因此走
 *    CSS 变量方案而非 palette 类)。
 * 2. `COMFY_PORT_CSS_VARIABLES` → { 变量名: 兜底色 } 全表,集成期想把
 *    端口色纳入主题系统时,可由它生成一段 :root 变量注入。
 */

/** 端口配色条目 */
export interface ComfyPortColorSpec {
  /** ComfyUI 端口类型名(/object_info 原文,大写约定) */
  type: string;
  /** 中文语义名(大白话层 tooltip/文案用) */
  label: string;
  /** CSS 变量名(主题可覆盖) */
  cssVar: string;
  /** 兜底色值(#RRGGBB;CSS 变量未注册时着色) */
  fallback: string;
}

/**
 * 八类核心端口配色(社区惯例色相 + 本仓库自选数值):
 * - IMAGE 紫 / LATENT 粉 / MODEL 绿 / CLIP 蓝 / VAE 红
 * - CONDITIONING 橙 / STRING 黑 / MASK 黄
 * STRING 的「黑」取深灰近似:纯黑在深色主题卡面上不可见,保语义同时保可读。
 */
export const COMFY_PORT_COLOR_SPECS: Readonly<Record<string, ComfyPortColorSpec>> = {
  IMAGE: {
    type: "IMAGE",
    label: "图像",
    cssVar: "--comfy-port-image",
    fallback: "#7C6CF0",
  },
  LATENT: {
    type: "LATENT",
    label: "潜空间",
    cssVar: "--comfy-port-latent",
    fallback: "#E87BB8",
  },
  MODEL: {
    type: "MODEL",
    label: "模型",
    cssVar: "--comfy-port-model",
    fallback: "#57B87B",
  },
  CLIP: {
    type: "CLIP",
    label: "文本编码",
    cssVar: "--comfy-port-clip",
    fallback: "#5B9DE8",
  },
  VAE: {
    type: "VAE",
    label: "编解码器",
    cssVar: "--comfy-port-vae",
    fallback: "#E86161",
  },
  CONDITIONING: {
    type: "CONDITIONING",
    label: "条件",
    cssVar: "--comfy-port-conditioning",
    fallback: "#E8933F",
  },
  STRING: {
    type: "STRING",
    label: "文本",
    cssVar: "--comfy-port-string",
    fallback: "#6E7684",
  },
  MASK: {
    type: "MASK",
    label: "蒙版",
    cssVar: "--comfy-port-mask",
    fallback: "#D6C244",
  },
};

/** 未知/扩展类型的兜底配色(中性灰:第三方插件自定义类型很常见) */
export const COMFY_PORT_UNKNOWN_SPEC: ComfyPortColorSpec = {
  type: "*",
  label: "未知类型",
  cssVar: "--comfy-port-unknown",
  fallback: "#8A93A3",
};

/** { cssVar: fallback } 全表(主题注入用;含未知类型兜底) */
export const COMFY_PORT_CSS_VARIABLES: Readonly<Record<string, string>> =
  Object.values(COMFY_PORT_COLOR_SPECS).reduce(
    (acc, spec) => {
      acc[spec.cssVar] = spec.fallback;
      return acc;
    },
    { [COMFY_PORT_UNKNOWN_SPEC.cssVar]: COMFY_PORT_UNKNOWN_SPEC.fallback } as Record<string, string>,
  );

/** 大小写不敏感查表;未知类型回落中性灰(生态插件自定义类型防御) */
export function getComfyPortColorSpec(type: string): ComfyPortColorSpec {
  const key = type.trim().toUpperCase();
  return COMFY_PORT_COLOR_SPECS[key] ?? COMFY_PORT_UNKNOWN_SPEC;
}

/** 端口色点的内联 CSS 颜色值:`var(--comfy-port-image, #7C6CF0)` 双形式 */
export function comfyPortCssColor(type: string): string {
  const spec = getComfyPortColorSpec(type);
  return `var(${spec.cssVar}, ${spec.fallback})`;
}

/** 端口类型的中文语义名(空类型防御:返回空串) */
export function comfyPortTypeLabel(type: string): string {
  if (!type) return "";
  return getComfyPortColorSpec(type).label;
}
