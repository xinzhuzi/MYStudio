import { useEffect, useRef } from "react";
import { ImagePlus, Type, WandSparkles, X } from "lucide-react";

/**
 * 画布右键创建菜单(09-02,交互形态参考 infinite-canvas NodeCreateMenu,实现从零/AGPL):
 * 右键空白处弹出,列出可建节点类型,选中后在**右键落点**创建。
 * 房子样式(bg-popover 弹层材质+design-lint 白名单内);键盘可达(↑↓/Enter/ESC)。
 */
export type PaneCreateKind = "generation-group" | "reference" | "prompt";

export interface PaneCreateOption {
  kind: PaneCreateKind;
  label: string;
  description: string;
  icon: React.ReactNode;
}

export const PANE_CREATE_OPTIONS: readonly PaneCreateOption[] = [
  {
    kind: "generation-group",
    label: "文生图",
    description: "提示词+成图一组,落点为成图位",
    icon: <WandSparkles className="h-4 w-4 text-muted-foreground" />,
  },
  {
    kind: "reference",
    label: "参考图",
    description: "空参考图节点,再挑图",
    icon: <ImagePlus className="h-4 w-4 text-muted-foreground" />,
  },
  {
    kind: "prompt",
    label: "提示词",
    description: "独立提示词节点",
    icon: <Type className="h-4 w-4 text-muted-foreground" />,
  },
] as const;

export function PaneCreateMenu({
  x,
  y,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  onSelect: (kind: PaneCreateKind) => void;
  onClose: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

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
        aria-label="创建节点"
        className="absolute min-w-60 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg backdrop-blur-md"
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
          const delta = event.key === "ArrowDown" ? 1 : -1;
          buttons[(current + delta + buttons.length) % buttons.length]?.focus();
        }}
      >
        <div className="flex items-center justify-between px-2 pb-1 pt-0.5">
          <span className="text-xs text-muted-foreground">在此处创建</span>
          <button
            type="button"
            aria-label="关闭"
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {PANE_CREATE_OPTIONS.map((option, index) => (
          <button
            key={option.kind}
            type="button"
            role="menuitem"
            data-option
            ref={index === 0 ? firstRef : undefined}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70"
            onClick={() => {
              onSelect(option.kind);
              onClose();
            }}
          >
            {option.icon}
            <span className="min-w-0">
              <span className="block text-sm font-medium text-popover-foreground">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.description}</span>
            </span>
          </button>
        ))}
      </div>
  );
}
