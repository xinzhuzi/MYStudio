// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Boxes } from "lucide-react";
import type { CanvasNodeDefinition } from "../node-registry";

/** 分组节点定义(09-08 P3):视觉容器,不参与连线(校验侧拒) */
export const groupNodeDefinition: CanvasNodeDefinition = {
  typeId: "group",
  label: "分组",
  icon: Boxes,
  iconClassName: "border-border bg-muted text-muted-foreground",
  width: 480,
  defaultExpanded: true,
  handles: [],
  summary: (node) => {
    const members = Array.isArray(node.memberIds) ? node.memberIds.length : 0;
    return members ? `${members} 个节点` : "空分组";
  },
};
