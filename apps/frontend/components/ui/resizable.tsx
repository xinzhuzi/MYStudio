// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing is available. See COMMERCIAL_LICENSE.md.
"use client";

// react-resizable-panels 2→4(1003 B3)API 重写适配层:对外导出名与 props 面不变,
// 消费面(9 文件)零改动。三处映射:
// ①PanelGroup→Group,`direction`→`orientation`(取值 token 不变);垂直态样式钩
//   从 v2 自动渲染的 data-panel-group-direction 改为包装层自置 data-orientation
// ②尺寸语义变化:v2 数字=百分比,v4 数字=像素/无单位字符串=百分比;消费面 24 处
//   defaultSize/minSize、10 处 maxSize 全为数字,包装层统一转字符串保百分比语义
// ③PanelResizeHandle→Separator(自带 aria-orientation,垂直态样式钩随之改向);
//   v2 的 autoSaveId 布局持久化在 v4 无直替(改走 defaultLayout+onLayoutChange 自管,
//   属特性重实现非编译修),本层剥除防其泄漏为未知 DOM 属性——分栏记忆退化记账 B3 残留
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "../../lib/utils";

const toPercentSize = (size: number | string | undefined) =>
  typeof size === "number" ? String(size) : size;

type ResizablePanelGroupProps = Omit<
  React.ComponentProps<typeof Group>,
  "orientation"
> & {
  direction?: "horizontal" | "vertical";
  autoSaveId?: string;
};

const ResizablePanelGroup = ({
  className,
  direction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- v2 遗留 prop,v4 已废,剥除防 DOM 泄漏
  autoSaveId,
  ...props
}: ResizablePanelGroupProps) => (
  <Group
    orientation={direction}
    data-orientation={direction}
    className={cn(
      "flex h-full w-full data-[orientation=vertical]:flex-col",
      className
    )}
    {...props}
  />
);

type ResizablePanelProps = Omit<
  React.ComponentProps<typeof Panel>,
  "defaultSize" | "minSize" | "maxSize"
> & {
  defaultSize?: number | string;
  minSize?: number | string;
  maxSize?: number | string;
};

const ResizablePanel = ({
  defaultSize,
  minSize,
  maxSize,
  ...props
}: ResizablePanelProps) => (
  <Panel
    defaultSize={toPercentSize(defaultSize)}
    minSize={toPercentSize(minSize)}
    maxSize={toPercentSize(maxSize)}
    {...props}
  />
);

const ResizableHandle = ({
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}) => (
  <Separator
    className={cn(
      // Wider handle so it's easy to grab with the mouse
      "relative flex w-2 items-center justify-center bg-border/50 hover:bg-primary/30 transition-colors",
      // Visible 1px divider line centered inside the handle
      "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border",
      // Vertical group handle styling(v4 Separator 自带 aria-orientation)
      "aria-[orientation=vertical]:h-2 aria-[orientation=vertical]:w-full",
      "aria-[orientation=vertical]:after:left-0 aria-[orientation=vertical]:after:top-1/2 aria-[orientation=vertical]:after:h-px aria-[orientation=vertical]:after:w-full aria-[orientation=vertical]:after:-translate-y-1/2 aria-[orientation=vertical]:after:translate-x-0",
      // Cursor
      "cursor-col-resize aria-[orientation=vertical]:cursor-row-resize",
      // Ensure handle stays clickable above panel content
      "z-20",
      className
    )}
    {...props}
  />
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
