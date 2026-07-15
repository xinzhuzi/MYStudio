import type { ChangeEventHandler } from "react";
import { Box, Check, Copy, Image as ImageIcon, Loader2, Scissors, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StylePicker } from "@/components/ui/style-picker";
import { Textarea } from "@/components/ui/textarea";
import type { VisualStyleId } from "@/lib/constants/visual-styles";
import { useSceneStore, type Scene } from "@/stores/scene-store";
import type { PromptLanguage } from "@/types/script";
import type { OrthographicViews } from "./generation-panel-utils";

interface OrthographicGenerationViewProps {
  selectedScene: Scene | null;
  styleId: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  promptZh: string | null;
  promptLanguage: PromptLanguage;
  image: string | null;
  views: OrthographicViews;
  isGenerating: boolean;
  progress: number;
  isSplitting: boolean;
  onStyleChange: (styleId: VisualStyleId) => void;
  onAspectRatioChange: (aspectRatio: "16:9" | "9:16") => void;
  onPromptChange: (value: string, isZh: boolean) => void;
  onCancel: () => void;
  onGenerate: () => void;
  onUpload: ChangeEventHandler<HTMLInputElement>;
  onCopyPrompt: (useEnglish: boolean) => void;
  onSplit: () => void;
  onSave: () => void;
}

function resolveReferenceImages(selectedScene: Scene | null) {
  const referenceImages: { label: string; src: string }[] = [];
  let overviewImage: string | null = null;

  if (selectedScene?.parentSceneId) {
    const { scenes } = useSceneStore.getState();
    const overviewScene = scenes.find((scene) =>
      scene.parentSceneId === selectedScene.parentSceneId && scene.viewpointId === "overview"
    );
    overviewImage = overviewScene?.referenceImage || overviewScene?.referenceImageBase64 || null;

    if (!overviewImage) {
      const overviewByName = scenes.find((scene) =>
        scene.parentSceneId === selectedScene.parentSceneId
        && (scene.name?.includes("全景") || scene.viewpointName === "全景")
      );
      overviewImage = overviewByName?.referenceImage || overviewByName?.referenceImageBase64 || null;
    }
  }

  if (overviewImage) {
    referenceImages.push({ label: "全景参考", src: overviewImage });
  }
  if (selectedScene?.referenceImage && selectedScene.referenceImage !== overviewImage) {
    referenceImages.push({ label: "当前视角", src: selectedScene.referenceImage });
  } else if (selectedScene?.referenceImageBase64 && selectedScene.referenceImageBase64 !== overviewImage) {
    referenceImages.push({ label: "当前视角", src: selectedScene.referenceImageBase64 });
  }

  return referenceImages;
}

export function OrthographicGenerationView({
  selectedScene,
  styleId,
  aspectRatio,
  prompt,
  promptZh,
  promptLanguage,
  image,
  views,
  isGenerating,
  progress,
  isSplitting,
  onStyleChange,
  onAspectRatioChange,
  onPromptChange,
  onCancel,
  onGenerate,
  onUpload,
  onCopyPrompt,
  onSplit,
  onSave,
}: OrthographicGenerationViewProps) {
  const referenceImages = resolveReferenceImages(selectedScene);
  const isZh = promptLanguage === "zh" || promptLanguage === "zh+en";
  const langLabel = isZh ? "中文" : "English";
  const currentPrompt = isZh ? (promptZh || prompt) : (prompt || promptZh || "");
  const hasViews = views.front || views.back || views.left || views.right;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 pb-2 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4" />
          <h3 className="font-medium text-sm">四视图（正交视图）</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>取消</Button>
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-xs">视觉风格</Label>
              <StylePicker value={styleId} onChange={onStyleChange} disabled={isGenerating} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">宽高比</Label>
              <Select
                value={aspectRatio}
                onValueChange={(value) => onAspectRatioChange(value as "16:9" | "9:16")}
                disabled={isGenerating}
              >
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 横屏</SelectItem>
                  <SelectItem value="9:16">9:16 竖屏</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">视角布局 (2x2)</Label>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {[
                ["正面", "Front View"],
                ["背面", "Back View"],
                ["左侧", "Left Profile"],
                ["右侧", "Right Profile"],
              ].map(([name, englishName]) => (
                <div key={name} className="p-2 rounded border bg-muted/50 text-center">
                  <span className="font-medium">{name}</span>
                  <span className="text-muted-foreground block">{englishName}</span>
                </div>
              ))}
            </div>
          </div>

          {referenceImages.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">参考图（自动获取）</Label>
              <div className="grid grid-cols-2 gap-2">
                {referenceImages.map((reference, index) => (
                  <div key={index} className="space-y-1">
                    <div className="relative rounded overflow-hidden border bg-muted aspect-video">
                      <img src={reference.src} alt={reference.label} className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1.5 py-0.5 text-center">
                        {reference.label}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                💡 使用「全景」子场景作为主参考，确保四视图风格一致
              </p>
            </div>
          )}

          {!image && (
            <div className="space-y-2">
              <Button onClick={onGenerate} className="w-full" disabled={isGenerating}>
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中... {progress}%</>
                ) : (
                  <><Box className="h-4 w-4 mr-2" />生成四视图</>
                )}
              </Button>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">或</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <label className="block">
                <input type="file" accept="image/*" onChange={onUpload} className="hidden" disabled={isGenerating} />
                <div className="flex items-center justify-center gap-2 p-2 border border-dashed rounded-lg cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors">
                  <Upload className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">上传已有图片</span>
                </div>
              </label>
            </div>
          )}

          <details className="group" open>
            <summary className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              <span className="group-open:rotate-90 transition-transform">▶</span>
              四视图提示词（可编辑，修改后直接用于生成）
            </summary>
            <div className="mt-2 space-y-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">生成提示词（{langLabel}，修改后直接用于生成）</Label>
                  <Button variant="ghost" size="sm" className="h-5 px-2 text-xs" onClick={() => onCopyPrompt(!isZh)}>
                    <Copy className="h-3 w-3 mr-1" />复制
                  </Button>
                </div>
                <Textarea
                  value={currentPrompt}
                  onChange={(event) => onPromptChange(event.target.value, isZh)}
                  className="min-h-[200px] text-xs resize-y"
                />
              </div>
            </div>
          </details>

          {image && (
            <div className="space-y-2">
              <Label className="text-xs">四视图预览 ({aspectRatio})</Label>
              <div className={`relative rounded-lg overflow-hidden border bg-muted ${aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]"}`}>
                <img src={image} alt="四视图预览" className="w-full h-full object-contain" />
              </div>
              <Button onClick={onSplit} className="w-full" disabled={isSplitting}>
                {isSplitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />切割中...</>
                ) : (
                  <><Scissors className="h-4 w-4 mr-2" />切割为 4 个视角</>
                )}
              </Button>
            </div>
          )}

          {hasViews && (
            <div className="space-y-2">
              <Label className="text-xs">切割结果</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: "front", name: "正面", image: views.front },
                  { key: "back", name: "背面", image: views.back },
                  { key: "left", name: "左侧", image: views.left },
                  { key: "right", name: "右侧", image: views.right },
                ].map((view) => (
                  <div key={view.key} className="space-y-1">
                    <div className={`relative rounded overflow-hidden border bg-muted ${aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]"}`}>
                      {view.image ? (
                        <img src={view.image} alt={view.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] text-center text-muted-foreground">{view.name}</div>
                  </div>
                ))}
              </div>
              <Button onClick={onSave} className="w-full">
                <Check className="h-4 w-4 mr-2" />保存视角图片到场景
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t">
        <p className="text-xs text-muted-foreground text-center">
          💡 四视图可保证场景在不同机位下的空间一致性
        </p>
      </div>
    </div>
  );
}
