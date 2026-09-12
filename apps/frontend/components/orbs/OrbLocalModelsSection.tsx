"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 「本地模型」模块分区(09-11 中转枢纽裁定):该模块的不同模型表现效果
// (ComfyUI 画布 / 配音室 TTS)在球内成区展示;任何视图点条目=跳本地模型并直切该模式
// (在本地模型视图内=纯模式切换)。当前模式高亮=模块状态一览。

import { ImagePlus, Mic, Palette } from "lucide-react";
import { OrbSection, type OrbSectionProps } from "./OrbSection";
import type { StudioMode } from "@/stores/assist/freedom-store";
import { cn } from "@/lib/utils";

const MODE_ENTRIES: ReadonlyArray<{ id: StudioMode; label: string; icon: typeof Palette }> = [
  { id: "generate", label: "生图", icon: ImagePlus },
  { id: "comfy", label: "ComfyUI 画布", icon: Palette },
  { id: "tts", label: "配音室", icon: Mic },
];

/** 「本地模型」模块分区:生图/画布/配音室(模型表现效果),点击=跳模块+切模式。 */
export function OrbLocalModelsSection({
  activeMode,
  onModeSelect,
  open,
  onToggle,
}: Pick<OrbSectionProps, "open" | "onToggle"> & {
  activeMode: StudioMode;
  onModeSelect: (mode: StudioMode) => void;
}) {
  return (
    <OrbSection section="local-models" title="本地模型" open={open} onToggle={onToggle}>
      <div className="grid grid-cols-3 gap-1">
        {MODE_ENTRIES.map((item) => (
          <button
            key={item.id}
            type="button"
            data-orb-nav-mode={item.id}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
              item.id === activeMode
                ? "bg-accent/60 text-foreground"
                : "text-muted-foreground",
            )}
            onClick={() => onModeSelect(item.id)}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </OrbSection>
  );
}
