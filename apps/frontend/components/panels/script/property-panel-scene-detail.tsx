import type { Dispatch, SetStateAction } from "react";
import type { PromptLanguage, ScriptScene, Shot } from "@/types/script";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowRight,
  Check,
  Copy,
  Film,
  Grid3X3,
  MapPin,
  Pencil,
  Save,
  Trash2,
  X,
} from "lucide-react";
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

interface PropertyPanelSceneDetailProps {
  scene: ScriptScene;
  sceneShots: Shot[];
  promptLanguage: PromptLanguage;
  isEditing: boolean;
  editData: Record<string, string>;
  setEditData: Dispatch<SetStateAction<Record<string, string>>>;
  setIsEditing: Dispatch<SetStateAction<boolean>>;
  startEditing: () => void;
  handleSave: () => void;
  onGoToSceneLibrary?: (sceneId: string) => void;
  handleCopySceneData: () => void | Promise<void>;
  copiedScene: boolean;
  onGoToDirectorFromScene?: (sceneId: string) => void;
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>;
  handleDelete: () => void;
}

export function PropertyPanelSceneDetail({
  scene,
  sceneShots,
  promptLanguage,
  isEditing,
  editData,
  setEditData,
  setIsEditing,
  startEditing,
  handleSave,
  onGoToSceneLibrary,
  handleCopySceneData,
  copiedScene,
  onGoToDirectorFromScene,
  deleteDialogOpen,
  setDeleteDialogOpen,
  handleDelete,
}: PropertyPanelSceneDetailProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4 pb-32">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
            <MapPin className="h-5 w-5 text-blue-500" />
          </div>
          <div className="flex-1">
            {isEditing ? (
              <Input
                value={editData.name || ""}
                onChange={(event) => setEditData({ ...editData, name: event.target.value })}
                className="h-7 text-sm font-medium"
              />
            ) : (
              <h3 className="font-medium">{scene.name || scene.location}</h3>
            )}
            <PropertyPanelStatusBadge status={scene.status} />
          </div>
          {!isEditing ? (
            <Button aria-label="编辑场景" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={startEditing}>
              <Pencil className="h-3 w-3" />
            </Button>
          ) : (
            <div className="flex gap-1">
              <Button aria-label="保存场景" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleSave}>
                <Save className="h-3 w-3" />
              </Button>
              <Button aria-label="取消编辑场景" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsEditing(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        <Separator />

        {isEditing ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">地点</Label>
              <Input value={editData.location || ""} onChange={(event) => setEditData({ ...editData, location: event.target.value })} className="h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">时间</Label>
              <Input value={editData.time || ""} onChange={(event) => setEditData({ ...editData, time: event.target.value })} className="h-8" placeholder="如：白天、夜晚、黄昏" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">氛围</Label>
              <Textarea value={editData.atmosphere || ""} onChange={(event) => setEditData({ ...editData, atmosphere: event.target.value })} className="min-h-[60px]" />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">地点</div>
              <div className="text-sm">{scene.location}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">时间</div>
              <div className="text-sm">{scene.time}</div>
            </div>
            {scene.atmosphere && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">氛围</div>
                <div className="text-sm">{scene.atmosphere}</div>
              </div>
            )}

            {(scene.architectureStyle || scene.lightingDesign || scene.colorPalette || scene.eraDetails) && (
              <>
                <Separator className="my-2" />
                <div className="text-xs font-medium text-primary mb-2">场景设计</div>
                {scene.architectureStyle && <div><div className="text-xs text-muted-foreground mb-1">建筑风格</div><div className="text-sm">{scene.architectureStyle}</div></div>}
                {scene.lightingDesign && <div><div className="text-xs text-muted-foreground mb-1">光影设计</div><div className="text-sm">{scene.lightingDesign}</div></div>}
                {scene.colorPalette && <div><div className="text-xs text-muted-foreground mb-1">色彩基调</div><div className="text-sm">{scene.colorPalette}</div></div>}
                {scene.eraDetails && <div><div className="text-xs text-muted-foreground mb-1">时代特征</div><div className="text-sm">{scene.eraDetails}</div></div>}
                {scene.keyProps && scene.keyProps.length > 0 && <div><div className="text-xs text-muted-foreground mb-1">关键道具</div><div className="text-sm">{scene.keyProps.join("、")}</div></div>}
                {scene.spatialLayout && <div><div className="text-xs text-muted-foreground mb-1">空间布局</div><div className="text-sm">{scene.spatialLayout}</div></div>}
              </>
            )}

            {((promptLanguage !== "en" && scene.visualPrompt) || (promptLanguage !== "zh" && scene.visualPromptEn)) && (
              <>
                <Separator className="my-2" />
                <div className="text-xs font-medium text-primary mb-2">视觉提示词</div>
                {promptLanguage !== "en" && scene.visualPrompt && <div><div className="text-xs text-muted-foreground mb-1">中文</div><div className="text-sm text-muted-foreground">{scene.visualPrompt}</div></div>}
                {promptLanguage !== "zh" && scene.visualPromptEn && <div><div className="text-xs text-muted-foreground mb-1">English</div><div className="text-sm text-muted-foreground italic">{scene.visualPromptEn}</div></div>}
              </>
            )}

            {sceneShots.length > 0 && (() => {
              if (!scene.viewpoints || scene.viewpoints.length === 0) {
                return <><Separator className="my-2" /><div className="text-xs font-medium text-primary mb-2"><Grid3X3 className="h-3 w-3 inline mr-1" />多视角联合图</div><div className="text-xs text-muted-foreground">未分析视角（可选，AI校准分镜后自动生成）</div></>;
              }
              const viewpoints = scene.viewpoints.map((viewpoint) => ({
                ...viewpoint,
                shotIndexes: viewpoint.shotIds?.map((id) => sceneShots.find((shot) => shot.id === id)?.index || 0).filter((index) => index > 0) || [],
              }));
              return (
                <>
                  <Separator className="my-2" />
                  <div className="text-xs font-medium text-primary mb-2"><Grid3X3 className="h-3 w-3 inline mr-1" />多视角联合图</div>
                  <div className="text-xs text-muted-foreground mb-2">AI 分析 {viewpoints.length} 个视角</div>
                  <div className="space-y-1.5">
                    {viewpoints.slice(0, 6).map((viewpoint, index) => (
                      <div key={viewpoint.id} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/50">
                        <span className="w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center font-medium">{index + 1}</span>
                        <span className="flex-1 truncate">{viewpoint.name}</span>
                        {viewpoint.shotIndexes.length > 0 && <span className="text-muted-foreground">分镜 #{viewpoint.shotIndexes.map((shotIndex) => String(shotIndex).padStart(2, "0")).join(",#")}</span>}
                      </div>
                    ))}
                    {viewpoints.length > 6 && <div className="text-xs text-muted-foreground text-center py-1">还有 {viewpoints.length - 6} 个视角...</div>}
                  </div>
                </>
              );
            })()}

            {(scene.appearanceCount || scene.episodeNumbers?.length) && (
              <>
                <Separator className="my-2" />
                <div className="flex items-center gap-2 flex-wrap">
                  {scene.importance && <span className={`px-2 py-0.5 rounded text-xs ${scene.importance === "main" ? "bg-primary/10 text-primary" : scene.importance === "secondary" ? "bg-yellow-500/10 text-yellow-600" : "bg-muted text-muted-foreground"}`}>{scene.importance === "main" ? "主场景" : scene.importance === "secondary" ? "次要场景" : "过渡场景"}</span>}
                  {scene.appearanceCount && <span className="text-xs text-muted-foreground">出场 {scene.appearanceCount} 次</span>}
                  {scene.episodeNumbers && scene.episodeNumbers.length > 0 && <span className="text-xs text-muted-foreground">第 {scene.episodeNumbers.join(", ")} 集</span>}
                </div>
              </>
            )}
          </div>
        )}

        <Separator />
        <div className="space-y-2">
          <Button className="w-full" onClick={() => onGoToSceneLibrary?.(scene.id)}><ArrowRight className="h-4 w-4 mr-2" />去场景库生成背景</Button>
          <Button variant="outline" className="w-full" onClick={handleCopySceneData}>{copiedScene ? <Check className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}{copiedScene ? "已复制" : "复制场景数据"}</Button>
          <Button variant="secondary" className="w-full" onClick={() => onGoToDirectorFromScene?.(scene.id)}><Film className="h-4 w-4 mr-2" />去AI导演生成视频</Button>
          <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setDeleteDialogOpen(true)}><Trash2 className="h-4 w-4 mr-2" />删除场景</Button>
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除</AlertDialogTitle><AlertDialogDescription>确定要删除场景「{scene.name || scene.location}」吗？其下所有分镜也将被删除。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollArea>
  );
}
