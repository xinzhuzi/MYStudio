// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Sparkles } from "lucide-react";
import type { CanvasNodeDefinition } from "../node-registry";

/**
 * ComfyUI 通用节点定义(09-08 三期收官,流X):/object_info 或策展效果包直放
 * 的生态节点单卡。声明层 handles 为空——React Flow 口由节点数据 classType 的
 * descriptor 动态决定,在卡编辑器内渲染(见 components/panels/assist/image-studio/
 * comfy-generic-card.tsx);连线规则在 canvas-node-registry 侧给宽松声明
 * (image+prompt-text 双向容量),类型严格校验留给子图编译器执行时。
 */
export const comfyGenericNodeDefinition: CanvasNodeDefinition = {
  typeId: "comfy-generic",
  label: "效果节点",
  icon: Sparkles,
  iconClassName: "border-success/30 bg-success/10 text-success",
  width: 420,
  defaultExpanded: false,
  handles: [],
  summary: (node) => {
    const record = node as Record<string, unknown>;
    const classType = typeof record.classType === "string" ? record.classType : "";
    const ports = (record.descriptor as { ports?: unknown[] } | undefined)?.ports?.length ?? 0;
    const status = record.status;
    const statusLine = status === "running" ? "运行中…"
      : status === "ready" ? "已出图"
        : status === "failed" ? "上次运行失败" : "待子图运行";
    return `${classType} · ${ports}口 · ${statusLine}\n与效果节点连成子图后,工具菜单「运行子图」出图`;
  },
};
