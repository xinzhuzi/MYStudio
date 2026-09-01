// 超分「先去噪」三档选择(09-01 SeedVR2 接入;勾选框家族裁定——RadioGroup 非 Switch)。
// 三档:不处理(默认,存量行为) / 轻度滤波(秒级,纯代码) / SeedVR2 模型修复+去噪(约30秒,需 ComfyUI 运行)。
// 修复档内部在超分前自动接强档滤波(28/0.2)——7B sharp 修复保细节但不压噪,滤波补上降噪。

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export type UpscaleDenoiseMode = "off" | "light" | "seedvr2";

/** 档位 → hook 调用参数(restore 与 denoise 互斥,由档位唯一决定)。 */
export function denoiseModeToOpts(mode: UpscaleDenoiseMode): { denoise?: boolean; restore?: boolean } {
  if (mode === "light") return { denoise: true };
  if (mode === "seedvr2") return { restore: true };
  return {};
}

const MODE_LABELS: Record<UpscaleDenoiseMode, string> = {
  off: "不处理",
  light: "轻度滤波（秒级，压掉斑驳噪点再放大）",
  seedvr2: "SeedVR2 模型修复+去噪（约30秒/张，需 ComfyUI 运行中）",
};

export function UpscaleDenoiseModeField({
  value,
  onChange,
  className,
}: {
  value: UpscaleDenoiseMode;
  onChange: (next: UpscaleDenoiseMode) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5 rounded-md border border-border bg-muted/20 px-3 py-2", className)}>
      <div className="text-sm font-medium">先去噪</div>
      <RadioGroup value={value} onValueChange={(next) => onChange(next as UpscaleDenoiseMode)} className="gap-1.5">
        {(Object.keys(MODE_LABELS) as UpscaleDenoiseMode[]).map((mode) => (
          <label key={mode} className="flex cursor-pointer items-center gap-2 text-sm" data-upscale-denoise-mode={mode}>
            <RadioGroupItem value={mode} />
            <span className={cn(mode === "seedvr2" && "text-muted-foreground")}>{MODE_LABELS[mode]}</span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}
