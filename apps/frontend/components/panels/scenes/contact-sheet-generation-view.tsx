import type { ChangeEventHandler } from "react";
import { Check, Copy, Grid3X3, Image as ImageIcon, Loader2, Scissors, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StylePicker } from "@/components/ui/style-picker";
import { Textarea } from "@/components/ui/textarea";
import type { VisualStyleId } from "@/lib/constants/visual-styles";
import type { PromptLanguage } from "@/types/script";
import { getLayoutDimensions, type ContactSheetLayout } from "./generation-panel-utils";

type ContactSheetViewpoint = {
  id: string;
  name: string;
  keyProps: string[];
  gridIndex?: number;
  pageIndex?: number;
  shotIndexes?: number[];
};

type ContactSheetPromptPage = { prompt: string; promptZh: string };

interface ContactSheetGenerationViewProps {
  prompt: string;
  promptZh: string | null;
  promptLanguage: PromptLanguage;
  promptPages: ContactSheetPromptPage[];
  pendingViewpoints: ContactSheetViewpoint[];
  extractedViewpoints: ContactSheetViewpoint[];
  currentPageIndex: number;
  styleId: string;
  aspectRatio: "16:9" | "9:16";
  layout: ContactSheetLayout;
  image: string | null;
  splitImages: Record<string, { imageUrl: string; gridIndex: number }>;
  isGenerating: boolean;
  progress: number;
  isSplitting: boolean;
  onCancel: () => void;
  onPageChange: (pageIndex: number) => void;
  onStyleChange: (styleId: VisualStyleId) => void;
  onAspectRatioChange: (aspectRatio: "16:9" | "9:16") => void;
  onLayoutChange: (layout: ContactSheetLayout) => void;
  onGenerate: () => void;
  onUpload: ChangeEventHandler<HTMLInputElement>;
  onPromptChange: (value: string, isZh: boolean) => void;
  onCopyPrompt: (useEnglish: boolean) => void;
  onSplit: () => void;
  onSave: () => void;
}

export function ContactSheetGenerationView({
  prompt,
  promptZh,
  promptLanguage,
  promptPages,
  pendingViewpoints,
  extractedViewpoints,
  currentPageIndex,
  styleId,
  aspectRatio,
  layout,
  image,
  splitImages,
  isGenerating,
  progress,
  isSplitting,
  onCancel,
  onPageChange,
  onStyleChange,
  onAspectRatioChange,
  onLayoutChange,
  onGenerate,
  onUpload,
  onPromptChange,
  onCopyPrompt,
  onSplit,
  onSave,
}: ContactSheetGenerationViewProps) {
  const totalPages = promptPages.length;
  const hasMultiplePages = totalPages > 1;
  const currentPageViewpoints = pendingViewpoints
    .filter((viewpoint) => viewpoint.pageIndex === currentPageIndex)
    .sort((left, right) => (left.gridIndex ?? 0) - (right.gridIndex ?? 0));
  const viewpoints = currentPageViewpoints.length > 0 ? currentPageViewpoints : extractedViewpoints;
  const isZh = promptLanguage === "zh" || promptLanguage === "zh+en";
  const currentPrompt = isZh ? (promptZh || prompt) : (prompt || promptZh || "");
  const dimensions = getLayoutDimensions(layout, aspectRatio);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 pb-2 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">多视角联合图</h3>
          {hasMultiplePages && <span className="text-xs text-muted-foreground">({currentPageIndex + 1}/{totalPages})</span>}
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>取消</Button>
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-4">
          {hasMultiplePages && (
            <div className="flex items-center justify-between p-2 rounded bg-muted/50">
              <Button variant="ghost" size="sm" disabled={currentPageIndex === 0} onClick={() => onPageChange(currentPageIndex - 1)}>
                上一页
              </Button>
              <span className="text-xs">联合图 {currentPageIndex + 1} / {totalPages}</span>
              <Button variant="ghost" size="sm" disabled={currentPageIndex >= totalPages - 1} onClick={() => onPageChange(currentPageIndex + 1)}>
                下一页
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label className="text-xs">视觉风格</Label>
                <StylePicker value={styleId} onChange={onStyleChange} disabled={isGenerating} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">宽高比</Label>
                <Select value={aspectRatio} onValueChange={(value) => onAspectRatioChange(value as "16:9" | "9:16")} disabled={isGenerating}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="16:9">16:9 横屏</SelectItem>
                    <SelectItem value="9:16">9:16 竖屏</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">网格布局</Label>
              <Select value={layout} onValueChange={(value) => onLayoutChange(value as ContactSheetLayout)} disabled={isGenerating}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2x2">2×2 (4格)</SelectItem>
                  <SelectItem value="3x3">3×3 (9格)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                {dimensions.rows}行{dimensions.cols}列 = {dimensions.rows * dimensions.cols}格
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">当前页视角 ({viewpoints.length})</Label>
            <div className="space-y-1.5">
              {viewpoints.map((viewpoint, index) => (
                <div key={viewpoint.id} className="flex items-center gap-2 p-2 rounded border bg-muted/50 text-xs">
                  <span className="w-6 h-6 rounded bg-primary/10 text-primary flex items-center justify-center font-medium shrink-0">
                    {(viewpoint.gridIndex ?? index) + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{viewpoint.name}</div>
                    <div className="text-muted-foreground truncate">{viewpoint.keyProps.join("、") || "默认视角"}</div>
                  </div>
                  {(viewpoint.shotIndexes?.length ?? 0) > 0 && (
                    <div className="text-muted-foreground text-right shrink-0">
                      <div className="text-[10px]">分镜</div>
                      <div>#{viewpoint.shotIndexes?.map((value) => String(value).padStart(2, "0")).join(",#")}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {!image && (
            <div className="space-y-2">
              <Button onClick={onGenerate} className="w-full" disabled={isGenerating}>
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中... {progress}%</>
                ) : (
                  <><Grid3X3 className="h-4 w-4 mr-2" />生成联合图（自动切割并保存）</>
                )}
              </Button>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border" /><span className="text-xs text-muted-foreground">或</span><div className="flex-1 h-px bg-border" />
              </div>
              <label className="block">
                <input type="file" accept="image/*" onChange={onUpload} className="hidden" disabled={isGenerating} />
                <div className="flex items-center justify-center gap-2 p-2 border border-dashed rounded-lg cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors">
                  <Upload className="h-3 w-3 text-muted-foreground" /><span className="text-xs text-muted-foreground">上传已有图片</span>
                </div>
              </label>
            </div>
          )}

          <details className="group" open>
            <summary className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              <span className="group-open:rotate-90 transition-transform">▶</span>联合图提示词（可编辑，修改后直接用于生成）
            </summary>
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">生成提示词（{isZh ? "中文" : "English"}，修改后直接用于生成）</Label>
                <Button variant="ghost" size="sm" className="h-5 px-2 text-xs" onClick={() => onCopyPrompt(!isZh)}>
                  <Copy className="h-3 w-3 mr-1" />复制
                </Button>
              </div>
              <Textarea value={currentPrompt} onChange={(event) => onPromptChange(event.target.value, isZh)} className="min-h-[200px] text-xs resize-y" />
            </div>
          </details>

          {image && (
            <div className="space-y-2">
              <Label className="text-xs">联合图预览</Label>
              <div className="relative rounded-lg overflow-hidden border bg-muted">
                <img src={image} alt="联合图预览" className="w-full h-auto" />
              </div>
              <Button onClick={onSplit} className="w-full" disabled={isSplitting}>
                {isSplitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />切割中...</>
                ) : (
                  <><Scissors className="h-4 w-4 mr-2" />切割为 {viewpoints.length || 6} 个视角</>
                )}
              </Button>
            </div>
          )}

          {Object.keys(splitImages).length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">切割结果 ({aspectRatio})</Label>
              <div className={`grid ${aspectRatio === "9:16" ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
                {viewpoints.map((viewpoint) => {
                  const imageData = splitImages[viewpoint.id];
                  return (
                    <div key={viewpoint.id} className="space-y-1">
                      <div className={`relative ${aspectRatio === "9:16" ? "aspect-[9/16]" : "aspect-video"} rounded overflow-hidden border bg-muted`}>
                        {imageData ? <img src={imageData.imageUrl} alt={viewpoint.name} className="w-full h-full object-cover" /> : (
                          <div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>
                        )}
                      </div>
                      <div className="text-[10px] text-center text-muted-foreground truncate">{viewpoint.name}</div>
                    </div>
                  );
                })}
              </div>
              <Button onClick={onSave} className="w-full"><Check className="h-4 w-4 mr-2" />保存视角图片到场景</Button>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t">
        <p className="text-xs text-muted-foreground text-center">💡 点击「生成联合图」后自动完成切割和保存，可连续发起多个任务</p>
      </div>
    </div>
  );
}
