// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { ImageWorkflowNodeType } from "@/types/studio";

/**
 * 图片工作室画布的节点注册表(单一注册点)。
 *
 * 与并行收敛任务(08-31-canvas-node-registry)的关系:那是全仓统一节点注册
 * 契约的地基;本文件把 assist 画布的节点类型/元数据收敛到一处,未来统
 * 一注册表吸收时只改这一个文件。nodeTypes(React Flow 组件映射)在
 * image-studio-node-card.tsx 导出,避免此文件引入 React 依赖。
 */

export interface ImageStudioNodeMeta {
  label: string;
  description: string;
}

export const IMAGE_STUDIO_NODE_META: Record<ImageWorkflowNodeType, ImageStudioNodeMeta> = {
  reference: {
    label: "参考图",
    description: "上传或粘贴图片,连到成图节点即图生图",
  },
  prompt: {
    label: "提示词",
    description: "正向/反向提示词,连到成图节点",
  },
  generated: {
    label: "成图",
    description: "持有生成参数与结果;无参考连线=文生图,挂参考=图生图",
  },
  uncloth: {
    label: "无衣物",
    description: "衣物区域局部重绘(双分割+两遍采样);输入图+文本,输出连成图节点",
  },
  sticky: {
    label: "便利贴",
    description: "画布创作标注(换色/编辑),不参与连线",
  },
  group: {
    label: "分组框",
    description: "视觉容器:拖入吸附成组,移动组带动成员",
  },
};

/**
 * 各引擎参考图承载能力(软提示,运行时以引擎报错为准):
 * krea2/flux2/z-image=SDEdit 单参考;qwen=原生编辑多参考;
 * gpt-image 系与 comfyui 桥=多参考。未知引擎不给提示。
 */
const LOCAL_REFERENCE_CAPACITY: Record<string, number> = {
  "krea2-turbo": 1,
  "flux2-klein-9b": 1,
  "z-image-turbo": 1,
  "qwen-image-edit-2511": 4,
  "comfyui-bridge": 4,
};

export function referenceCapacityForModel(model?: string): number | undefined {
  if (!model) return undefined;
  const exact = LOCAL_REFERENCE_CAPACITY[model];
  if (exact !== undefined) return exact;
  if (/gpt-image/i.test(model)) return 4;
  return undefined;
}
