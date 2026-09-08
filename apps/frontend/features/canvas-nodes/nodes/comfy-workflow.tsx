// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Workflow } from "lucide-react";
import type { CanvasNodeDefinition } from "../node-registry";

/**
 * ComfyUI 工作流节点定义(09-08 二期收官,流X):工作流库导入的 API 格式
 * 工作流整体成卡。handles=左 prompt 口+图口,右出图口(声明层静态三口;
 * descriptor 端口明细/高级参数/出图区在卡编辑器内渲染——见
 * components/panels/assist/image-studio/comfy-workflow-card.tsx)。
 * 口别 id(prompt/image)与 canvas-node-registry 输入通道声明同口径。
 */
export const comfyWorkflowNodeDefinition: CanvasNodeDefinition = {
  typeId: "comfy-workflow",
  label: "工作流节点",
  icon: Workflow,
  iconClassName: "border-accent/30 bg-accent/10 text-accent",
  width: 420,
  defaultExpanded: false,
  handles: [
    {
      kind: "target",
      id: "prompt",
      position: "Left",
      top: "34%",
      className: "border-info/40! bg-info/20!",
      title: "提示词输入口:提示词节点的「正」口连这里(正负文本按工作流边界口极性注入)",
    },
    {
      kind: "target",
      id: "image",
      position: "Left",
      top: "66%",
      className: "border-accent/40! bg-accent/20!",
      title: "图输入口:参考图/上游成图连这里(注入工作流第一个图口)",
    },
    {
      kind: "source",
      position: "Right",
      className: "border-accent/40! bg-accent/20!",
      title: "出图口:工作流输出图,可连成图节点或效果节点",
    },
  ],
  summary: (node) => {
    const record = node as Record<string, unknown>;
    const name = typeof record.workflowName === "string" ? record.workflowName : "工作流";
    const count = typeof record.nodeCount === "number" ? record.nodeCount
      : (record.descriptor as { nodeCount?: number } | undefined)?.nodeCount;
    const status = record.status;
    const statusLine = status === "running" ? "运行中…"
      : status === "ready" ? "已出图"
        : status === "failed" ? "上次运行失败" : "未运行";
    return `${name} · ${count ?? "?"}节点 · ${statusLine}\n左进口连提示词/参考图,卡上「运行」出图`;
  },
};
