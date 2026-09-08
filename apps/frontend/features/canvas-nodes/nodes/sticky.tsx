// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { StickyNote } from "lucide-react";
import type { CanvasNodeDefinition } from "../node-registry";

/** 便利贴节点定义(09-08 框架化试点):画布标注件,不参与连线(校验侧拒) */
export const stickyNodeDefinition: CanvasNodeDefinition = {
  typeId: "sticky",
  label: "便利贴",
  icon: StickyNote,
  iconClassName: "border-border bg-muted text-muted-foreground",
  width: 240,
  defaultExpanded: true,
  handles: [],
  summary: (node) => {
    const text = typeof node.text === "string" ? node.text.trim() : "";
    return text ? text.slice(0, 60) : "画布标注";
  },
};
