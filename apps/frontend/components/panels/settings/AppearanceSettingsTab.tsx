import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { COLOR_PRESETS, useThemeStore } from "@/stores/theme-store";
import { cn } from "@/lib/utils";

type PresetCardStyle = CSSProperties & { "--preset-color": string };

function getPresetUsageTone(presetId: string): string {
  switch (presetId) {
    case "eyeCare": return "长写作";
    case "warmPaper": return "剧本文档";
    case "sageInk": return "素材归档";
    case "neutral": return "白天剪辑";
    case "blueprint": return "流程配置";
    case "mist": return "参数表格";
    case "porcelain": return "展示概览";
    case "lavender": return "创意资产";
    case "cinema": return "暗场制片";
    case "graphite": return "多轨剪辑";
    case "midnight": return "夜间预览";
    case "ink": return "沉浸分镜";
    case "ember": return "氛围概念";
    default: return "工作台";
  }
}

export function AppearanceSettingsTab() {
  const { theme, colorPreset, setColorPreset } = useThemeStore();
  const activeColorPreset = COLOR_PRESETS.find((preset) => preset.id === colorPreset);

  return (
    <ScrollArea className="h-full">
      <div className="appearance-panel p-8 w-full space-y-7">
        <div className="appearance-hero">
          <div className="appearance-hero-copy">
            <div className="appearance-kicker"><span /><span>Studio Look</span></div>
            <h3 className="appearance-title">外观皮肤</h3>
            <p className="appearance-subtitle">
              用电影调色台的方式选择工作台质感；每套皮肤只保留一个标准主色，背景、面板和文字层级自动跟随。
            </p>
          </div>
          <div className="appearance-current-card">
            <span className="appearance-current-label">当前皮肤</span>
            <strong>{activeColorPreset?.name}</strong>
            <p>{theme === "dark" ? "暗场工作台" : "护眼浅场"} · {activeColorPreset?.description}</p>
            <i className="appearance-current-swatch" style={{ backgroundColor: activeColorPreset?.color }} />
          </div>
        </div>

        <div className="appearance-preset-grid">
          {COLOR_PRESETS.map((preset) => {
            const isActive = colorPreset === preset.id;
            const presetStyle = { "--preset-color": preset.color } as PresetCardStyle;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setColorPreset(preset.id)}
                className={cn(
                  "settings-preset-card appearance-preset-card group text-left rounded-xl border bg-card transition-all",
                  isActive && "is-active",
                )}
                data-mode={preset.mode}
                style={presetStyle}
              >
                <div className="appearance-preset-preview" aria-hidden="true">
                  <div className="appearance-preview-topline"><span /><span /></div>
                  <div className="appearance-preview-stage"><i /><i /><i /></div>
                  <div className="appearance-preview-timeline"><span /><span /></div>
                </div>
                <div className="appearance-preset-body">
                  <div className="appearance-preset-title-row">
                    <div>
                      <span className="appearance-preset-name">{preset.name}</span>
                      <span className="appearance-preset-tone">{getPresetUsageTone(preset.id)}</span>
                    </div>
                    {isActive && <Check className="h-4 w-4 shrink-0" />}
                  </div>
                  <p>{preset.description}</p>
                  <div className="appearance-preset-footer">
                    <span className="appearance-mode-pill">{preset.mode === "dark" ? "暗色" : "浅色"}</span>
                    <span
                      className="appearance-single-swatch"
                      style={{ backgroundColor: preset.color }}
                      aria-label={`${preset.name} 标准主色`}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="appearance-note">
          当前：{theme === "dark" ? "暗色" : "浅色"} · {activeColorPreset?.name}
        </div>
      </div>
    </ScrollArea>
  );
}
