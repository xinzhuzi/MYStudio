import { useState, type CSSProperties } from "react";
import { Check, Sparkles, Sliders, Moon, Sun, Grid, Shield, Zap } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { COLOR_PRESETS, useThemeStore, type ColorPresetId } from "@/stores/app/theme-store";
import { cn } from "@/lib/utils";

type PresetCardStyle = CSSProperties & {
  "--preset-color": string;
  "--preset-accent": string;
  "--preset-gradient": string;
};

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
  const {
    theme,
    colorPreset,
    setColorPreset,
    enableCyberGrid,
    enableFilmVignette,
    enableScanlines,
    toggleCyberGrid,
    toggleFilmVignette,
    toggleScanlines,
  } = useThemeStore();

  const [filterMode, setFilterMode] = useState<"all" | "dark" | "light">("all");

  const activeColorPreset = COLOR_PRESETS.find((preset) => preset.id === colorPreset);

  const filteredPresets = COLOR_PRESETS.filter((preset) => {
    if (filterMode === "dark") return preset.mode === "dark";
    if (filterMode === "light") return preset.mode === "light";
    return true;
  });

  return (
    <ScrollArea className="h-full">
      <div className="appearance-panel p-8 w-full space-y-8">
        {/* Top Hero Banner */}
        <div className="appearance-hero">
          <div className="appearance-hero-copy">
            <div className="appearance-kicker">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>Studio Look & Atmosphere</span>
            </div>
            <h3 className="appearance-title">外观皮肤</h3>
            <p className="appearance-subtitle">
              以顶级电影调色台（Color Grading Suite）的视觉规范为基础；每套皮肤拥有独立的三重光彩渐变、主强调色调与微光气场，全局背景、控制台面板及高亮视感自动跟随。
            </p>
          </div>

          <div className="appearance-current-card relative overflow-hidden border border-border/80 shadow-2xl">
            <div
              className="absolute inset-0 opacity-20 pointer-events-none transition-all duration-700"
              style={{ background: activeColorPreset?.gradient }}
            />
            <span className="appearance-current-label flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              当前生效皮肤
            </span>
            <strong className="text-xl tracking-tight text-foreground">{activeColorPreset?.name}</strong>
            <p className="text-xs text-muted-foreground mt-1">
              {theme === "dark" ? "电影暗场 LUT" : "日间高亮制片"} · {activeColorPreset?.description}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span
                  className="w-5 h-5 rounded-full border border-white/20 shadow-sm"
                  style={{ backgroundColor: activeColorPreset?.color }}
                  title="主调色"
                />
                <span
                  className="w-5 h-5 rounded-full border border-white/20 shadow-sm"
                  style={{ backgroundColor: activeColorPreset?.accentColor }}
                  title="强调色"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeColorPreset?.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Filter Controls & Atmosphere Options */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-4">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-primary" />
              <h4 className="text-sm font-bold tracking-wide text-foreground">皮肤调色方案 ({filteredPresets.length})</h4>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-panel border border-border/60">
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                  filterMode === "all"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                )}
              >
                <span>全部预设 ({COLOR_PRESETS.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("dark")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                  filterMode === "dark"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                )}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>电影暗场 ({COLOR_PRESETS.filter((p) => p.mode === "dark").length})</span>
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("light")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                  filterMode === "light"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                )}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>日间/护眼 ({COLOR_PRESETS.filter((p) => p.mode === "light").length})</span>
              </button>
            </div>
          </div>

          {/* Preset Cards Grid */}
          <div className="appearance-preset-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredPresets.map((preset) => {
              const isActive = colorPreset === preset.id;
              const presetStyle = {
                "--preset-color": preset.color,
                "--preset-accent": preset.accentColor,
                "--preset-gradient": preset.gradient,
              } as PresetCardStyle;

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setColorPreset(preset.id as ColorPresetId)}
                  className={cn(
                    "settings-preset-card appearance-preset-card group relative text-left rounded-2xl border bg-card/90 overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-primary",
                    isActive && "is-active ring-2 ring-primary border-primary shadow-xl"
                  )}
                  data-mode={preset.mode}
                  style={presetStyle}
                >
                  {/* Radiant Gradient Header Strip */}
                  <div
                    className="h-16 w-full relative overflow-hidden transition-opacity group-hover:opacity-100"
                    style={{ background: preset.gradient }}
                  >
                    <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
                    <div className="absolute top-3 left-4 right-4 flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-black/50 text-white border border-white/20 backdrop-blur-md">
                        {preset.mode === "dark" ? "Dark Cinema" : "Light Mode"}
                      </span>
                      {isActive && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500 text-black shadow-lg animate-bounce">
                          <Check className="w-3 h-3 stroke-[3]" /> 生效中
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h5 className="font-extrabold text-sm text-foreground group-hover:text-primary transition-colors">
                          {preset.name}
                        </h5>
                        <span className="text-[11px] font-bold text-muted-foreground">
                          {getPresetUsageTone(preset.id)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                        <span
                          className="w-4 h-4 rounded-full border border-border shadow-inner"
                          style={{ backgroundColor: preset.color }}
                          title={`主色 ${preset.color}`}
                        />
                        <span
                          className="w-4 h-4 rounded-full border border-border shadow-inner"
                          style={{ backgroundColor: preset.accentColor }}
                          title={`强调色 ${preset.accentColor}`}
                        />
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed min-h-[36px]">
                      {preset.description}
                    </p>

                    {/* Palette Tags */}
                    <div className="flex flex-wrap gap-1 pt-1">
                      {preset.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-secondary text-secondary-foreground/80 group-hover:border-primary/30 border border-transparent transition-colors"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Atmosphere & Visual Toggles Section */}
        <div className="border border-border/60 rounded-2xl p-6 bg-card/60 backdrop-blur-md space-y-5">
          <div className="flex items-center gap-2 border-b border-border/40 pb-3">
            <Zap className="w-4 h-4 text-amber-400" />
            <h4 className="text-sm font-bold tracking-wide text-foreground">皮肤视觉特效与网格氛围 (Visual Atmosphere)</h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Cyber Grid Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-panel/50 hover:border-primary/40 transition-colors">
              <div className="space-y-0.5 pr-3">
                <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                  <Grid className="w-3.5 h-3.5 text-primary" />
                  <span>数码脉冲网格</span>
                </div>
                <p className="text-[11px] text-muted-foreground">暗场下的《黑客帝国》/电影监看背景网纹</p>
              </div>
              <button
                type="button"
                onClick={toggleCyberGrid}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                  enableCyberGrid ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                    enableCyberGrid ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            {/* Film Vignette Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-panel/50 hover:border-primary/40 transition-colors">
              <div className="space-y-0.5 pr-3">
                <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  <span>胶片暗角与齿孔</span>
                </div>
                <p className="text-[11px] text-muted-foreground">模拟物理 35mm 胶片边框与监视器噪点</p>
              </div>
              <button
                type="button"
                onClick={toggleFilmVignette}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                  enableFilmVignette ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                    enableFilmVignette ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            {/* Laser Scanlines Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-panel/50 hover:border-primary/40 transition-colors">
              <div className="space-y-0.5 pr-3">
                <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>动态激光扫描线</span>
                </div>
                <p className="text-[11px] text-muted-foreground">屏幕缓缓滑过的激光光束扫过效果</p>
              </div>
              <button
                type="button"
                onClick={toggleScanlines}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                  enableScanlines ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                    enableScanlines ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="appearance-note text-xs text-muted-foreground flex items-center justify-between">
          <span>当前：{theme === "dark" ? "电影暗色" : "护眼浅色"} · {activeColorPreset?.name}</span>
          <span className="font-mono text-[11px] opacity-70">LUT-ID: {activeColorPreset?.id}</span>
        </div>
      </div>
    </ScrollArea>
  );
}

