// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { ImageWorkflowUnclothNode } from "@/types/studio";

/**
 * 无衣物节点参数默认值单源(09-04-krea2-uncloth-node)。
 * 一切以 ComfyUI「Krea2-NSFW专业流-改图-无衣物」**当前实读 widgets** 为准
 * (用户二次校对:LoRA 当前值 Mystic=0.8/pussy=0.15,非早期 1.0/0.3);
 * 节点字段全可选,读侧经 resolveUnclothParams 回落——旧画布零迁移。
 */

/** segformer 17 部位(ComfyUI SegformerClothesSetting 位序) */
export const SEGFORMER_PARTS: ReadonlyArray<string> = [
  "face", "hair", "hat", "sunglass",
  "left_arm", "right_arm", "left_leg", "right_leg",
  "left_shoe", "right_shoe",
  "upper_clothes", "skirt", "pants", "dress", "belt",
  "bag", "scarf",
] as const;

/** 部位中文标签(勾选 UI) */
export const SEGFORMER_PART_LABELS: Record<string, string> = {
  face: "脸", hair: "头发", hat: "帽子", sunglass: "墨镜",
  left_arm: "左臂", right_arm: "右臂", left_leg: "左腿", right_leg: "右腿",
  left_shoe: "左鞋", right_shoe: "右鞋",
  upper_clothes: "上衣", skirt: "短裙", pants: "裤子", dress: "连衣裙", belt: "腰带",
  bag: "包", scarf: "围巾",
};

export const UNCLOTH_DEFAULTS = {
  steps: 8,
  cfg: 1,
  sampler: "euler",
  scheduler: "simple",
  denoiseUndress: 0.65,
  seedUndress: 3,
  denoiseColor: 0.3,
  seedColor: 1,
  growUndress: -16,
  growUndressInvert: true,
  growColor: 16,
  growColorInvert: true,
  upscaleMethod: "lanczos",
  megapixels: 1.0,
  divisionFactor: 1,
  segformerParts: ["left_arm", "right_arm", "left_leg", "right_leg",
    "upper_clothes", "skirt", "pants", "dress", "belt"],
  fashnParts: "dress,skirt,pants,belt,arms,legs",
  fashnDevice: "cpu",
  fashnDtype: "float32",
  maskDetail: {
    detailMethod: "GuidedFilter",
    processDetail: true,
    detailErode: 8,
    detailDilate: 6,
    blackPoint: 0.01,
    whitePoint: 0.99,
    maxMegapixels: 2,
  },
  loras: [
    { enabled: false, strength: 1.0 },  // NSFW V4(关)
    { enabled: true, strength: 0.8 },   // Mystic XXX v3(开 0.8 — 工作流当前值)
    { enabled: false, strength: 0 },    // 空槽(关)
    { enabled: true, strength: 0.15 },  // pussy(开 0.15 — 工作流当前值)
  ],
  rebalanceWeights: [1, 1, 1, 1, 1, 1, 1, 1, 5, 1, 1, 1],
} as const;

/** 节点参数 → 生效值(缺省回落工作流默认) */
export function resolveUnclothParams(node: Partial<ImageWorkflowUnclothNode>) {
  return {
    steps: node.steps ?? UNCLOTH_DEFAULTS.steps,
    cfg: node.cfg ?? UNCLOTH_DEFAULTS.cfg,
    sampler: node.sampler ?? UNCLOTH_DEFAULTS.sampler,
    scheduler: node.scheduler ?? UNCLOTH_DEFAULTS.scheduler,
    denoiseUndress: node.denoiseUndress ?? UNCLOTH_DEFAULTS.denoiseUndress,
    seedUndress: node.seedUndress ?? UNCLOTH_DEFAULTS.seedUndress,
    denoiseColor: node.denoiseColor ?? UNCLOTH_DEFAULTS.denoiseColor,
    seedColor: node.seedColor ?? UNCLOTH_DEFAULTS.seedColor,
    growUndress: node.growUndress ?? UNCLOTH_DEFAULTS.growUndress,
    growUndressInvert: node.growUndressInvert ?? UNCLOTH_DEFAULTS.growUndressInvert,
    growColor: node.growColor ?? UNCLOTH_DEFAULTS.growColor,
    growColorInvert: node.growColorInvert ?? UNCLOTH_DEFAULTS.growColorInvert,
    upscaleMethod: node.upscaleMethod ?? UNCLOTH_DEFAULTS.upscaleMethod,
    megapixels: node.megapixels ?? UNCLOTH_DEFAULTS.megapixels,
    divisionFactor: node.divisionFactor ?? UNCLOTH_DEFAULTS.divisionFactor,
    segformerParts: [...(node.segformerParts ?? UNCLOTH_DEFAULTS.segformerParts)],
    fashnParts: node.fashnParts ?? UNCLOTH_DEFAULTS.fashnParts,
    fashnDevice: node.fashnDevice ?? UNCLOTH_DEFAULTS.fashnDevice,
    fashnDtype: node.fashnDtype ?? UNCLOTH_DEFAULTS.fashnDtype,
    maskDetail: { ...UNCLOTH_DEFAULTS.maskDetail, ...(node.maskDetail ?? {}) },
    loras: (node.loras ?? UNCLOTH_DEFAULTS.loras).map((slot, index) => ({
      enabled: slot.enabled ?? UNCLOTH_DEFAULTS.loras[index].enabled,
      strength: slot.strength ?? UNCLOTH_DEFAULTS.loras[index].strength,
    })),
    rebalanceWeights: [...(node.rebalanceWeights ?? UNCLOTH_DEFAULTS.rebalanceWeights)],
  };
}
