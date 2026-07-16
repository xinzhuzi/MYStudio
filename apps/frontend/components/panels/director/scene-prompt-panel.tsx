import { useState } from "react";
import { Check, ChevronRight, Edit3, Image as ImageIcon, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CAMERA_MOVEMENT_PRESETS,
  SPECIAL_TECHNIQUE_PRESETS,
  type SplitScene,
} from "@/stores/director-store";
import type { PromptLanguage } from "@/types/script";
import { EditableTextField } from "./editable-text-field";

type PromptKind = "image" | "endFrame" | "video";

type ScenePromptPanelProps = {
  scene: SplitScene;
  promptLanguage: PromptLanguage;
  variant: "director" | "sclass";
  disabled: boolean;
  onUpdateAction: (value: string) => void;
  onSaveImage: (prompt: string, promptZh?: string) => void;
  onSaveEndFrame: (prompt: string, promptZh?: string) => void;
  onSaveVideo: (prompt: string, promptZh?: string) => void;
};

export function ScenePromptPanel({
  scene,
  promptLanguage,
  variant,
  disabled,
  onUpdateAction,
  onSaveImage,
  onSaveEndFrame,
  onSaveVideo,
}: ScenePromptPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editing, setEditing] = useState<PromptKind | null>(null);
  const [draft, setDraft] = useState("");
  const isDirector = variant === "director";
  const resolvePrompt = (zh?: string, en?: string) => {
    if (promptLanguage === "en") return en || "";
    if (promptLanguage === "zh") return zh || "";
    return zh || en || "";
  };
  const values = {
    image: resolvePrompt(scene.imagePromptZh, scene.imagePrompt),
    endFrame: resolvePrompt(scene.endFramePromptZh, scene.endFramePrompt),
    video: resolvePrompt(scene.videoPromptZh, scene.videoPrompt),
  };
  const beginEdit = (kind: PromptKind) => {
    if (disabled) return;
    setDraft(values[kind]);
    setEditing(kind);
  };
  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };
  const saveEdit = () => {
    if (!editing) return;
    const save = editing === "image" ? onSaveImage : editing === "endFrame" ? onSaveEndFrame : onSaveVideo;
    const english = editing === "image" ? scene.imagePrompt : editing === "endFrame" ? scene.endFramePrompt : scene.videoPrompt;
    const chinese = editing === "image" ? scene.imagePromptZh : editing === "endFrame" ? scene.endFramePromptZh : scene.videoPromptZh;
    if (promptLanguage === "en") save(draft, chinese);
    else save(english || "", draft);
    setEditing(null);
  };
  const lineClass = isDirector ? "line-clamp-6 min-h-[4.5em]" : "line-clamp-2 min-h-[1.5em]";
  const textareaHeight = isDirector ? "min-h-[150px]" : "min-h-[50px]";

  const renderEditor = (kind: PromptKind, color: "blue" | "orange" | "green", placeholder: string) => {
    if (editing === kind) {
      return (
        <>
          <Textarea
            aria-label={`${kind}-prompt-editor`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className={cn(textareaHeight, "text-xs resize-none")}
            placeholder={placeholder}
            autoFocus
          />
          <div className="flex gap-1 justify-end mt-1">
            <Button variant="outline" size="sm" onClick={cancelEdit} className="h-5 px-2 text-[10px]"><X className="h-2.5 w-2.5 mr-0.5" />取消</Button>
            <Button size="sm" onClick={saveEdit} className="h-5 px-2 text-[10px]"><Check className="h-2.5 w-2.5 mr-0.5" />保存</Button>
          </div>
        </>
      );
    }
    const fallback = kind === "image" ? "点击添加首帧描述..." : kind === "video" ? "点击添加动作描述..." : scene.needsEndFrame ? "点击添加尾帧描述..." : "点击添加尾帧描述...（可选）";
    return (
      <button
        type="button"
        aria-label={`编辑${kind === "image" ? "首帧" : kind === "endFrame" ? "尾帧" : "视频"}提示词`}
        disabled={disabled}
        onClick={() => beginEdit(kind)}
        className={cn(
          "w-full flex items-start gap-2 text-left p-1.5 rounded transition-colors border",
          color === "blue" && "bg-primary/5 hover:bg-primary/10 border-primary/10",
          color === "orange" && (scene.needsEndFrame ? "bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/20" : "bg-orange-500/5 hover:bg-orange-500/10 border-orange-500/10"),
          color === "green" && "bg-green-500/5 hover:bg-green-500/10 border-green-500/10",
        )}
      >
        <span className={cn("text-[11px] flex-1", lineClass, color === "orange" && "text-orange-600 dark:text-orange-400", color === "green" && "text-green-600 dark:text-green-400", color === "blue" && "text-muted-foreground")}>{values[kind] || fallback}</span>
        {!disabled && <Edit3 className={cn("h-2.5 w-2.5 shrink-0 mt-0.5", color === "blue" && "text-blue-500/50", color === "orange" && "text-orange-500/50", color === "green" && "text-green-500/50")} />}
      </button>
    );
  };

  return (
    <div className="space-y-1.5" data-variant={variant}>
      <button type="button" aria-label="提示词" onClick={() => setIsExpanded((value) => !value)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md bg-muted/50 border hover:bg-muted/70 transition-colors">
        <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200", isExpanded && "rotate-90")} />
        <span className="text-xs font-medium">提示词</span>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full border", scene.actionSummary ? "bg-violet-500/15 text-violet-600 border-violet-500/20" : "bg-muted text-muted-foreground/40 border-transparent")}><Edit3 className="inline h-2.5 w-2.5" /> 剧本</span>
          <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full border", values.image ? "bg-blue-500/15 text-blue-600 border-blue-500/20" : "bg-muted text-muted-foreground/40 border-transparent")}><ImageIcon className="inline h-2.5 w-2.5" /> 首帧</span>
          <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full border", values.endFrame ? "bg-orange-500/15 text-orange-600 border-orange-500/20" : "bg-muted text-muted-foreground/40 border-transparent")}>◉ 尾帧</span>
          <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full border", values.video ? "bg-green-500/15 text-green-600 border-green-500/20" : "bg-muted text-muted-foreground/40 border-transparent")}><Play className="inline h-2.5 w-2.5" /> 视频</span>
        </div>
      </button>
      {isExpanded ? (
        <div className="space-y-2 pl-1">
          <div className="border-l-[3px] border-violet-500 pl-3 py-1 space-y-1">
            <Label className="text-[10px] text-violet-600 flex items-center gap-1 font-medium"><Edit3 className="h-3 w-3" />剧本动作（提示词来源）</Label>
            <div className="rounded bg-violet-500/5 border border-violet-500/10"><EditableTextField label="" value={scene.actionSummary || ""} onChange={onUpdateAction} placeholder="双击添加动作描述（AI 将据此生成三层提示词）..." disabled={disabled} multiline /></div>
          </div>
          <div className="border-l-[3px] border-blue-500 pl-3 py-1 space-y-1"><Label className="text-[10px] text-blue-600 flex items-center gap-1 font-medium"><ImageIcon className="h-3 w-3" />首帧提示词（静态画面）</Label>{renderEditor("image", "blue", "描述首帧的静态画面...")}</div>
          <div className="border-l-[3px] border-orange-500 pl-3 py-1 space-y-1"><Label className="text-[10px] text-orange-600 flex items-center gap-1 font-medium">◉ 尾帧提示词{scene.needsEndFrame ? "" : "（可选）"}</Label>{renderEditor("endFrame", "orange", "描述尾帧的静态画面...")}</div>
          <div className="border-l-[3px] border-green-500 pl-3 py-1 space-y-1.5"><Label className="text-[10px] text-green-600 flex items-center gap-1 font-medium"><Play className="h-3 w-3" />视频提示词（动态动作）</Label>{renderEditor("video", "green", "描述视频中的动作、运动、变化...")}</div>
        </div>
      ) : (
        <button type="button" onClick={() => setIsExpanded(true)} className="w-full space-y-1 p-2 rounded-md bg-muted/20 text-left hover:bg-muted/40 transition-colors border border-transparent hover:border-muted">
          <p className="text-[10px] truncate"><span className="text-violet-600 font-medium">剧本: </span><span className="text-muted-foreground">{scene.actionSummary || "未设置"}</span></p>
          <p className="text-[10px] truncate"><span className="text-blue-600 font-medium">首帧: </span><span className="text-muted-foreground">{values.image || "未设置"}</span></p>
          {(scene.needsEndFrame || values.endFrame) && <p className="text-[10px] truncate"><span className="text-orange-600 font-medium">尾帧: </span><span className="text-orange-600/70">{values.endFrame || "未设置"}</span></p>}
          <p className="text-[10px] truncate"><span className="text-green-600 font-medium">视频: </span><span className="text-muted-foreground">{values.video || "未设置"}{scene.cameraMovement && scene.cameraMovement !== "none" && <span className="ml-1 text-green-500/50">[{CAMERA_MOVEMENT_PRESETS.find((item) => item.id === scene.cameraMovement)?.label || scene.cameraMovement}]</span>}{scene.specialTechnique && scene.specialTechnique !== "none" && <span className="ml-1 text-purple-500/50">[{SPECIAL_TECHNIQUE_PRESETS.find((item) => item.id === scene.specialTechnique)?.label || scene.specialTechnique}]</span>}{scene.duration && <span className="ml-1 text-green-500/50">{scene.duration}s</span>}</span></p>
        </button>
      )}
    </div>
  );
}
