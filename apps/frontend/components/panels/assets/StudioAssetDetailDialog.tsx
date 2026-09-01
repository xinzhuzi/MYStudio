"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudioAssetDialogActions } from "./studio-asset-detail-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CarouselApi } from "@/components/ui/carousel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";
import { RoleVoiceAssignDialog } from "./RoleVoiceAssignDialog";
import { RoleVoicePreviewButton } from "./RoleVoicePreviewButton";
import {
  Box,
  Copy,
  ImageIcon,
  Loader2,
  Map,
  Music2,
 
  Sparkles,
  UserCircle,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { type AssetType } from "@/lib/ai/prompt-polisher";
import { mapDaojieLibraryAssetType } from "@/lib/ai/daojie-prompt-contract";
import type { StudioAssetKind } from "@/types/studio-assets";
import { parseAssetNames } from "@/lib/studio/asset-names";
import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";
import type { TtsSpeakerId } from "@/types/tts";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { buildAssetRegenerationPrompt, getAssetDisplayName, getAssetOperationError } from "./studio-asset-detail-utils";
import { StudioAssetDetailPreviewPane } from "./studio-asset-detail-preview-pane";
import { subscribeAssetCarouselIndex } from "./studio-asset-detail-carousel";
import { StudioAssetRoleAttributes } from "./studio-asset-role-attributes";

export { buildAssetRegenerationPrompt, getAssetDisplayName, getAssetImageOpenTarget, getAssetOperationError, getAssetSpokenText, updateImagesAfterReplacingMainImage } from "./studio-asset-detail-utils";
export { persistGeneratedAssetPromptToLibrary, saveGeneratedAssetImageToLibrary } from "./studio-asset-generation-persistence";

/**
 * 再生成参考图:取当前查看的设定图(轮播位置)作参考,保身份一致性;
 * 无已有图时返回 undefined(纯文生图)。道劫编译链据此装配 reference.denoise 锁。
 */
export function resolveAssetGenerationReferenceImage(
  images: Array<{ url?: string }>,
  currentIndex: number,
): string | undefined {
  return images[currentIndex]?.url || images[0]?.url || undefined;
}

/**
 * 资产库类型 → 生图三轨的唯一映射入口(道劫 ma-gongbi-v1 合同)。
 * clip/audio/任务及未知类型在此 fail-closed,不得默认回落人物或道具轨。
 */
export function resolveThreeTrackAssetType(type: StudioAssetKind): AssetType {
  return mapDaojieLibraryAssetType(type).runtimeTrack;
}

const TYPE_ICON = {
  role: UserCircle,
  scene: Map,
  tool: Box,
  clip: ImageIcon,
  audio: Music2,
} as const;

const TYPE_LABEL = {
  role: "角色",
  scene: "场景",
  tool: "道具",
  clip: "视频素材",
  audio: "配音",
} as const;

export function StudioAssetDetailDialog({
  asset,
  linkedSpeakerIds,
  open,
  onOpenChange,
}: {
  asset: StudioAssetSummary | null;
  /** 从工作流(剧本资产管理)角色行打开时传入全部匹配别名的工作流 speaker 键:
   *  分配音色时统一双写(共享资产如「李先生;管事」拆开的各角色键都接住),保证工作流试听/成片一致 */
  linkedSpeakerIds?: TtsSpeakerId[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  const setActiveStudio = useFreedomStore((state) => state.setActiveStudio);
  const setImagePrompt = useFreedomStore((state) => state.setImagePrompt);
  const setImageResult = useFreedomStore((state) => state.setImageResult);

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftSetting, setDraftSetting] = useState("");
  const [isPolishingPrompt, setIsPolishingPrompt] = useState(false);
  const [generatePhase, setGeneratePhase] = useState<"polishing" | "generating" | "saving" | "done" | "failed" | null>(null);
  const [generateMessage, setGenerateMessage] = useState("");
  const [voiceAssignOpen, setVoiceAssignOpen] = useState(false);

  // 获取当前项目的视觉手册 ID
  const visualManualId = useStudioStore((s) => s.workflowConfig?.visualManualId);
  const activeTtsProjectId = useTtsStore((s) => s.activeProjectId);
  const ttsProjects = useTtsStore((s) => s.projects);
  const voiceProfiles = useTtsStore((s) => s.voiceProfiles);

  const [images, setImages] = useState<AssetImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fullAsset, setFullAsset] = useState<StudioAssetSummary | null>(null);
  const [recognizedText, setRecognizedText] = useState<string | null>(null);
  const regenerationPrompt = useMemo(() => buildAssetRegenerationPrompt(fullAsset || asset), [fullAsset, asset]);
  const syncCarouselIndex = useCallback((api: CarouselApi) => {
    subscribeAssetCarouselIndex(api, setCurrentIndex);
  }, []);

  useEffect(() => {
    if (!asset) {
      setFullAsset(null);
      setImages([]);
      setCurrentIndex(0);
      setRecognizedText(null);
      setVoiceAssignOpen(false);
      return;
    }

    let cancelled = false;
    const initialImages: AssetImage[] = [];
    if (asset.previewUrl || asset.thumbnailUrl) {
      initialImages.push({ name: "主图", filePath: asset.filePath || "", url: asset.previewUrl || asset.thumbnailUrl });
    }
    if (asset.images?.length) {
      initialImages.push(...asset.images);
    }
    setFullAsset(null);
    setRecognizedText(null);
    setImages(initialImages);
    setCurrentIndex(0);
    setDraftName(asset.name || "");
    setDraftDescription(asset.description || "");
    setDraftPrompt(asset.prompt || "");
    setDraftSetting(asset.setting || "");

    if (getStudioAssetsBridge()?.get) {
      getStudioAssetsBridge()!.get(asset.id).then((result) => {
        if (!result || cancelled) return;
        setFullAsset(result);
        setDraftName(result.name || "");
        setDraftDescription(result.description || "");
        setDraftPrompt(result.prompt || "");
        setDraftSetting(result.setting || "");
        const updatedImgs: AssetImage[] = [];
        if (result.previewUrl || result.thumbnailUrl) {
          updatedImgs.push({ name: "主图", filePath: result.filePath || "", url: result.previewUrl || result.thumbnailUrl });
        }
        if (result.images?.length) {
          updatedImgs.push(...result.images);
        }
        setImages(updatedImgs);
      }).catch((error: unknown) => {
        if (!cancelled) {
          toast.error(getAssetOperationError(error, "加载资产详情失败"));
        }
      });
    }

    return () => {
      cancelled = true;
    };
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id]);

  // This action factory is named with a use* prefix for historical API
  // compatibility, but it is a pure closure factory. Invoke it on every
  // render before the nullable-asset early return so React hook ordering is
  // stable even while the dialog is closed or clearing its selection.
  const {
    handlePolishPrompt, handleSave, handleDelete, copyText,
    handleOneClickGenerateAssetImage, handleRegenerate, handleOpenSource,
    handleOpenFolder, handleAddImage, handleReplaceImage, handleRemoveImage,
    handleTranscribe,
  } = useStudioAssetDialogActions({
    asset,
    onOpenChange,
    visualManualId,
    detail: fullAsset || asset,
    images,
    currentIndex,
    draftName,
    draftDescription,
    draftPrompt,
    draftSetting,
    setIsPolishingPrompt,
    setDraftName,
    setDraftDescription,
    setDraftPrompt,
    setDraftSetting,
    setFullAsset,
    setImages,
    setCurrentIndex,
    setGeneratePhase,
    setGenerateMessage,
    setRecognizedText,
    setImagePrompt,
    setImageResult,
    setActiveStudio,
    setActiveTab,
    resolveAssetGenerationReferenceImage,
    resolveThreeTrackAssetType,
  });

  if (!asset) return null;

  const detail = fullAsset || asset;
  const Icon = TYPE_ICON[asset.type];
  const displayName = getAssetDisplayName(asset);
  const parsedDraftName = parseAssetNames(draftName || detail.name || asset.name);
  const spokenText = recognizedText ?? (draftDescription.trim() || "");
  const audioSrc = asset.previewUrl || asset.filePath || "";
  const hasImagePreview = asset.type !== "audio" && images.length > 0;
  // 三轨生图入口只对 role/scene/tool 开放;clip 等其余类型不展示、不触发(道劫合同 fail-closed)
  const isThreeTrackAsset = asset.type === "role" || asset.type === "scene" || asset.type === "tool";
  const roleSpeakerId = toRoleSpeakerId(asset.id);
  const roleVoiceBindings = activeTtsProjectId ? (ttsProjects[activeTtsProjectId]?.bindings ?? {}) : {};
  const roleVoiceBinding = asset.type === "role" ? roleVoiceBindings[roleSpeakerId] : undefined;
  const roleVoiceProfile = roleVoiceBinding ? voiceProfiles[roleVoiceBinding.profileId] : undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="studio-asset-detail-dialog h-[92vh] !w-[90vw] !max-w-[90vw] overflow-hidden p-0">
        <DialogHeader className={asset.type === "audio" ? "sr-only" : "studio-asset-detail-header border-b border-border px-5 py-4"}>
          <DialogTitle className={asset.type === "audio" ? "sr-only" : "flex min-w-0 items-center gap-2 text-base"}>
            <Icon className="h-4 w-4 text-primary" />
            <span className="truncate">{displayName}</span>
            <Badge variant="outline" className="ml-1">{TYPE_LABEL[asset.type]}</Badge>
          </DialogTitle>
          <DialogDescription className="sr-only">
            查看和编辑资产详情，包括预览、提示词、设定和角色音色绑定。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,420px)_1fr] gap-0 overflow-hidden">
          <StudioAssetDetailPreviewPane
            asset={asset}
            images={images}
            currentIndex={currentIndex}
            spokenText={spokenText}
            audioSrc={audioSrc}
            Icon={Icon}
            onCarouselApi={syncCarouselIndex}
            onTranscribe={handleTranscribe}
            onRemoveImage={handleRemoveImage}
            onAddImage={handleAddImage}
            onReplaceImage={handleReplaceImage}
            onRegenerate={handleRegenerate}
            onCopyPrompt={() => copyText("出图提示词", draftPrompt || draftDescription || regenerationPrompt)}
            onOpenSource={handleOpenSource}
            onOpenFolder={handleOpenFolder}
          />

          {/* 右侧：表单 */}
          <ScrollArea className="max-h-[calc(92vh-72px)] min-w-0 overflow-x-hidden [&>[data-radix-scroll-area-viewport]>div]:!block [&_[data-orientation=vertical]]:bg-transparent">
            <div className="space-y-3 p-5 min-w-0 overflow-hidden">
              {/* 空壳资产生成引导 */}
              {asset.type !== "audio" && !draftDescription.trim() && !draftPrompt.trim() && !draftSetting.trim() && !hasImagePreview && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="text-sm font-medium text-foreground">此角色尚无详细数据</div>
                  <p className="text-xs text-muted-foreground">
                    「{displayName}」在资产库中仅有名称记录，缺少描述、设定和图片。
                    可在「出图提示词」区域走完整生成流程：润色提示词 → 生成图片 → 保存。
                  </p>
                </div>
              )}
              <section className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">名字</div>
                <input
                  className="w-full rounded-md border border-border bg-muted/90 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="主名字;副名字1;副名字2"
                />
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>主名字：{parsedDraftName.primaryName}</span>
                  {parsedDraftName.secondaryNames.length > 0 ? (
                    <>
                      <span className="mx-0.5">副名字</span>
                      {parsedDraftName.secondaryNames.map((name) => (
                        <Badge key={name} variant="outline" className="px-1.5 py-0 text-[10px] font-medium">
                          {name}
                        </Badge>
                      ))}
                    </>
                  ) : (
                    <span>用英文分号 ; 添加副名字</span>
                  )}
                </div>
              </section>
              <section className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{asset.type === "audio" ? "说话内容" : "描述"}</div>
                <Textarea
                  value={asset.type === "audio" ? spokenText : draftDescription}
                  onChange={(event) => {
                    setDraftDescription(event.target.value);
                    setRecognizedText(null);
                  }}
                  placeholder={asset.type === "audio" ? "暂无口播词句" : "暂无描述"}
                  className="min-h-[80px] resize-none bg-muted/90 text-xs leading-5"
                />
              </section>
              {/* 人物属性 — 从 setting 中解析 */}
              {asset.type === "role" && (
                <StudioAssetRoleAttributes setting={draftSetting || asset.setting || ""} />
              )}
              {/* 音色信息 — 仅角色类型显示 */}
              {asset.type === "role" && (() => {
                if (!roleVoiceBinding || !roleVoiceProfile) {
                  return (
                    <button
                      type="button"
                      onClick={() => setVoiceAssignOpen(true)}
                      className="w-full space-y-2 rounded-lg border border-border bg-muted/90 p-3 text-left transition-colors hover:border-primary/45 hover:bg-primary/10"
                    >
                      <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Volume2 className="h-3.5 w-3.5" /> 音色
                      </div>
                      <p className="text-xs text-muted-foreground">尚未分配音色。点击选择资产库音频。</p>
                    </button>
                  );
                }
                return (
                  <section className="space-y-2 rounded-lg border border-border bg-muted/90 p-3">
                    <button
                      type="button"
                      onClick={() => setVoiceAssignOpen(true)}
                      className="w-full rounded-md text-left transition-colors hover:bg-primary/10"
                    >
                      <div className="flex items-center justify-between gap-2 p-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Volume2 className="h-3.5 w-3.5" /> 音色信息
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">点击更换资产库音频</div>
                        </div>
                        <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary">
                          更换音色
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 overflow-hidden p-2 pt-0 text-xs">
                        <div className="truncate" title={roleVoiceProfile.type === "preset" ? "预设音色" : "克隆音色"}><span className="text-muted-foreground">类型：</span>{roleVoiceProfile.type === "preset" ? "预设音色" : "克隆音色"}</div>
                        <div className="truncate" title={roleVoiceProfile.defaultEngine}><span className="text-muted-foreground">引擎：</span>{roleVoiceProfile.defaultEngine}</div>
                        {roleVoiceProfile.presetVoiceId && <div className="truncate" title={roleVoiceProfile.presetVoiceId}><span className="text-muted-foreground">预设：</span>{roleVoiceProfile.presetVoiceId}</div>}
                        {roleVoiceProfile.referenceAudioPath && <div className="col-span-2 truncate" title={roleVoiceProfile.referenceAudioPath}><span className="text-muted-foreground">参考音频：</span>{roleVoiceProfile.referenceAudioPath}</div>}
                        <div className="truncate" title={roleVoiceProfile.id}><span className="text-muted-foreground">Profile：</span>{roleVoiceProfile.id}</div>
                      </div>
                    </button>
                    <RoleVoicePreviewButton
                      profileId={roleVoiceProfile.id}
                      characterName={parsedDraftName.primaryName}
                      defaultEngine={roleVoiceBinding.defaultEngine}
                      defaultModelSize={roleVoiceBinding.defaultModelSize}
                    />
                  </section>
                );
              })()}
              {asset.type !== "audio" ? (
                <>
                  <section className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">出图提示词</div>
                    <Textarea
                      value={draftPrompt}
                      onChange={(event) => setDraftPrompt(event.target.value)}
                      placeholder="暂无出图提示词"
                      className="min-h-[80px] resize-none bg-muted/90 text-xs leading-5"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {isThreeTrackAsset && (
                        <Button
                          variant="paid"
                          size="sm"
                          className="h-6 gap-1 text-[11px]"
                          onClick={handleOneClickGenerateAssetImage}
                          disabled={!!generatePhase || !visualManualId}
                        >
                          {generatePhase ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          {generatePhase === "polishing" ? "生成提示词中..." : generatePhase === "generating" ? "生成图片中..." : generatePhase === "saving" ? "保存中..." : generatePhase === "done" ? "生成完成" : "一键生成资产生图"}
                        </Button>
                      )}
                      {isThreeTrackAsset && (
                        <Button
                          variant="paid"
                          size="sm"
                          className="h-6 gap-1 text-[11px]"
                          onClick={handlePolishPrompt}
                          disabled={isPolishingPrompt || !visualManualId}
                        >
                          {isPolishingPrompt ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          {isPolishingPrompt ? "润色中..." : "润色提示词"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 text-[11px]"
                        onClick={() => draftPrompt && navigator.clipboard.writeText(draftPrompt).then(() => toast.success("已复制"))}
                        disabled={!draftPrompt}
                      >
                        <Copy className="h-3 w-3" />
                        复制
                      </Button>
                      {generatePhase && (
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={generateMessage}>
                          {generateMessage}
                        </span>
                      )}
                    </div>
                  </section>
                  <section className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">设定</div>
                    <Textarea
                      value={draftSetting}
                      onChange={(event) => setDraftSetting(event.target.value)}
                      placeholder="暂无设定"
                      className="min-h-[200px] resize-none bg-muted/90 text-xs leading-5"
                    />
                  </section>
                </>
              ) : (
                null
              )}
              <Button className="w-full" onClick={handleSave}>保存</Button>
              <Button variant="destructive" className="w-full" onClick={handleDelete}>删除</Button>
            </div>
          </ScrollArea>
        </div>
        </DialogContent>
      </Dialog>
      {asset.type === "role" && (
        <RoleVoiceAssignDialog
          character={{ id: asset.id, name: parsedDraftName.primaryName }}
          linkedSpeakerIds={linkedSpeakerIds}
          open={voiceAssignOpen}
          onOpenChange={setVoiceAssignOpen}
        />
      )}
    </>
  );
}
