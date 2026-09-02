import { useEffect, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 画布新手指引(09-02 可发现性补):首次打开画布时在右下角浮出操作速查卡,
 * 可关闭且偏好记忆(每台设备只出一次);工具栏「?」按钮随时唤回。
 * 内容=画布五条核心手势,零行抄写。
 */
const HINTS_PREF_KEY = "studio-image-canvas-hints-dismissed";

const HINTS: ReadonlyArray<{ icon: string; title: string; body: string }> = [
  { icon: "🖱️", title: "建节点", body: "右键画布空白处,选文生图/参考图/提示词,落在右键位置;工具栏按钮也可" },
  { icon: "🔗", title: "连线", body: "拖节点右侧圆点到另一个节点;拖到空白处松手=快速建下游节点" },
  { icon: "⌨️", title: "撤销/复制", body: "⌘Z 撤销 / ⌘⇧Z 重做 / Ctrl+C·V 复制粘贴节点 / Delete 删除选中" },
  { icon: "🔍", title: "导航", body: "触控板双指缩放/拖移;右键拖动平移画布,右键点空白弹创建菜单;框选空白拖出多选;右下小地图可点跳" },
  { icon: "✂️", title: "取材", body: "节点右上角图标:裁剪/切图/局部重绘/反推提示词,结果自动落回画布" },
];

export function CanvasHints() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(HINTS_PREF_KEY) !== "1");
    } catch {
      setOpen(true);
    }
  }, []);

  const dismiss = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(HINTS_PREF_KEY, "1");
    } catch {
      // localStorage 不可用时仅会话内关闭
    }
  };

  return (
    <>
      <Button
        size="icon"
        variant="outline"
        aria-label="画布操作指引"
        title="画布怎么用?点开速查"
        className="absolute bottom-3 right-3 z-20 h-9 w-9 rounded-lg border-border/80 bg-card/90 backdrop-blur-md"
        onClick={() => setOpen((value) => !value)}
      >
        <HelpCircle className="h-4 w-4" />
      </Button>
      {open ? (
        <div
          className="absolute bottom-14 right-3 z-20 w-80 rounded-lg border border-border bg-popover p-3 shadow-lg backdrop-blur-md"
          data-canvas-hints
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-popover-foreground">画布速查</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="关闭指引"
              className="h-6 w-6 text-muted-foreground"
              onClick={dismiss}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-2">
            {HINTS.map((hint) => (
              <div key={hint.title} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-sm" aria-hidden>{hint.icon}</span>
                <div className="min-w-0">
                  <span className="block text-xs font-medium text-popover-foreground">{hint.title}</span>
                  <span className="block text-[11px] leading-4 text-muted-foreground">{hint.body}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
            关闭后可随时点右下角「?」重新打开
          </div>
        </div>
      ) : null}
    </>
  );
}
