import { Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  GPT_IMAGE_SIZE_MAP,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  getImageSizeLabel,
} from "@/lib/ai/image-size-presets";
import type { ImageGenerationSettings } from "@/stores/app-settings-store";

type ImageSizeSettingsTabProps = {
  settings: ImageGenerationSettings;
  onChange: (settings: Partial<ImageGenerationSettings>) => void;
};

export function ImageSizeSettingsTab({ settings, onChange }: ImageSizeSettingsTabProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              图片规格
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              统一控制资产库、剧本资产和自由生图默认规格；显式选择过比例的业务流程会优先使用自己的设置。
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-right">
            <div className="text-xs text-muted-foreground">当前默认输出</div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {getImageSizeLabel({
                aspectRatio: settings.defaultAspectRatio,
                resolution: settings.defaultResolution,
              })}
            </div>
            <div className="text-xs text-muted-foreground">
              {settings.defaultAspectRatio} · {settings.defaultResolution}
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-xl border border-border bg-card p-5 space-y-5">
            <div>
              <div className="text-sm font-semibold text-foreground">默认生图规格</div>
              <div className="mt-1 text-xs text-muted-foreground">
                未传入 `aspectRatio / resolution` 的生图请求会使用这里的默认值。
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">默认画幅比例</Label>
              <div className="flex flex-wrap gap-2">
                {IMAGE_ASPECT_RATIOS.map((ratio) => (
                  <Button
                    key={ratio}
                    type="button"
                    variant={settings.defaultAspectRatio === ratio ? "default" : "outline"}
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => onChange({ defaultAspectRatio: ratio })}
                  >
                    {ratio}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">默认分辨率</Label>
              <div className="flex flex-wrap gap-2">
                {IMAGE_RESOLUTIONS.map((resolution) => (
                  <Button
                    key={resolution}
                    type="button"
                    variant={settings.defaultResolution === resolution ? "default" : "outline"}
                    size="sm"
                    className="h-8 px-4 text-xs"
                    onClick={() => onChange({ defaultResolution: resolution })}
                  >
                    {resolution}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-foreground">兼容重试</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  网络失败或供应商临时错误时，使用更保守的规格重试一次。
                </div>
              </div>
              <Switch
                checked={settings.compatibilityRetryEnabled}
                onCheckedChange={(checked) => onChange({ compatibilityRetryEnabled: checked })}
              />
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">重试输出</div>
              <div className="mt-1 text-base font-semibold text-foreground">
                {getImageSizeLabel({
                  aspectRatio: settings.compatibilityRetryAspectRatio,
                  resolution: settings.compatibilityRetryResolution,
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">重试比例</Label>
              <div className="flex flex-wrap gap-2">
                {IMAGE_ASPECT_RATIOS.map((ratio) => (
                  <Button
                    key={ratio}
                    type="button"
                    variant={settings.compatibilityRetryAspectRatio === ratio ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    disabled={!settings.compatibilityRetryEnabled}
                    onClick={() => onChange({ compatibilityRetryAspectRatio: ratio })}
                  >
                    {ratio}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">重试分辨率</Label>
              <div className="flex flex-wrap gap-2">
                {IMAGE_RESOLUTIONS.map((resolution) => (
                  <Button
                    key={resolution}
                    type="button"
                    variant={settings.compatibilityRetryResolution === resolution ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-3 text-[11px]"
                    disabled={!settings.compatibilityRetryEnabled}
                    onClick={() => onChange({ compatibilityRetryResolution: resolution })}
                  >
                    {resolution}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4">
            <div className="text-sm font-semibold text-foreground">GPT Image 规格矩阵</div>
            <div className="mt-1 text-xs text-muted-foreground">
              GPT Image 请求会把比例和分辨率转换为标准 `size` 字段；其他供应商可能继续使用 `aspect_ratio / resolution`。
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="border-b border-border px-3 py-2 font-medium">比例</th>
                  {IMAGE_RESOLUTIONS.map((resolution) => (
                    <th key={resolution} className="border-b border-border px-3 py-2 font-medium">{resolution}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {IMAGE_ASPECT_RATIOS.map((ratio) => (
                  <tr key={ratio}>
                    <td className="border-b border-border/60 px-3 py-2 font-medium text-foreground">{ratio}</td>
                    {IMAGE_RESOLUTIONS.map((resolution) => (
                      <td key={resolution} className="border-b border-border/60 px-3 py-2 text-muted-foreground">
                        {GPT_IMAGE_SIZE_MAP[ratio][resolution]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
