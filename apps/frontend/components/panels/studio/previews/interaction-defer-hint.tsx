// @vitest-environment jsdom
import { useEffect, useReducer } from "react";
import { Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getInteractionDeferInfo,
  useInteractionDeferPhase,
} from "./interaction-defer";

/**
 * 交互暂停加载提示(用户裁定 2026-08-26:暂停要可感知)。
 * 交互进行中:「交互中 · 已暂停加载」;停手后:「Ns 后加载图片」倒计时,
 * 倒计时归零开闸加载,提示自动消失。闸开时返回 null,不占布局。
 */
export function InteractionDeferHint({ className }: { className?: string }) {
  const phase = useInteractionDeferPhase();
  const [, forceTick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (phase === "idle") return;
    // 250ms 心跳驱动倒计时秒数刷新(门闸通知只覆盖相位切换,不含秒跳)
    const ticker = setInterval(forceTick, 250);
    return () => clearInterval(ticker);
  }, [phase]);

  if (phase === "idle") return null;

  const info = getInteractionDeferInfo();
  const remainSeconds = Math.ceil(info.remainMs / 1000);
  return (
    <span
      data-interaction-defer-hint={info.settling ? "settling" : "active"}
      className={cn(
        "pointer-events-none inline-flex items-center gap-1.5 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] font-medium leading-none text-muted-foreground backdrop-blur-sm",
        className,
      )}
    >
      <Hourglass className="h-3 w-3 shrink-0 animate-pulse" aria-hidden />
      {info.settling ? `${remainSeconds}s 后加载图片` : "交互中 · 已暂停加载"}
    </span>
  );
}
