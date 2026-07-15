import { Check, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ScenePreviewViewProps {
  previewUrl: string;
  isGenerating: boolean;
  onSave: () => void | Promise<void>;
  onRegenerate: () => void;
  onDiscard: () => void;
}

export function ScenePreviewView({
  previewUrl,
  isGenerating,
  onSave,
  onRegenerate,
  onDiscard,
}: ScenePreviewViewProps) {
  return (
    <div className="h-full flex flex-col p-3">
      <h3 className="font-medium text-sm mb-3">预览场景概念图</h3>
      <ScrollArea className="flex-1">
        <div className="space-y-4">
          <div className="relative rounded-lg overflow-hidden border-2 border-amber-500/50 bg-muted">
            <img
              src={previewUrl}
              alt="场景概念图预览"
              className="w-full h-auto"
            />
            <div className="absolute top-2 left-2 bg-amber-500 text-white text-xs px-2 py-1 rounded">
              预览
            </div>
          </div>
          <Button onClick={onSave} className="w-full">
            <Check className="h-4 w-4 mr-2" />
            保存概念图
          </Button>
          <Button
            onClick={onRegenerate}
            variant="outline"
            className="w-full"
            disabled={isGenerating}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            重新生成
          </Button>
          <Button
            onClick={onDiscard}
            variant="ghost"
            className="w-full text-muted-foreground"
            size="sm"
          >
            放弃并返回
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
