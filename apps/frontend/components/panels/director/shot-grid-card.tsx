import { Image as ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Shot } from "@/types/script";

interface ShotGridCardProps {
  shot: Shot;
  index: number;
  isActive: boolean;
  onSelect: (shotId: string) => void;
}

export function ShotGridCard({
  shot,
  index,
  isActive,
  onSelect,
}: ShotGridCardProps) {
  const startKeyframe = shot.keyframes?.find((keyframe) => keyframe.type === "start");
  const imageUrl = startKeyframe?.imageUrl || shot.imageUrl;
  const hasVideo = Boolean(shot.videoUrl || shot.interval?.videoUrl);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`分镜镜头 ${index + 1}：${shot.actionSummary || ""}`.trim()}
      aria-pressed={isActive}
      onClick={() => onSelect(shot.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(shot.id);
        }
      }}
      className={cn(
        "group relative flex flex-col bg-card border border-border rounded-lg overflow-hidden cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        isActive
          ? "border-primary/40 ring-1 ring-primary/50"
          : "border-border hover:border-border",
      )}
    >
      <div className="px-2 py-1.5 bg-muted/40 border-b border-border flex justify-between items-center">
        <span
          className={cn(
            "font-mono text-[10px] font-bold",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          SHOT {String(index + 1).padStart(2, "0")}
        </span>
        <span className="text-[9px] px-1 py-0.5 bg-muted/60 text-muted-foreground rounded truncate max-w-[60px]">
          {shot.shotSize}
        </span>
      </div>

      <div className="aspect-video bg-muted/60 relative overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`Shot ${index + 1}`}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-foreground">
            <ImageIcon className="w-6 h-6 opacity-30" />
          </div>
        )}

        {hasVideo && (
          <div className="absolute top-1.5 right-1.5 p-1 bg-success text-white rounded">
            <Video className="w-2.5 h-2.5" />
          </div>
        )}
      </div>

      <div className="p-2">
        <p className="text-[10px] text-muted-foreground line-clamp-2">{shot.actionSummary}</p>
      </div>
    </div>
  );
}
