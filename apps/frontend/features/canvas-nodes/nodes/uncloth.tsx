// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Shirt } from "lucide-react";
import type { CanvasNodeDefinition } from "../node-registry";

/** 无衣物节点定义(09-08 P2):三入口(图/①正向/②负向)+右出口,处理类默认收起 */
export const unclothNodeDefinition: CanvasNodeDefinition = {
  typeId: "uncloth",
  label: "无衣物",
  icon: Shirt,
  iconClassName: "border-primary/30 bg-primary/10 text-primary",
  width: 420,
  defaultExpanded: false,
  handles: [
    {
      kind: "target",
      id: "image",
      position: "Left",
      top: "20%",
      className: "border-warning/40! bg-warning/20!",
      title: "图A(场景)输入:参考图/成图/链式无衣物连这里",
      badge: "图",
      badgeClassName: "text-warning/80",
      badgeTop: "16%",
    },
    {
      kind: "target",
      id: "image-b",
      position: "Left",
      top: "42%",
      className: "border-accent-foreground/30! bg-accent/15!",
      title: "图B(主体,可选):干净单人参考图——挂上即双参考(换脸/换装/换场景;仅稳定流)",
      badge: "B",
      badgeClassName: "text-accent-foreground/70",
      badgeTop: "38%",
    },
    {
      kind: "target",
      id: "prompt-1",
      position: "Left",
      top: "63%",
      className: "border-info/40! bg-info/20!",
      title: "① 正向提示词连这里:想怎么改(稳定流=编辑指令;遮罩流=重绘/锚定全文)",
      badge: "①",
      badgeClassName: "text-info/80",
      badgeTop: "59%",
    },
    {
      kind: "target",
      id: "prompt-2",
      position: "Left",
      top: "86%",
      className: "border-destructive/50! bg-destructive/15!",
      title: "② 负向提示词连这里:不想要的元素(两流均拼为「画面避免:」句进指令)",
      badge: "②",
      badgeClassName: "text-destructive/80",
      badgeTop: "82%",
    },
    {
      kind: "source",
      position: "Right",
      className: "border-info/40! bg-info/20!",
      title: "输出口:连到成图节点(本卡结果直通成图)",
    },
  ],
  summary: (node) => {
    const variant = node.variant;
    const mode = variant === "instruct" ? "稳定" : variant === "fast" ? "快" : "遮罩";
    const steps = typeof node.steps === "number" ? node.steps : 8;
    const lines = [`档位:${mode} · ${steps} 步`, "口:①正向 ②负向 图=参考图/成图"];
    const own = typeof node.prompt === "string" ? node.prompt.trim() : "";
    if (own) lines.push(`自带指令:${own.slice(0, 30)}`);
    return lines.join("\n");
  },
};
