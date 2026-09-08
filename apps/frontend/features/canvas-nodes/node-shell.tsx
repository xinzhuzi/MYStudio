// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasNodeDefinition, CanvasNodeHandleDef } from "./node-registry";

/**
 * 节点卡通用壳(09-08 canvas-node-framework P1):框架层承担所有节点的
 * 公共底层能力——标题行/图标/摘要行/折叠切换/handles 声明渲染/选中态。
 * 节点类型只声明定义(见 node-registry),不再手写卡壳三元链。
 * 折叠+摘要=框架内置:任何注册节点自动获得,零逐节点手写(用户裁定)。
 */

function ShellHandle({ def }: { def: CanvasNodeHandleDef }) {
  return (
    <>
      <Handle
        type={def.kind}
        id={def.id}
        position={Position[def.position]}
        style={def.top ? { top: def.top } : undefined}
        className={cn("h-3! w-3!", def.className)}
        title={def.title}
      />
      {def.badge ? (
        <span
          className={cn(
            "pointer-events-none absolute text-[9px] font-semibold",
            def.position === "Right" ? "right-1.5" : "left-1.5",
            def.badgeClassName,
          )}
          style={def.badgeTop ? { top: def.badgeTop } : undefined}
        >
          {def.badge}
        </span>
      ) : null}
    </>
  );
}

export const CanvasNodeShell = memo(function CanvasNodeShell({
  definition,
  node,
  selected,
  children,
  footer,
}: {
  definition: CanvasNodeDefinition;
  node: { id: string; type: string; title?: string };
  selected?: boolean;
  /** 摘要行内容(收起态唯一可见的正文;由 definition.summary 产出的节点) */
  children?: React.ReactNode;
  /** 详情区(展开态追加;编辑器/参数所在) */
  footer?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(definition.defaultExpanded !== false);
  const summary = definition.summary(node);
  const Icon = definition.icon;
  return (
    <div
      data-canvas-node-kind={node.type}
      className={cn(
        "[contain:layout_style]",
        "canvas-node-shell group/node relative rounded-xl border bg-card/96 p-3.5 text-card-foreground",
        "shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-[border-color,box-shadow] duration-200",
        "hover:border-border/90 hover:shadow-[0_4px_16px_rgba(0,0,0,0.22)]",
        selected ? "border-primary/60" : "border-border",
        definition.width ? undefined : "w-[420px]",
      )}
      style={definition.width ? { width: definition.width } : undefined}
    >
      {definition.handles.map((def) => (
        <ShellHandle key={`${def.kind}:${def.id ?? "single"}`} def={def} />
      ))}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
              definition.iconClassName ?? "border-primary/30 bg-primary/10 text-primary",
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{node.title || definition.label}</div>
            {summary ? <div className="truncate text-[11px] text-muted-foreground">{summary}</div> : null}
          </div>
        </div>
        {footer ? (
          <button
            type="button"
            aria-label={expanded ? "收起节点详情" : "展开节点详情"}
            onClick={() => setExpanded((value) => !value)}
            className="nodrag nopan flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded ? "" : "-rotate-90")} />
          </button>
        ) : null}
      </div>
      {expanded ? <div className="space-y-2">{footer}</div> : null}
      {children}
    </div>
  );
});

/** 便捷工厂:由定义生成 React Flow 节点组件(nodeTypes 单源) */
export function defineReactNode(
  definition: CanvasNodeDefinition,
  render: (props: NodeProps) => React.ReactNode,
) {
  const Component = memo((props: NodeProps) => render(props));
  Component.displayName = `CanvasNode[${definition.typeId}]`;
  return Component;
}
