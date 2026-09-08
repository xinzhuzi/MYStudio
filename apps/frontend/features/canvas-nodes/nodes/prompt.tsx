// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Type } from "lucide-react";
import type { CanvasNodeDefinition } from "../node-registry";

/** 提示词节点定义(09-08 P2):正/负双出口(口别 id 与校验单源同口径) */
export const promptNodeDefinition: CanvasNodeDefinition = {
  typeId: "prompt",
  label: "提示词",
  icon: Type,
  iconClassName: "border-info/30 bg-info/10 text-info",
  width: 480,
  defaultExpanded: true,
  handles: [
    {
      kind: "source",
      id: "positive",
      label: "正向",
      position: "Right",
      top: "40%",
      className: "border-info/40! bg-info/20!",
      title: "正向提示词出口:连到下游输入口",
      badge: "正",
      badgeClassName: "text-info/80",
      badgeTop: "36%",
    },
    {
      kind: "source",
      id: "negative",
      label: "反向",
      position: "Right",
      top: "75%",
      className: "border-destructive/50! bg-destructive/15!",
      title: "反向提示词出口:连到同一输入口即与正向拼装",
      badge: "负",
      badgeClassName: "text-destructive/80",
      badgeTop: "71%",
    },
  ],
  summary: (node) => {
    const prompt = typeof node.prompt === "string" ? node.prompt.trim() : "";
    const negative = typeof node.negativePrompt === "string" ? node.negativePrompt.trim() : "";
    const lines = [`正向:${prompt ? prompt.slice(0, 40) : "(未填写)"}`];
    if (negative) lines.push(`负向:${negative.slice(0, 30)}`);
    return lines.join("\n");
  },
};
