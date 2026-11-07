// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 出片即响(11-06 render-notify):出片完成通知的声音开关,默认关。
// 自持组件:直接读写 app-settings-store(外观页签尾部挂载,零 props 侵入宿主)。
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";

export function NotificationsSettingsSection() {
  const enabled = useAppSettingsStore((s) => s.notifications.renderCompleteSound);
  const setNotifications = useAppSettingsStore((s) => s.setNotifications);

  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-panel/50 hover:border-primary/40 transition-colors">
      <div className="space-y-0.5 pr-3">
        <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
          <Volume2 className="w-3.5 h-3.5 text-success" />
          <span>出片完成提示音</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          章节/单镜出片完成的后台系统通知提示音;前台时仅悬浮球徽标提醒
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => setNotifications({ renderCompleteSound: !enabled })}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
          enabled ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white ring-0 transition duration-200 ease-in-out",
            enabled ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}
