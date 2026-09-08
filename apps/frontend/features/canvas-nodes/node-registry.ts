// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { LucideIcon } from "lucide-react";

/**
 * 声明式节点定义契约(09-08 canvas-node-framework):节点=一份声明
 * (handles/摘要/详情/几何),由 node-shell 统一渲染。handle 口别 id 与
 * 校验单源(graph-build-mutations)同口径:image/prompt-1/prompt-2/
 * positive/negative——两边改动必须同步(锚点表见知识文档 §13)。
 */

export interface CanvasNodeHandleDef {
  kind: "source" | "target";
  /** 缺省=单口(与存量无 id handle 回落口径一致) */
  id?: string;
  position: "Left" | "Right";
  /** 百分比定位(如 "55%");缺省=垂直居中 */
  top?: string;
  className?: string;
  title: string;
  /** 口别角标(①/②/正/负/图) */
  badge?: string;
  badgeClassName?: string;
  /** 角标纵向偏移(百分比),与 top 配对微调 */
  badgeTop?: string;
}

export interface CanvasNodeDefinition {
  typeId: string;
  label: string;
  icon: LucideIcon;
  iconClassName?: string;
  /** 定宽(缺省 420) */
  width?: number;
  handles: readonly CanvasNodeHandleDef[];
  /** 摘要行(标题下的一行状态;收起态的唯一正文线索) */
  summary: (node: Record<string, unknown>) => string;
  /** 折叠默认态(处理类=false 收起;输入类=true) */
  defaultExpanded?: boolean;
}
