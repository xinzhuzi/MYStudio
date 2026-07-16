import type { ChangeEvent } from "react";
import { ImagePlus, X } from "lucide-react";

import { Input } from "@/components/ui/input";
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
import { ATMOSPHERE_PRESETS, TIME_PRESETS } from "@/stores/scene-store";

interface SceneGenerationFormProps {
  name: string;
  location: string;
  time: string;
  atmosphere: string;
  styleId: string;
  referenceImages: string[];
  isGenerating: boolean;
  onNameChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onAtmosphereChange: (value: string) => void;
  onStyleChange: (value: string) => void;
  onReferenceImagesChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveReferenceImage: (index: number) => void;
}

export function SceneGenerationForm({
  name,
  location,
  time,
  atmosphere,
  styleId,
  referenceImages,
  isGenerating,
  onNameChange,
  onLocationChange,
  onTimeChange,
  onAtmosphereChange,
  onStyleChange,
  onReferenceImagesChange,
  onRemoveReferenceImage,
}: SceneGenerationFormProps) {
  return (
    <ScrollArea className="flex-1 p-3">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs" htmlFor="scene-generation-name">场景名称</Label>
          <Input
            id="scene-generation-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="例如：城市街道、森林小屋"
            disabled={isGenerating}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs" htmlFor="scene-generation-location">地点描述</Label>
          <Textarea
            id="scene-generation-location"
            value={location}
            onChange={(event) => onLocationChange(event.target.value)}
            placeholder="详细描述场景的环境，例如：繁华的东京涩谷十字路口，霓虹灯闪烁..."
            className="min-h-[100px] text-sm resize-none"
            disabled={isGenerating}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label className="text-xs">时间</Label>
            <Select value={time} onValueChange={onTimeChange} disabled={isGenerating}>
              <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
              <SelectContent>
                {TIME_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">氛围</Label>
            <Select value={atmosphere} onValueChange={onAtmosphereChange} disabled={isGenerating}>
              <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
              <SelectContent>
                {ATMOSPHERE_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">视觉风格</Label>
          <StylePicker value={styleId} onChange={onStyleChange} disabled={isGenerating} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">参考图片</Label>
            <span className="text-xs text-muted-foreground">{referenceImages.length}/3</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {referenceImages.map((image, index) => (
              <div key={index} className="relative group">
                <img src={image} alt={`参考图 ${index + 1}`} className="w-14 h-14 object-cover rounded-md border" />
                <button
                  type="button"
                  aria-label={`删除参考图 ${index + 1}`}
                  onClick={() => onRemoveReferenceImage(index)}
                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {referenceImages.length < 3 ? (
              <>
                <input
                  id="scene-gen-ref-image"
                  aria-label="上传参考图片"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={onReferenceImagesChange}
                />
                <label
                  htmlFor="scene-gen-ref-image"
                  className="w-14 h-14 border-2 border-dashed rounded-md flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors gap-1 cursor-pointer"
                >
                  <ImagePlus className="h-4 w-4" />
                  <span className="text-[10px]">上传</span>
                </label>
              </>
            ) : null}
          </div>
          <p className="text-[10px] text-muted-foreground">AI 将参考这些图片生成场景概念图</p>
        </div>
      </div>
    </ScrollArea>
  );
}
