// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { ImageIcon } from "lucide-react";
import type { CanvasNodeDefinition } from "../node-registry";

/** 成图节点定义(09-08 P3):生图链最后一步——触发+展示;不能单独生图
 *  (09-07 用户终裁:提示词等输入全部来自上游连线) */
export const generatedNodeDefinition: CanvasNodeDefinition = {
  typeId: "generated",
  label: "成图",
  icon: ImageIcon,
  iconClassName: "border-primary/30 bg-primary/10 text-primary",
  width: 560,
  defaultExpanded: true,
  handles: [
    {
      kind: "target",
      position: "Left",
      className: "border-info/40! bg-info/20!",
      title: "输入口:上游提示词(正/负)/无衣物/NSFW/参考图连这里",
    },
    {
      kind: "source",
      position: "Right",
      className: "border-info/40! bg-info/20!",
      title: "输出口:结果可连下游成图/无衣物图口继续精修",
    },
  ],
  summary: (node) => {
    const status = node.status;
    if (status === "generating" || status === "queued") return "正在生成…";
    if (status === "failed") {
      const reason = typeof node.errorReason === "string" ? node.errorReason : "";
      return `生成失败${reason ? `:${reason.slice(0, 30)}` : ""}`;
    }
    if (status === "ready" && typeof node.resultUrl === "string" && node.resultUrl) {
      const res = typeof node.resolution === "string" ? node.resolution : "";
      return `已生成${res ? ` · ${res}` : ""}(点开看结果)`;
    }
    return "等待生成——连线后点生成";
  },
};
