// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useEffect, useRef } from "react";
import { Copy, Eraser, Trash2 } from "lucide-react";
import { CONTEXT_MENU_ARRIVAL_CLASS, useContextMenuClamp } from "./context-menu-craft";

/**
 * 节点右键菜单(09-02 终裁格式统一):与创建菜单/工具栏下拉同一种格式
 * ——单行项、同尺寸比例、无多余文字。复制(同类型携字段,落右下偏移)/删除。
 */
const ITEM_CLASS =
  "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70 [&>svg]:size-4 [&>svg]:shrink-0";

export function NodeContextMenu({
  x,
  y,
  onDuplicate,
  onClear,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onDuplicate: () => void;
  onClear: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const rootRef = useContextMenuClamp({ x, y });
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    firstRef.current?.focus();
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
      aria-label="节点操作"
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
      <button
        type="button"
        role="menuitem"
        data-option
        ref={firstRef}
        className={ITEM_CLASS}
        onClick={() => {
          onDuplicate();
          onClose();
        }}
      >
        <Copy className="text-muted-foreground" />
        <span className="text-popover-foreground">复制</span>
      </button>
      <button
        type="button"
        role="menuitem"
        data-option
        className={ITEM_CLASS}
        title="清空提示词与已生成图片(节点保留)"
        onClick={() => {
          onClear();
          onClose();
        }}
      >
        <Eraser className="text-muted-foreground" />
        <span className="text-popover-foreground">清空内容</span>
      </button>
      <button
        type="button"
        role="menuitem"
        data-option
        className={ITEM_CLASS}
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Trash2 className="text-destructive" />
        <span className="text-destructive">删除</span>
      </button>
    </div>
  );
}
