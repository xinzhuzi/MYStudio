// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasNodeDefinition, CanvasNodeHandleDef } from "./node-registry";

/**
 * 节点卡通用壳(09-08 canvas-node-framework P1):框架层承担所有节点的
 * 公共底层能力——标题行/图标/摘要行/折叠切换/handles 声明渲染/选中态。
 * 节点类型只声明定义(见 node-registry),不再手写卡壳三元链。
 * 折叠+摘要=框架内置:任何注册节点自动获得,零逐节点手写(用户裁定)。
 *
 * 09-09 照 ComfyUI 节点布局升级:
 * - 声明 handles 不再百分比悬浮,改渲染为「端口行」:输入沿左缘/输出沿右缘
 *   逐行配对,连线点锚进行内(连线终点=视觉点),口别角标(正/负/①/②)保留;
 * - bypassed 节点:整卡 60% 透明+标题条「旁路」徽章(Ctrl+M 切换,画布层接);
 * - onResizeEnd 传入即启用 NodeResizer(宽度持久化由调用方 store 单源)。
 */

function ShellHandleRow({
  def,
  isInput,
}: {
  def: CanvasNodeHandleDef;
  isInput: boolean;
}) {
  const label = def.label ?? def.badge ?? def.id ?? "";
  return (
    <>
      <Handle
        type={def.kind}
        id={def.id}
        position={Position[def.position]}
        style={{
          position: "absolute",
          top: "50%",
          transform: "translateY(-50%)",
          ...(isInput ? { left: "-6px" } : { right: "-6px" }),
        }}
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
      <span
        className={cn(
          "min-w-0 truncate text-[11px] leading-5 text-foreground/80",
          isInput ? "pl-2.5" : "pr-2.5 text-right",
        )}
        title={def.title}
      >
        {label}
      </span>
    </>
  );
}

export const CanvasNodeShell = memo(function CanvasNodeShell({
  definition,
  node,
  selected,
  children,
  footer,
  titleOverride,
  banner,
  dataKindAttr,
  toolbar,
  onResizeEnd,
}: {
  definition: CanvasNodeDefinition;
  node: { id: string; type: string; title?: string; bypassed?: boolean; size?: { width: number } };
  selected?: boolean;
  /** 摘要行内容(收起态唯一可见的正文;由 definition.summary 产出的节点) */
  children?: React.ReactNode;
  /** 详情区(展开态追加;编辑器/参数所在) */
  footer?: React.ReactNode;
  /** 标题覆盖(如参考图编号「参考图 2」;缺省=node.title||label) */
  titleOverride?: string;
  /** 卡顶提示条(衍生过期等画布侧横幅) */
  banner?: React.ReactNode;
  /** 兼容各画布旧节点类型标记属性名(默认 data-canvas-node-kind;存量探测
   * 脚本/测试依赖 data-image-workflow-node-kind 等旧名) */
  dataKindAttr?: string;
  /** 卡右上工具行(取材四件套/删除等画布侧动作;与折叠钮并排) */
  toolbar?: React.ReactNode;
  /** 宽度持久化回调(传入即启用右下角拉伸;宽度来源 node.size 单源) */
  onResizeEnd?: (width: number) => void;
}) {
  const [expanded, setExpanded] = useState(definition.defaultExpanded !== false);
  // 摘要=独立信息功能(常显,收起态即卡主体):内容行由 definition.summary
  // 产出;与折叠(交互功能,控 footer)正交——有无摘要都可折叠,反之亦然
  const summaryLines = definition.summary(node)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  const Icon = definition.icon;
  const bypassed = node.bypassed === true;
  const width = node.size?.width ?? definition.width;
  const inputHandles = definition.handles.filter((def) => def.kind === "target");
  const outputHandles = definition.handles.filter((def) => def.kind === "source");
  const rowCount = Math.max(inputHandles.length, outputHandles.length);
  return (
    <div
      {...{ [dataKindAttr ?? "data-canvas-node-kind"]: node.type }}
      data-canvas-node-bypassed={bypassed ? "true" : undefined}
      className={cn(
        "[contain:layout_style]",
        "canvas-node-shell group/node relative rounded-xl border bg-card/96 p-3.5 text-card-foreground",
        "shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-[border-color,box-shadow,opacity] duration-200",
        "hover:border-border/90 hover:shadow-[0_4px_16px_rgba(0,0,0,0.22)]",
        selected ? "border-primary/60" : "border-border",
        bypassed && "opacity-60",
        width ? undefined : "w-[420px]",
      )}
      style={width ? { width } : undefined}
    >
      {onResizeEnd ? (
        <NodeResizer
          minWidth={300}
          maxWidth={900}
          handleStyle={{ width: "8px", height: "8px", borderRadius: "2px", opacity: selected ? 0.8 : 0.35 }}
          lineStyle={{ borderWidth: 0 }}
          onResizeEnd={(_event, params) => onResizeEnd(params.width ?? 300)}
        />
      ) : null}
      {banner}
      {/* 标题条(照 ComfyUI:窄条+旁路徽章) */}
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
            <div className="truncate text-sm font-medium">{titleOverride ?? node.title ?? definition.label}</div>
          </div>
          {bypassed ? (
            <span
              className="ml-1 shrink-0 rounded-full border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              title="旁路中:生成与编译链跳过该节点(连线保留)"
            >
              旁路
            </span>
          ) : null}
        </div>
        <div className="nodrag nopan flex shrink-0 items-center gap-0.5">{toolbar}</div>
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
      {/* 端口行区(09-09 照 ComfyUI):输入沿左缘/输出沿右缘逐行配对,
          连线点锚进行内;单侧空位让位 */}
      {rowCount > 0 ? (
        <div className="mb-3 space-y-0.5" data-canvas-node-ports>
          {Array.from({ length: rowCount }, (_, index) => {
            const input = inputHandles[index];
            const output = outputHandles[index];
            return (
              <div key={input?.id ?? `out:${output?.id ?? index}`} className="relative flex min-h-5 items-center">
                {input ? (
                  <span className="relative flex min-w-0 flex-1 items-center">
                    <ShellHandleRow def={input} isInput />
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                {output ? (
                  <span className="relative flex min-w-0 flex-1 items-center justify-end">
                    <ShellHandleRow def={output} isInput={false} />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {summaryLines.length > 0 ? (
        <div
          data-canvas-node-summary
          className="mb-3 space-y-0.5 rounded-md border border-border/70 bg-background/60 px-2 py-1.5 text-[11px] leading-4 text-foreground/85"
        >
          {summaryLines.map((line) => (
            <div key={line} className="truncate">{line}</div>
          ))}
        </div>
      ) : null}
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
