import type { Dispatch, SetStateAction } from "react";
import type { Shot } from "@/types/script";
import { getShotCompletionStatus } from "@/lib/script/shot-utils";
import { CAMERA_MOVEMENT_PRESETS, SPECIAL_TECHNIQUE_PRESETS } from "@/stores/director-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Check, Copy, Film, Pencil, Save, Sparkles, Timer, Trash2, Volume2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PropertyPanelStatusBadge } from "./property-panel-status-badge";

interface PropertyPanelShotDetailProps {
  shot: Shot;
  isEditing: boolean;
  editData: Record<string, string>;
  setEditData: Dispatch<SetStateAction<Record<string, string>>>;
  setIsEditing: Dispatch<SetStateAction<boolean>>;
  startEditing: () => void;
  handleSave: () => void;
  onGoToDirector?: (shotId: string) => void;
  handleCopyShotTriPrompts: () => void | Promise<void>;
  copiedShotPrompts: boolean;
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>;
  handleDelete: () => void;
}

const EMOTION_LABELS: Record<string, string> = {
  happy: "开心", sad: "悲伤", angry: "愤怒", surprised: "惊讶", fearful: "恐惧", calm: "平静",
  tense: "紧张", excited: "兴奋", mysterious: "神秘", romantic: "浪漫", funny: "搞笑", touching: "感动",
  serious: "严肃", relaxed: "轻松", playful: "调侃", gentle: "温柔", passionate: "激昂", low: "低沉",
};

export function PropertyPanelShotDetail({
  shot,
  isEditing,
  editData,
  setEditData,
  setIsEditing,
  startEditing,
  handleSave,
  onGoToDirector,
  handleCopyShotTriPrompts,
  copiedShotPrompts,
  deleteDialogOpen,
  setDeleteDialogOpen,
  handleDelete,
}: PropertyPanelShotDetailProps) {
  const shotStatus = getShotCompletionStatus(shot);
  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4 pb-32">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center"><Film className="h-5 w-5 text-primary" /></div>
          <div className="flex-1">
            <h3 className="font-medium">分镜 {String(shot.index).padStart(2, "0")}</h3>
            <PropertyPanelStatusBadge status={shotStatus} />
          </div>
          {!isEditing ? (
            <Button aria-label="编辑分镜" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={startEditing}><Pencil className="h-3 w-3" /></Button>
          ) : (
            <div className="flex gap-1">
              <Button aria-label="保存分镜" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleSave}><Save className="h-3 w-3" /></Button>
              <Button aria-label="取消编辑分镜" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsEditing(false)}><X className="h-3 w-3" /></Button>
            </div>
          )}
        </div>

        {shot.imageUrl && <div className="rounded-lg overflow-hidden"><img src={shot.imageUrl} alt={`Shot ${shot.index}`} className="w-full h-auto" /></div>}
        <Separator />

        {isEditing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">景别</Label><Input value={editData.shotSize || ""} onChange={(event) => setEditData({ ...editData, shotSize: event.target.value })} className="h-8" placeholder="如：WS/MS/CU/ECU" /></div>
              <div className="space-y-1">
                <Label className="text-xs">镜头运动</Label>
                <Select value={editData.cameraMovement || "none"} onValueChange={(cameraMovement) => setEditData({ ...editData, cameraMovement })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{CAMERA_MOVEMENT_PRESETS.map((preset) => <SelectItem key={preset.id} value={preset.id} className="text-xs">{preset.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">特殊拍摄手法</Label>
              <Select value={editData.specialTechnique || "none"} onValueChange={(specialTechnique) => setEditData({ ...editData, specialTechnique })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{SPECIAL_TECHNIQUE_PRESETS.map((preset) => <SelectItem key={preset.id} value={preset.id} className="text-xs">{preset.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">动作描述</Label><Textarea value={editData.actionSummary || ""} onChange={(event) => setEditData({ ...editData, actionSummary: event.target.value })} className="min-h-[80px]" /></div>
            <div className="space-y-1"><Label className="text-xs">对白</Label><Textarea value={editData.dialogue || ""} onChange={(event) => setEditData({ ...editData, dialogue: event.target.value })} className="min-h-[60px]" /></div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {shot.shotSize && <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-medium">{shot.shotSize}</span>}
              {shot.cameraMovement && shot.cameraMovement !== "none" && <span className="px-2 py-0.5 bg-muted rounded text-xs">{CAMERA_MOVEMENT_PRESETS.find((preset) => preset.id === shot.cameraMovement)?.label || shot.cameraMovement}</span>}
              {shot.specialTechnique && shot.specialTechnique !== "none" && <span className="px-2 py-0.5 bg-purple-500/10 text-purple-600 rounded text-xs">{SPECIAL_TECHNIQUE_PRESETS.find((preset) => preset.id === shot.specialTechnique)?.label || shot.specialTechnique}</span>}
              {shot.duration && <span className="flex items-center gap-1 px-2 py-0.5 bg-muted rounded text-xs"><Timer className="h-3 w-3" />{shot.duration}s</span>}
            </div>
            {shot.visualDescription && <div className="bg-gradient-to-r from-primary/5 to-transparent p-3 rounded-lg border-l-2 border-primary/30"><div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Sparkles className="h-3 w-3" />视觉</div><div className="text-sm leading-relaxed">{shot.visualDescription}</div></div>}
            <div><div className="text-xs text-muted-foreground mb-1">动作描述</div><div className="text-sm">{shot.actionSummary}</div></div>
            {(shot.ambientSound || shot.soundEffect || shot.dialogue) && (
              <div className="bg-muted/30 p-3 rounded-lg space-y-2">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Volume2 className="h-3 w-3" />音频</div>
                {shot.ambientSound && <div><span className="text-xs text-muted-foreground">环境声: </span><span className="text-xs italic">{shot.ambientSound}</span></div>}
                {shot.soundEffect && <div><span className="text-xs text-muted-foreground">音效: </span><span className="text-xs italic">{shot.soundEffect}</span></div>}
                {shot.dialogue && <div><span className="text-xs text-muted-foreground">对白: </span><span className="text-xs italic">&quot;{shot.dialogue}&quot;</span></div>}
              </div>
            )}
            {shot.characterNames && shot.characterNames.length > 0 && <div><div className="text-xs text-muted-foreground mb-1">出场角色</div><div className="flex flex-wrap gap-1">{shot.characterNames.map((name, index) => <span key={index} className="px-2 py-0.5 bg-muted rounded text-xs">{name}</span>)}</div></div>}
            {shot.emotionTags && shot.emotionTags.length > 0 && <div><div className="text-xs text-muted-foreground mb-1">情绪</div><div className="flex flex-wrap gap-1">{shot.emotionTags.map((tag, index) => <span key={index} className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded text-xs">{EMOTION_LABELS[tag] || tag}</span>)}</div></div>}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">图片</span><PropertyPanelStatusBadge status={shot.imageStatus === "completed" ? "completed" : shot.imageStatus === "generating" ? "in_progress" : "pending"} /></div>
          <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">视频</span><PropertyPanelStatusBadge status={shot.videoStatus === "completed" ? "completed" : shot.videoStatus === "generating" ? "in_progress" : "pending"} /></div>
        </div>

        <Separator />
        <div className="space-y-2">
          <Button className="w-full" onClick={() => onGoToDirector?.(shot.id)}><ArrowRight className="h-4 w-4 mr-2" />去AI导演生成</Button>
          <Button variant="secondary" className="w-full" onClick={handleCopyShotTriPrompts}>{copiedShotPrompts ? <><Check className="h-4 w-4 mr-2 text-green-500" />已复制</> : <><Copy className="h-4 w-4 mr-2" />复制三层提示词数据</>}</Button>
          <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setDeleteDialogOpen(true)}><Trash2 className="h-4 w-4 mr-2" />删除分镜</Button>
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除</AlertDialogTitle><AlertDialogDescription>确定要删除分镜 {shot.index} 吗？</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollArea>
  );
}
