// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { ImageWorkflowUnclothNode } from "@/types/studio";

/**
 * 无衣物节点参数默认值单源(09-04-krea2-uncloth-node)。
 * 一切以 ComfyUI「Krea2-NSFW专业流-改图-无衣物」实读 widgets 为准;
 * 节点字段全可选,读侧经 resolveUnclothParams 回落——旧画布零迁移。
 */

export const UNCLOTH_DEFAULTS = {
  /** 遍1 脱衣 denoise */
  denoiseUndress: 0.65,
  seedUndress: 3,
  /** 遍2 校色 denoise(衣物区+过渡带) */
  denoiseColor: 0.3,
  seedColor: 1,
  /** 两遍共用步数 */
  steps: 8,
  /** 遍1 蒙版收缩 px(防越界) */
  growUndress: -16,
  /** 遍2 蒙版外扩 px(过渡带) */
  growColor: 16,
  /** 输入图上限(百万像素) */
  megapixels: 1.0,
  /** segformer 部位勾选(按 id 键位;工作流实勾=上衣4/短裙5/裤6/连衣裙7/腰带8+手臂腿 12-15) */
  segformerParts: [4, 5, 6, 7, 8, 12, 13, 14, 15],
  /** fashn parser 部位 */
  fashnParts: "dress,skirt,pants,belt,arms,legs",
  maskDetail: { processDetail: true, detailErode: 8, detailDilate: 6, blackPoint: 0.01, whitePoint: 0.99, maxMegapixels: 2 },
  /** LoRA 三槽:V4(关)/Mystic(开1.0)/pussy(开0.3) */
  loras: [
    { enabled: false, strength: 1.0 },
    { enabled: true, strength: 1.0 },
    { enabled: true, strength: 0.3 },
  ],
  /** 正向 Rebalance 12 权重(单层 5.0 版,与专业流一致) */
  rebalanceWeights: [1, 1, 1, 1, 1, 1, 1, 1, 5, 1, 1, 1],
} as const;

/** segformer 部位 id → 中文标签(勾选 UI) */
export const SEGFORMER_PART_LABELS: ReadonlyArray<{ id: number; label: string }> = [
  { id: 1, label: "帽子" },
  { id: 2, label: "头发" },
  { id: 4, label: "上衣" },
  { id: 5, label: "短裙" },
  { id: 6, label: "裤子" },
  { id: 7, label: "连衣裙" },
  { id: 8, label: "腰带" },
  { id: 9, label: "鞋" },
  { id: 12, label: "手臂" },
  { id: 13, label: "腿" },
  { id: 16, label: "包" },
  { id: 17, label: "围巾" },
];

/** 节点参数 → 生效值(缺省回落工作流默认) */
export function resolveUnclothParams(node: Partial<ImageWorkflowUnclothNode>) {
  return {
    denoiseUndress: node.denoiseUndress ?? UNCLOTH_DEFAULTS.denoiseUndress,
    seedUndress: node.seedUndress ?? UNCLOTH_DEFAULTS.seedUndress,
    denoiseColor: node.denoiseColor ?? UNCLOTH_DEFAULTS.denoiseColor,
    seedColor: node.seedColor ?? UNCLOTH_DEFAULTS.seedColor,
    steps: node.steps ?? UNCLOTH_DEFAULTS.steps,
    growUndress: node.growUndress ?? UNCLOTH_DEFAULTS.growUndress,
    growColor: node.growColor ?? UNCLOTH_DEFAULTS.growColor,
    megapixels: node.megapixels ?? UNCLOTH_DEFAULTS.megapixels,
    segformerParts: [...(node.segformerParts ?? UNCLOTH_DEFAULTS.segformerParts)],
    fashnParts: node.fashnParts ?? UNCLOTH_DEFAULTS.fashnParts,
    maskDetail: { ...UNCLOTH_DEFAULTS.maskDetail, ...(node.maskDetail ?? {}) },
    loras: (node.loras ?? UNCLOTH_DEFAULTS.loras).map((slot, index) => ({
      enabled: slot.enabled ?? UNCLOTH_DEFAULTS.loras[index].enabled,
      strength: slot.strength ?? UNCLOTH_DEFAULTS.loras[index].strength,
    })),
    rebalanceWeights: [...(node.rebalanceWeights ?? UNCLOTH_DEFAULTS.rebalanceWeights)],
  };
}
