import {
  Aperture,
  ChevronLeft,
  ChevronRight,
  Clock,
  Film,
  Loader2,
  MapPin,
  MessageSquare,
  RotateCw,
  User,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Character } from "@/stores/library/character-library-store";
import type { Keyframe, ScriptScene, Shot } from "@/types/script";

interface ShotGridDetailPanelProps {
  shot: Shot;
  shotIndex: number;
  totalShots: number;
  scene: ScriptScene | null;
  characters: Character[];
  startKeyframe?: Keyframe;
  endKeyframe?: Keyframe;
  processingType: "start" | "end" | "video" | null;
  isAngleSwitching: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onVariationChange: (shotId: string, characterId: string, variationId: string) => void;
  onAngleSwitch: (type: "start" | "end") => void;
  onGenerateKeyframe: (shot: Shot, type: "start" | "end") => void;
  onGenerateVideo: (shot: Shot) => void;
}

export function ShotGridDetailPanel({
  shot,
  shotIndex,
  totalShots,
  scene,
  characters,
  startKeyframe,
  endKeyframe,
  processingType,
  isAngleSwitching,
  onPrevious,
  onNext,
  onClose,
  onVariationChange,
  onAngleSwitch,
  onGenerateKeyframe,
  onGenerateVideo,
}: ShotGridDetailPanelProps) {
  const startImageUrl = startKeyframe?.imageUrl || shot.imageUrl;
  const videoUrl = shot.videoUrl || shot.interval?.videoUrl;

  return (
    <div className="w-[380px] bg-[#0F0F0F] flex flex-col h-full animate-in slide-in-from-right-5">
      <div className="h-14 px-4 border-b border-zinc-800 flex items-center justify-between bg-[#141414] shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 bg-indigo-900/30 text-indigo-400 rounded flex items-center justify-center font-bold font-mono text-xs">
            {String(shotIndex + 1).padStart(2, "0")}
          </span>
          <div>
            <h3 className="text-foreground font-medium text-sm">镜头详情</h3>
            <p className="text-[10px] text-zinc-500">{shot.cameraMovement}</p>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onPrevious}
            disabled={shotIndex === 0}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onNext}
            disabled={shotIndex === totalShots - 1}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:text-red-400"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-5">
          {scene && (
            <div className="bg-[#141414] p-4 rounded-lg border border-zinc-800 space-y-3">
              <div className="flex items-center gap-2 text-zinc-400">
                <MapPin className="w-3.5 h-3.5" />
                <span className="text-xs font-medium uppercase tracking-wider">场景环境</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{scene.location}</span>
                <span className="text-xs text-zinc-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {scene.time}
                </span>
              </div>

              {scene.atmosphere && (
                <p className="text-xs text-zinc-500">{scene.atmosphere}</p>
              )}

              {characters.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-zinc-700">
                  {characters.map((character) => (
                    <div
                      key={character.id}
                      className="flex items-center justify-between bg-zinc-900 rounded p-2 border border-zinc-800"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-zinc-700 overflow-hidden">
                          {character.thumbnailUrl ? (
                            <img src={character.thumbnailUrl} className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-full h-full p-1 text-zinc-600" />
                          )}
                        </div>
                        <span className="text-xs text-zinc-300">{character.name}</span>
                      </div>

                      {character.variations && character.variations.length > 0 && (
                        <Select
                          value={shot.characterVariations?.[character.id] || "default"}
                          onValueChange={(value) =>
                            onVariationChange(shot.id, character.id, value)
                          }
                        >
                          <SelectTrigger className="h-6 w-24 text-[10px] bg-black border-zinc-700">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">默认造型</SelectItem>
                            {character.variations.map((variation) => (
                              <SelectItem key={variation.id} value={variation.id}>
                                {variation.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-400">
              <Film className="w-3.5 h-3.5" />
              <span className="text-xs font-medium uppercase tracking-wider">叙事动作</span>
            </div>
            <div className="bg-[#141414] p-3 rounded-lg border border-zinc-800">
              <p className="text-sm text-zinc-200 leading-relaxed">{shot.actionSummary}</p>
            </div>
            {shot.dialogue && (
              <div className="bg-[#141414] p-3 rounded-lg border border-zinc-800 flex gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-zinc-600 mt-0.5 shrink-0" />
                <p className="text-sm text-indigo-200 italic">"{shot.dialogue}"</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-400">
              <Aperture className="w-3.5 h-3.5" />
              <span className="text-xs font-medium uppercase tracking-wider">视觉制作</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-medium text-zinc-500">起始帧</span>
                  <div className="flex items-center gap-2">
                    {startImageUrl && (
                      <button
                        onClick={() => onAngleSwitch("start")}
                        disabled={isAngleSwitching}
                        className="text-[10px] text-amber-400 hover:text-amber-300 disabled:opacity-50 flex items-center gap-0.5"
                      >
                        <RotateCw className="w-3 h-3" />
                        视角
                      </button>
                    )}
                    <button
                      onClick={() => onGenerateKeyframe(shot, "start")}
                      disabled={processingType === "start"}
                      className="text-[10px] text-indigo-400 hover:text-foreground disabled:opacity-50"
                    >
                      {startImageUrl ? "重新生成" : "生成"}
                    </button>
                  </div>
                </div>
                <div className="aspect-video bg-black rounded border border-zinc-800 overflow-hidden relative">
                  {startImageUrl ? (
                    <img src={startImageUrl} className="w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-zinc-800" />
                    </div>
                  )}
                  {processingType === "start" && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-medium text-zinc-500">结束帧</span>
                  <div className="flex items-center gap-2">
                    {endKeyframe?.imageUrl && (
                      <button
                        onClick={() => onAngleSwitch("end")}
                        disabled={isAngleSwitching}
                        className="text-[10px] text-amber-400 hover:text-amber-300 disabled:opacity-50 flex items-center gap-0.5"
                      >
                        <RotateCw className="w-3 h-3" />
                        视角
                      </button>
                    )}
                    <button
                      onClick={() => onGenerateKeyframe(shot, "end")}
                      disabled={processingType === "end"}
                      className="text-[10px] text-indigo-400 hover:text-foreground disabled:opacity-50"
                    >
                      {endKeyframe?.imageUrl ? "重新生成" : "生成"}
                    </button>
                  </div>
                </div>
                <div className="aspect-video bg-black rounded border border-zinc-800 overflow-hidden relative">
                  {endKeyframe?.imageUrl ? (
                    <img src={endKeyframe.imageUrl} className="w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[9px] text-zinc-700">可选</span>
                    </div>
                  )}
                  {processingType === "end" && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#141414] rounded-lg p-4 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-indigo-500" />
                视频生成
              </span>
              {videoUrl && <span className="text-[10px] text-green-500 font-mono">● READY</span>}
            </div>

            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                className="w-full aspect-video bg-black rounded border border-zinc-700"
              />
            ) : (
              <div className="w-full aspect-video bg-zinc-900/50 rounded border border-dashed border-zinc-800 flex items-center justify-center">
                <span className="text-xs text-zinc-600 font-mono">预览区域</span>
              </div>
            )}

            <Button
              onClick={() => onGenerateVideo(shot)}
              disabled={!startImageUrl || processingType === "video"}
              className="w-full"
              variant={videoUrl ? "outline" : "default"}
            >
              {processingType === "video" ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>{videoUrl ? "重新生成视频" : "生成视频"}</>
              )}
            </Button>

            {!endKeyframe?.imageUrl && (
              <p className="text-[9px] text-zinc-600 text-center">
                * 未设置结束帧，将使用单图模式 (Image-to-Video)
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
