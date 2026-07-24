import { ImageIcon } from "lucide-react";

export function SplitScenesEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
        <ImageIcon className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">暂无切割的分镜</p>
    </div>
  );
}
