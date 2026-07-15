import type { ReactNode } from "react";
import { Info, Layers, Link2, Play, RotateCcw, ShieldAlert, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type { AdvancedGenerationOptions } from "@/stores/api-config-store";

type AdvancedSettingsTabProps = {
  options: AdvancedGenerationOptions;
  onChange: <K extends keyof AdvancedGenerationOptions>(
    key: K,
    value: AdvancedGenerationOptions[K],
  ) => void;
  onReset: () => void;
};

type AdvancedOptionRowProps = {
  icon: ReactNode;
  title: string;
  description: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  muted?: boolean;
};

function AdvancedOptionRow({
  icon,
  title,
  description,
  hint,
  checked,
  onCheckedChange,
  muted = false,
}: AdvancedOptionRowProps) {
  return (
    <div className="p-4 border border-border rounded-xl bg-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={muted
            ? "p-2 rounded-lg bg-muted text-muted-foreground mt-0.5"
            : "p-2 rounded-lg bg-primary/10 text-primary mt-0.5"}
          >
            {icon}
          </div>
          <div>
            <h4 className="font-medium text-foreground">{title}</h4>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
            <p className="text-xs text-muted-foreground/70 mt-1">{hint}</p>
          </div>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </div>
  );
}

export function AdvancedSettingsTab({ options, onChange, onReset }: AdvancedSettingsTabProps) {
  const handleReset = () => {
    onReset();
    toast.success("已恢复默认设置");
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Layers className="h-5 w-5" />
              高级生成选项
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              这些选项影响 AI 导演板块的视频生成行为
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-1" />
            恢复默认
          </Button>
        </div>

        <div className="space-y-4">
          <AdvancedOptionRow
            icon={<Link2 className="h-5 w-5" />}
            title="视觉连续性"
            description="自动将上一分镜的尾帧传递给下一分镜作为参考图，保持视觉风格和角色外观的一致性"
            hint="默认开启 · 适合连续叙事和长视频创作"
            checked={options.enableVisualContinuity}
            onCheckedChange={(checked) => onChange("enableVisualContinuity", checked)}
          />
          <AdvancedOptionRow
            icon={<Play className="h-5 w-5" />}
            title="断点续传"
            description="批量生成中断后可从上次位置继续，不需要重新开始"
            hint="默认开启 · 防止网络中断或 API 超时导致进度丢失"
            checked={options.enableResumeGeneration}
            onCheckedChange={(checked) => onChange("enableResumeGeneration", checked)}
          />
          <AdvancedOptionRow
            icon={<ShieldAlert className="h-5 w-5" />}
            title="内容审核容错"
            description="遇到敏感内容时自动跳过该分镜，继续生成其他分镜"
            hint="默认开启 · 避免单个分镜失败导致整个流程中断"
            checked={options.enableContentModeration}
            onCheckedChange={(checked) => onChange("enableContentModeration", checked)}
          />
          <AdvancedOptionRow
            icon={<Zap className="h-5 w-5" />}
            title="多模型自动切换"
            description="首分镜使用文生视频 (t2v)，后续分镜使用图生视频 (i2v)"
            hint="默认关闭 · 需要配置多个模型才能使用"
            checked={options.enableAutoModelSwitch}
            onCheckedChange={(checked) => onChange("enableAutoModelSwitch", checked)}
            muted
          />
        </div>

        <div className="flex items-start gap-3 p-4 bg-muted/50 border border-border rounded-lg">
          <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            这些选项会影响 AI 导演板块的视频生成行为。如果你不确定某个选项的作用，建议保持默认设置。
          </p>
        </div>
      </div>
    </ScrollArea>
  );
}
