// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Flame } from "lucide-react";
import type { CanvasNodeDefinition } from "../node-registry";

/** NSFW破限节点定义(09-08 框架化试点):handles 口别与校验单源同口径 */
export const nsfwNodeDefinition: CanvasNodeDefinition = {
  typeId: "nsfw",
  label: "NSFW破限",
  icon: Flame,
  iconClassName: "border-warning/30 bg-warning/10 text-warning",
  width: 420,
  defaultExpanded: false,
  handles: [
    {
      kind: "target",
      position: "Left",
      className: "border-info/40! bg-info/20!",
      title: "正向提示词输入口:提示词节点「正」口连这里(经本节点增强后供成图)",
    },
    {
      kind: "source",
      position: "Right",
      className: "border-info/40! bg-info/20!",
      title: "输出口:连到成图节点,生成自动走 Krea2 专业流",
    },
  ],
  summary: (node) => `专业流增强 · ${typeof node.title === "string" && node.title ? node.title : "Krea2-NSFW"}`,
};
