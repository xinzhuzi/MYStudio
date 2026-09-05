// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { ImageWorkflowUnclothNode } from "@/types/studio";

/**
 * ⚠️ 09-05 封存(ARCHIVED):masked SDEdit 双档(快/精)节点整体封存。
 *
 * 背景:ComfyUI「Krea2_无衣物」流于 09-05 大改为 Krea2Edit 指令编辑架构
 * (identity_edit LoRA + GroundedEncode 参考图进 VLM + ModelPatch 参考注意
 * 力 + denoise=1.0),旧的「分割蒙版+两遍采样」路线退役;现行档 variant=
 * "instruct" 走 ComfyUI 桥(krea2_uncloth_instruct 模板)。历史工作流版本:
 * ~/Project/ComfyUI/user/default/workflows/K2图像/改图/Krea2_无衣物_{快,精}.json。
 *
 * 封存范围:创建入口全部隐藏(toolbar 双按钮/连线创建菜单/命令面板),
 * 存量画布的 uncloth 节点仍可渲染与生成(不破坏旧画布)。
 * 启用步骤:本开关改 false;按 UNCLOOTH_ARCHIVED 条件展示的入口全部恢复
 * (toolbar 两按钮/connect-create 菜单数组/commands 白名单)。
 * 后端 uncloth_pipeline.py 的 mode=fast/fine 分流与双分割实现原样保留。
 */
export const UNCLOOTH_ARCHIVED = true;

/**
 * ⚠️ 09-05 封存(ARCHIVED):masked SDEdit 双档(快/精)节点整体封存。
 *
 * 背景:ComfyUI「Krea2_无衣物」流于 09-05 大改为 Krea2Edit 指令编辑架构
 * (identity_edit LoRA + GroundedEncode 参考图进 VLM + ModelPatch 参考注意
 * 力 + denoise=1.0),旧的「分割蒙版+两遍采样」路线退役;新档 variant=
 * "instruct" 走 ComfyUI 桥跑 Krea2Edit 流。对应工作流历史版本:
 * ~/ComfyUI .../K2图像/改图/Krea2_无衣物_{快,精}.json(09-05 上午版)。
 *
 * 封存范围:创建入口全部隐藏(toolbar 双按钮/连线创建菜单/命令面板),
 * 存量画布的 uncloth 节点仍可渲染与生成(不破坏旧画布)。
 * 启用步骤(恢复快/精档):本开关改 false 即可,以下入口按
 * UNCLOTH_ARCHIVED 条件展示的代码全部恢复(toolbar.tsx 两按钮 /
 * connect-create.ts 菜单数组 / use-image-workflow-commands 白名单)。
 * 后端 uncloth_pipeline.py 的 mode=fast/fine 分流与双分割实现原样保留。
 */
export const UNCLOTH_ARCHIVED = true;

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
  seedUndress: 1,  // 09-05 工作流当前值(3→1)
  denoiseColor: 0.3,
  seedColor: 1,
  growUndress: 12,  // 09-05 精流当前值(-16 内缩→+12 外扩,盖领口阴影)
  growUndressInvert: true,
  growColor: 16,
  growColorInvert: true,
  upscaleMethod: "lanczos",
  megapixels: 1.0,
  divisionFactor: 1,
  segformerParts: ["left_arm", "right_arm", "left_leg", "right_leg",
    "upper_clothes", "skirt", "pants", "dress", "belt"],
  // 09-04 全节点对拍:label 主标签 top(上衣)+extra 六项(工作流 #93 widgets)
  fashnParts: "top,dress,skirt,pants,belt,arms,legs",
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

/** 节点参数 → 生效值(缺省回落工作流默认)。
 * 09-05 快/精两档:fast=「Krea2_无衣物_快」流(fashn 单分割+单遍 0.65+
 * 外扩12,无校色遍无后处理);fine=「Krea2_无衣物_精」流(双分割+两遍+
 * mkl 色彩对齐+硬合成)。档位经 node.variant,缺省 fine(旧节点零迁移)。 */
export function resolveUnclothParams(node: Partial<ImageWorkflowUnclothNode>) {
  const fast = node.variant === "fast";
  const instruct = node.variant === "instruct";
  const base = fast
    ? { ...UNCLOTH_DEFAULTS, segformerParts: [] as string[] }
    : instruct
      ? { ...UNCLOTH_DEFAULTS, steps: 10, seedUndress: 2 }
      : UNCLOTH_DEFAULTS;
  return {
    mode: instruct ? ("instruct" as const) : fast ? ("fast" as const) : ("fine" as const),
    steps: node.steps ?? base.steps,
    cfg: node.cfg ?? base.cfg,
    sampler: node.sampler ?? base.sampler,
    scheduler: node.scheduler ?? base.scheduler,
    denoiseUndress: node.denoiseUndress ?? base.denoiseUndress,
    seedUndress: node.seedUndress ?? base.seedUndress,
    denoiseColor: node.denoiseColor ?? base.denoiseColor,
    seedColor: node.seedColor ?? base.seedColor,
    growUndress: node.growUndress ?? base.growUndress,
    growUndressInvert: node.growUndressInvert ?? base.growUndressInvert,
    growColor: node.growColor ?? base.growColor,
    growColorInvert: node.growColorInvert ?? base.growColorInvert,
    upscaleMethod: node.upscaleMethod ?? base.upscaleMethod,
    megapixels: node.megapixels ?? base.megapixels,
    divisionFactor: node.divisionFactor ?? base.divisionFactor,
    segformerParts: [...(node.segformerParts ?? base.segformerParts)],
    fashnParts: node.fashnParts ?? base.fashnParts,
    fashnDevice: node.fashnDevice ?? base.fashnDevice,
    fashnDtype: node.fashnDtype ?? base.fashnDtype,
    maskDetail: { ...base.maskDetail, ...(node.maskDetail ?? {}) },
    loras: (node.loras ?? base.loras).map((slot, index) => ({
      enabled: slot.enabled ?? base.loras[index].enabled,
      strength: slot.strength ?? base.loras[index].strength,
    })),
    rebalanceWeights: [...(node.rebalanceWeights ?? base.rebalanceWeights)],
  };
}
