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
//   v2 的 autoSaveId 布局持久化 v4 无内建直替——本层 1010 重实现(v2 等价):
//   首渲染从 localStorage 复原为 defaultLayout,onLayoutChanged 时以
//   meta.requestedLayout(库文档推荐存储值)落盘;Layout 按面板 id 寻址,
//   启用持久化的组内面板须带稳定 id(消费面目前仅 ArtifactCenter)
import { useCallback, useState } from "react";
import {
  Group,
  Panel,
  Separator,
  type Layout,
  type LayoutChangedMeta,
} from "react-resizable-panels";

import { cn } from "../../lib/utils";

const toPercentSize = (size: number | string | undefined) =>
  typeof size === "number" ? String(size) : size;

const savedLayoutKey = (autoSaveId: string) => `manying:panel-layout:${autoSaveId}`;

const readSavedLayout = (autoSaveId: string | undefined): Layout | undefined => {
  if (!autoSaveId || typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(savedLayoutKey(autoSaveId));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Layout;
    }
  } catch {
    // 损坏存档弃用,回退 defaultSize
  }
  return undefined;
};

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
  autoSaveId,
  defaultLayout,
  onLayoutChanged,
  ...props
}: ResizablePanelGroupProps) => {
  // 初值仅首渲染读一次(记忆复原);此后每次布局变化即时落盘
  const [restoredLayout] = useState(() => readSavedLayout(autoSaveId));
  const persistLayout = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            savedLayoutKey(autoSaveId as string),
            JSON.stringify(meta.requestedLayout ?? layout),
          );
        } catch {
          // 隐私模式等写失败:仅弃存,不影响交互
        }
      }
    },
    [autoSaveId],
  );
  return (
    <Group
      orientation={direction}
      data-orientation={direction}
      className={cn(
        "flex h-full w-full data-[orientation=vertical]:flex-col",
        className
      )}
      defaultLayout={restoredLayout ?? defaultLayout}
      onLayoutChanged={
        autoSaveId
          ? (layout, meta) => {
              persistLayout(layout, meta);
              onLayoutChanged?.(layout, meta);
            }
          : onLayoutChanged
      }
      {...props}
    />
  );
};

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
