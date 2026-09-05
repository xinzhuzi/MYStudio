import { useEffect, useRef } from "react";
import "./image-workflow-connect-create-menu.css";
import { FileText, Image as ImageIcon, Images, Shirt } from "lucide-react";
import type { ConnectCreatableTypeOption } from "@/lib/studio/image-workflow/connect-create";

/**
 * 连接落空创建菜单(08-31-canvas-connect-create-menu):
 * 拖连线落到画布空白处时,在落点弹出的「创建节点并连接」候选菜单。
 * fixed 定位按屏幕坐标锚定(不依赖画布定位祖先);键盘可达:
 * 自动聚焦首项,↑↓ 在选项间移动,Enter 激活,ESC/点击遮罩关闭。
 */
const TYPE_ICONS = {
  generated: ImageIcon,
  prompt: FileText,
  reference: Images,
  uncloth: Shirt,
} as const;

export function ImageWorkflowConnectCreateMenu({
  x,
  y,
  options,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  options: ConnectCreatableTypeOption[];
  onSelect: (type: ConnectCreatableTypeOption["type"]) => void;
  onClose: () => void;
}) {
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstButtonRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50"
      data-connect-create-menu
      onPointerDown={onClose}
    >
      <div
        role="menu"
        aria-label="创建节点并连接"
        className="connect-create-menu absolute min-w-56 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg"
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
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button[data-option]",
            ),
          );
          const currentIndex = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const delta = event.key === "ArrowDown" ? 1 : -1;
          const next =
            buttons[(currentIndex + delta + buttons.length) % buttons.length];
          next?.focus();
        }}
      >
        {options.map((option, index) => {
          const Icon = TYPE_ICONS[option.type];
          return (
            <button
              key={option.type}
              type="button"
              role="menuitem"
              data-option
              ref={index === 0 ? firstButtonRef : undefined}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-card-foreground transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70"
              onClick={() => {
                onSelect(option.type);
                onClose();
              }}
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
