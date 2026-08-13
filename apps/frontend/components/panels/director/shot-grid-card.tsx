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
        "group relative flex flex-col bg-[#1A1A1A] border rounded-lg overflow-hidden cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
        isActive
          ? "border-indigo-500 ring-1 ring-indigo-500/50"
          : "border-zinc-800 hover:border-zinc-600",
      )}
    >
      <div className="px-2 py-1.5 bg-[#151515] border-b border-zinc-800 flex justify-between items-center">
        <span
          className={cn(
            "font-mono text-[10px] font-bold",
            isActive ? "text-indigo-400" : "text-zinc-500",
          )}
        >
          SHOT {String(index + 1).padStart(2, "0")}
        </span>
        <span className="text-[9px] px-1 py-0.5 bg-zinc-800 text-zinc-400 rounded truncate max-w-[60px]">
          {shot.shotSize}
        </span>
      </div>

      <div className="aspect-video bg-zinc-900 relative overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`Shot ${index + 1}`}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-800">
            <ImageIcon className="w-6 h-6 opacity-30" />
          </div>
        )}

        {hasVideo && (
          <div className="absolute top-1.5 right-1.5 p-1 bg-green-500 text-white rounded">
            <Video className="w-2.5 h-2.5" />
          </div>
        )}
      </div>

      <div className="p-2">
        <p className="text-[10px] text-zinc-400 line-clamp-2">{shot.actionSummary}</p>
      </div>
    </div>
  );
}
