// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useEffect, useRef } from "react";
import { ImagePlus, Images, LayoutGrid, Maximize, Type, WandSparkles } from "lucide-react";
import { CONTEXT_MENU_ARRIVAL_CLASS, useContextMenuClamp } from "./context-menu-craft";

/**
 * 画布右键创建菜单(09-02 终裁格式统一):与工具栏下拉/节点菜单同一种格式
 * ——单行项(图标+名称)、同尺寸比例、无说明文字/无标题/无关闭钮,与
 * ui/dropdown-menu 项类名逐字对齐。右键空白弹出,选中后在落点创建;
 * 键盘 ↑↓/Enter/ESC 可达。
 */
export type PaneCreateKind = "generation-group" | "generation-group-i2i" | "reference" | "prompt";
export type PaneCanvasAction = "tidy-layout" | "fit-view";

const ITEM_CLASS =
  "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70 [&>svg]:size-4 [&>svg]:shrink-0";

const CREATE_ITEMS: { kind: PaneCreateKind; label: string; icon: React.ReactNode }[] = [
  { kind: "generation-group", label: "文生图", icon: <WandSparkles className="text-muted-foreground" /> },
  { kind: "generation-group-i2i", label: "图生图", icon: <Images className="text-muted-foreground" /> },
  { kind: "reference", label: "参考图", icon: <ImagePlus className="text-muted-foreground" /> },
  { kind: "prompt", label: "提示词", icon: <Type className="text-muted-foreground" /> },
];

const ACTION_ITEMS: { action: PaneCanvasAction; label: string; icon: React.ReactNode }[] = [
  { action: "tidy-layout", label: "整理布局", icon: <LayoutGrid className="text-muted-foreground" /> },
  { action: "fit-view", label: "适配画布", icon: <Maximize className="text-muted-foreground" /> },
];

export function PaneCreateMenu({
  x,
  y,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  onSelect: (kind: PaneCreateKind | PaneCanvasAction) => void;
  onClose: () => void;
}) {
  const rootRef = useContextMenuClamp({ x, y });
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const first = rootRef.current?.querySelector<HTMLButtonElement>("button[data-option]");
    first?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
    // rootRef 来自 useContextMenuClamp 内部 useRef,跨渲染稳定;onClose 经 ref
    // 透传,父组件 inline arrow 重渲染不再重挂监听抢回焦点
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="创建节点"
      className={`fixed z-50 min-w-40 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-xl backdrop-blur-md ${CONTEXT_MENU_ARRIVAL_CLASS}`}
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-option]"),
        );
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        // 未聚焦时 ArrowDown=首项、ArrowUp=末项((-1-1+n)%n 会跳过末项)
        const nextIndex =
          current < 0
            ? event.key === "ArrowDown"
              ? 0
              : buttons.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
      }}
    >
      {CREATE_ITEMS.map((item) => (
        <button
          key={item.kind}
          type="button"
          role="menuitem"
          data-option
          className={ITEM_CLASS}
          onClick={() => {
            onSelect(item.kind);
            onClose();
          }}
        >
          {item.icon}
          <span className="text-popover-foreground">{item.label}</span>
        </button>
      ))}
      <div className="mx-2 my-1 h-px bg-border" />
      {ACTION_ITEMS.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          data-option
          className={ITEM_CLASS}
          onClick={() => {
            onSelect(item.action);
            onClose();
          }}
        >
          {item.icon}
          <span className="text-popover-foreground">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
