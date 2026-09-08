// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Image } from "lucide-react";
import type { CanvasNodeDefinition } from "../node-registry";

/** 参考图节点定义(09-08 P2):输入类常显;编辑器内容由画布侧传(children) */
export const referenceNodeDefinition: CanvasNodeDefinition = {
  typeId: "reference",
  label: "参考图",
  icon: Image,
  iconClassName: "border-success/30 bg-success/10 text-success",
  width: 360,
  defaultExpanded: true,
  handles: [
    {
      kind: "source",
      position: "Right",
      className: "border-success/40! bg-success/20!",
      title: "输出口:连到成图/无衣物图口作为参考",
    },
  ],
  summary: (node) => {
    const url = typeof node.imageUrl === "string" ? node.imageUrl : "";
    if (!url) return "空参考图(上传或拖图)";
    const tail = url.split("/").pop() ?? url;
    return `已挂图:${tail.slice(0, 36)}`;
  },
};
