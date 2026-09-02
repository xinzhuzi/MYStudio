import { useEffect, useRef } from "react";
import { Copy, Trash2 } from "lucide-react";
import { CONTEXT_MENU_ARRIVAL_CLASS, contextMenuPosition } from "./context-menu-craft";

/**
 * 节点右键菜单(09-02,交互形态参考 infinite-canvas CanvasNodeContextMenu,实现从零/AGPL):
 * 右键节点 → 复制(同类型携字段,落右下偏移)/删除。房子样式+键盘可达。
 */
export function NodeContextMenu({
  x,
  y,
  onDuplicate,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="节点操作"
      className={`fixed z-50 min-w-40 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl backdrop-blur-md ${CONTEXT_MENU_ARRIVAL_CLASS}`}
      style={contextMenuPosition(x, y, 180, 100)}
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
        const delta = event.key === "ArrowDown" ? 1 : -1;
        buttons[(current + delta + buttons.length) % buttons.length]?.focus();
      }}
    >
      <button
        type="button"
        role="menuitem"
        data-option
        ref={firstRef}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70"
        onClick={() => {
          onDuplicate();
          onClose();
        }}
      >
        <Copy className="h-4 w-4 text-muted-foreground" />
        <span className="text-popover-foreground">复制</span>
      </button>
      <button
        type="button"
        role="menuitem"
        data-option
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
        <span className="text-destructive">删除</span>
      </button>
    </div>
  );
}
