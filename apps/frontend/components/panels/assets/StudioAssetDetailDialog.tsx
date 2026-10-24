"use client";

import { useEffect, useMemo, useState } from "react";
import { useStudioAssetDialogActions } from "./studio-asset-detail-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  ChevronDown,
  ChevronRight,
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
import {
  mergeFamilyDisplayImages,
  type FamilyDisplayImageEntry,
  type FamilyImageEntry,
} from "@/lib/studio/asset-family-images";
import { classifyAssetImage } from "@/lib/studio/asset-image-kind";
import { buildAssetRegenerationPrompt, getAssetDisplayName, getAssetOperationError } from "./studio-asset-detail-utils";
import { StudioAssetDetailPreviewPane } from "./studio-asset-detail-preview-pane";
import { ImagePreviewModal } from "@/components/ui/media-preview-modal";
import { StudioAssetRoleAttributes } from "./studio-asset-role-attributes";

export { buildAssetRegenerationPrompt, getAssetDisplayName, getAssetImageOpenTarget, getAssetOperationError, getAssetSpokenText, updateImagesAfterReplacingMainImage } from "./studio-asset-detail-utils";
export { persistGeneratedAssetPromptToLibrary, saveGeneratedAssetImageToLibrary } from "./studio-asset-generation-persistence";

/**
 * 再生成参考图:取当前选中的设定图(全局单选位)作参考,保身份一致性;
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

/** 10-24 布局重造批1:元信息区折叠态记忆键(grill Round 2 B 裁定;缺省展开)。 */
const META_COLLAPSED_STORAGE_KEY = "asset-dialog-meta-collapsed";

function readMetaCollapsed(): boolean {
  try {
    return window.localStorage?.getItem(META_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function StudioAssetDetailDialog({
  asset,
  linkedSpeakerIds,
  open,
  onOpenChange,
  familyImages,
}: {
  asset: StudioAssetSummary | null;
  /** 从工作流(剧本资产管理)角色行打开时传入全部匹配别名的工作流 speaker 键:
   *  分配音色时统一双写(共享资产如「李先生;管事」拆开的各角色键都接住),保证工作流试听/成片一致 */
  linkedSpeakerIds?: TtsSpeakerId[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** R4 族聚显(10-19-script-asset-corridor-blank D1+D3):剧本资产行打开时传入
   *  该实体族全部生成图(batchMatch 同源候选全集,updatedAt 倒序);图集按族序
   *  聚显,族兄弟条目只读。undefined=桥缺席/查询失败,回落本行单图(旧行为)。 */
  familyImages?: FamilyImageEntry[];
}) {
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  const setActiveStudio = useFreedomStore((state) => state.setActiveStudio);

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftSetting, setDraftSetting] = useState("");
  const [isPolishingPrompt, setIsPolishingPrompt] = useState(false);
  const [generatePhase, setGeneratePhase] = useState<"polishing" | "generating" | "saving" | "done" | "failed" | null>(null);
  const [generateMessage, setGenerateMessage] = useState("");
  // 10-19 图生图·画风转换:i2i 相位状态机(与一键生成同款拆分;两路互斥)
  const [i2iPhase, setI2iPhase] = useState<"generating" | "done" | "failed" | null>(null);
  const [i2iMessage, setI2iMessage] = useState("");
  // 10-21 高清人脸:人脸相位状态机(图生图/文生图两路共用;与一键生成/画风转换互斥)
  const [facePhase, setFacePhase] = useState<"generating" | "done" | "failed" | null>(null);
  const [expressionPhase, setExpressionPhase] = useState<"generating" | "done" | "failed" | null>(null);
  const [expressionMessage, setExpressionMessage] = useState("");
  // 10-24 批3 按型出图:通用第五路相位状态机(型名进相位文案;一键补缺队列复用聚合)
  const [typeShotPhase, setTypeShotPhase] = useState<"generating" | "done" | "failed" | null>(null);
  const [typeShotMessage, setTypeShotMessage] = useState("");
  const [faceMessage, setFaceMessage] = useState("");
  const [voiceAssignOpen, setVoiceAssignOpen] = useState(false);

  // 获取当前项目的视觉手册 ID
  const visualManualId = useStudioStore((s) => s.workflowConfig?.visualManualId);
  const activeTtsProjectId = useTtsStore((s) => s.activeProjectId);
  const ttsProjects = useTtsStore((s) => s.projects);
  const voiceProfiles = useTtsStore((s) => s.voiceProfiles);

  const [images, setImages] = useState<AssetImage[]>([]);
  // 10-24 布局重造:轮播拆除,currentIndex 语义迁移为「全局单选图」位——
  // 完成切新图(setCurrentIndex(0))/删图夹回/家族行过滤等随动行为不变。
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fullAsset, setFullAsset] = useState<StudioAssetSummary | null>(null);
  const [recognizedText, setRecognizedText] = useState<string | null>(null);
  // 10-19 删后即时刷新(用户报障):族兄弟删除成功后 familyImages prop 不归本弹窗所有,
  // 本地记已删路径并把它们从展示序滤掉;切资产即清(重开弹窗=族重取,天然一致)。
  const [removedFamilyPaths, setRemovedFamilyPaths] = useState<string[]>([]);
  // 10-19 用户令:点击图卡开全屏缩放预览(MediaPreviewModal,滚轮缩放/双击/拖拽/翻页)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // 10-24 布局重造批1:元信息区折叠态(默认展开;localStorage 记忆)
  const [metaCollapsed, setMetaCollapsed] = useState(readMetaCollapsed);
  // R4 族聚显展示序:族序(updatedAt 倒序)+ live 新图置顶;本行条目可编辑、
  // 族兄弟只读。familyImages 未提供时恒等 images(资产库面板等调用方零变化)。
  const displayImages = useMemo<FamilyDisplayImageEntry[]>(
    () => mergeFamilyDisplayImages(familyImages, images, asset?.id)
      .filter((entry) => !removedFamilyPaths.includes(entry.filePath)),
    [familyImages, images, asset?.id, removedFamilyPaths],
  );
  const regenerationPrompt = useMemo(() => buildAssetRegenerationPrompt(fullAsset || asset), [fullAsset, asset]);

  useEffect(() => {
    try {
      window.localStorage?.setItem(META_COLLAPSED_STORAGE_KEY, metaCollapsed ? "1" : "0");
    } catch {
      // localStorage 不可用(隐私模式等):折叠态仅会话内生效,不阻断
    }
  }, [metaCollapsed]);

  // 10-24 布局重造:展示序缩短时夹回选中位(删图/家族过滤后选中不悬空)
  useEffect(() => {
    setCurrentIndex((cur) =>
      displayImages.length === 0 || cur <= displayImages.length - 1
        ? cur
        : Math.max(displayImages.length - 1, 0),
    );
  }, [displayImages.length]);

  // 10-19 双弹勘误:弹窗关(无论因)=预览关——previewIndex 不清零→下次开弹窗时
  // open&&previewIndex 条件双真→Lightbox 与 Dialog 同时弹出
  useEffect(() => {
    if (!open) setPreviewIndex(null);
  }, [open]);

  useEffect(() => {
    if (!asset) {
      setFullAsset(null);
      setImages([]);
      setCurrentIndex(0);
      setRecognizedText(null);
      setVoiceAssignOpen(false);
      setRemovedFamilyPaths([]);
      setPreviewIndex(null);
      return;
    }

    // 切资产也清(同弹窗内换资产时 previewIndex 可能指向旧资产图序)
    setPreviewIndex(null);

    let cancelled = false;
    const initialImages: AssetImage[] = [];
    if (asset.previewUrl || asset.thumbnailUrl) {
      // 10-19 用户令废「主图」名号:初始加载名=文件名(去扩展名)
      const mainBase = (asset.filePath || "").split("/").pop()?.replace(/\.[^.]+$/, "") || asset.name;
      initialImages.push({ name: mainBase, filePath: asset.filePath || "", url: asset.previewUrl || asset.thumbnailUrl });
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
          // 10-19 用户令废「主图」名号:刷新名=文件名(去扩展名)
          const refreshBase = (result.filePath || "").split("/").pop()?.replace(/\.[^.]+$/, "") || asset.name;
          updatedImgs.push({ name: refreshBase, filePath: result.filePath || "", url: result.previewUrl || result.thumbnailUrl });
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
    handleOneClickGenerateAssetImage, handleImageToImageStyle, handleRegenerate,
    handleOpenSource, handleOpenFolder, handleAddImage, handleReplaceImage,
    handleRemoveImage, handleTranscribe, handleFacePortraitFromImage, handleFacePortraitFromText, handleExpressionSheet,
    handleTypeShot, handleFillMissingQueue,
  } = useStudioAssetDialogActions({
    asset,
    onOpenChange,
    visualManualId,
    detail: fullAsset || asset,
    images,
    i2iPhase,
    displayImages,
    familyImages,
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
    setI2iPhase,
    setI2iMessage,
    facePhase,
    setFacePhase,
    setFaceMessage,
    expressionPhase,
    setExpressionPhase,
    setExpressionMessage,
    generatePhaseForGuard: generatePhase,
    typeShotPhase,
    setTypeShotPhase,
    setTypeShotMessage,
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
  const hasImagePreview = asset.type !== "audio" && displayImages.length > 0;
  // 三轨生图入口只对 role/scene/tool 开放;clip 等其余类型不展示、不触发(道劫合同 fail-closed)
  const isThreeTrackAsset = asset.type === "role" || asset.type === "scene" || asset.type === "tool";
  // 10-19 图生图·画风转换:三轨且有图才可转(clip/audio/无图禁用)
  const canImageToImage = isThreeTrackAsset && displayImages.length > 0;
  // 10-21 高清人脸:仅角色轨显示人脸按钮(图生图/文生图两路)
  const canFacePortrait = asset.type === "role";
  // 10-24 批3 按型出图+Round 3 扩展令⑤:图片三轨(role/scene/tool)显示型驱动生成族
  // (节头钮+下拉+一键补缺;型谱按轨取谱),clip/audio 零侵入
  const canTypeShot = isThreeTrackAsset;
  const roleSpeakerId = toRoleSpeakerId(asset.id);
  const roleVoiceBindings = activeTtsProjectId ? (ttsProjects[activeTtsProjectId]?.bindings ?? {}) : {};
  const roleVoiceBinding = asset.type === "role" ? roleVoiceBindings[roleSpeakerId] : undefined;
  const roleVoiceProfile = roleVoiceBinding ? voiceProfiles[roleVoiceBinding.profileId] : undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="studio-asset-detail-dialog h-[92vh] w-[90vw]! max-w-[90vw]! overflow-hidden p-0">
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

        {/* 10-24 布局重造批1:竖向滑动单列——① 元信息区置顶(可折叠)→ ② 图片规范区主体 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ScrollArea className="min-h-0 min-w-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:block!">
            <div className="min-w-0 space-y-4 p-5">
              {/* ① 元信息区(原右栏表单上置;紧凑四行网格+可折叠,折叠留摘要+保存/删除) */}
              <section className="studio-asset-meta-region rounded-lg border border-border bg-muted/30" aria-label="资产元信息">
                <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-4 py-2">
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setMetaCollapsed((collapsed) => !collapsed)}
                    aria-expanded={!metaCollapsed}
                    aria-controls="studio-asset-meta-body"
                  >
                    {metaCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    元信息
                  </button>
                  {metaCollapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={draftName || displayName}>
                        {displayName}
                      </span>
                      {parsedDraftName.secondaryNames.length > 0 && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          别名 {parsedDraftName.secondaryNames.length}
                        </span>
                      )}
                      <div className="flex shrink-0 items-center gap-2">
                        <Button size="sm" className="h-7" onClick={handleSave}>保存</Button>
                        <Button size="sm" variant="destructive" className="h-7" onClick={handleDelete}>删除</Button>
                      </div>
                    </>
                  )}
                </div>
                {!metaCollapsed && (
                  <div id="studio-asset-meta-body" className="grid grid-cols-2 gap-3 p-4">
                    {/* 行1: 名字 | 描述 */}
                    <section className="min-w-0 space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">名字</div>
                      <input
                        className="w-full rounded-md border border-border bg-muted/90 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        placeholder="主名字;副名字1;副名字2"
                      />
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>主名字:{parsedDraftName.primaryName}</span>
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
                    <section className="min-w-0 space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">{asset.type === "audio" ? "说话内容" : "描述"}</div>
                      <Textarea
                        value={asset.type === "audio" ? spokenText : draftDescription}
                        onChange={(event) => {
                          setDraftDescription(event.target.value);
                          setRecognizedText(null);
                        }}
                        placeholder={asset.type === "audio" ? "暂无口播词句" : "暂无描述"}
                        className="h-full min-h-[96px] resize-none bg-muted/90 text-xs leading-5"
                      />
                    </section>
                    {/* 行2: 角色属性 | 音色(仅 role) */}
                    {asset.type === "role" && (
                      <div className="min-w-0 rounded-lg border border-border bg-muted/90 p-3">
                        <StudioAssetRoleAttributes setting={draftSetting || asset.setting || ""} />
                      </div>
                    )}
                    {asset.type === "role" && (() => {
                      if (!roleVoiceBinding || !roleVoiceProfile) {
                        return (
                          <button
                            type="button"
                            onClick={() => setVoiceAssignOpen(true)}
                            className="h-full w-full space-y-2 rounded-lg border border-border bg-muted/90 p-3 text-left transition-colors hover:border-primary/45 hover:bg-primary/10"
                          >
                            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                              <Volume2 className="h-3.5 w-3.5" /> 音色
                            </div>
                            <p className="text-xs text-muted-foreground">尚未分配音色。点击选择资产库音频。</p>
                          </button>
                        );
                      }
                      return (
                        <section className="min-w-0 space-y-2 rounded-lg border border-border bg-muted/90 p-3">
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
                    {/* 行3: 出图提示词(+一键生成/润色/复制) | 设定(非 audio) */}
                    {asset.type !== "audio" ? (
                      <section className="min-w-0 space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">出图提示词</div>
                        <Textarea
                          value={draftPrompt}
                          onChange={(event) => setDraftPrompt(event.target.value)}
                          placeholder="暂无出图提示词"
                          className="min-h-[96px] resize-none bg-muted/90 text-xs leading-5"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          {isThreeTrackAsset && (
                            <Button
                              variant="paid"
                              size="sm"
                              className="h-6 gap-1 text-[11px]"
                              onClick={handleOneClickGenerateAssetImage}
                              disabled={!!generatePhase || !!i2iPhase || !!facePhase || !!expressionPhase || !!typeShotPhase || !visualManualId}
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
                    ) : null}
                    {asset.type !== "audio" ? (
                      <section className="min-w-0 space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">设定</div>
                        <Textarea
                          value={draftSetting}
                          onChange={(event) => setDraftSetting(event.target.value)}
                          placeholder="暂无设定"
                          className="h-full min-h-[96px] resize-none bg-muted/90 text-xs leading-5"
                        />
                      </section>
                    ) : null}
                    {/* 行尾: 保存 | 删除(用户点名置顶区) */}
                    <div className="col-span-2 flex items-center justify-end gap-2">
                      <Button className="min-w-28" onClick={handleSave}>保存</Button>
                      <Button variant="destructive" className="min-w-28" onClick={handleDelete}>删除</Button>
                    </div>
                  </div>
                )}
              </section>

              {/* 空壳资产生成引导(元信息区与图片规范区之间,现链路保持) */}
              {asset.type !== "audio" && !draftDescription.trim() && !draftPrompt.trim() && !draftSetting.trim() && !hasImagePreview && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="text-sm font-medium text-foreground">此角色尚无详细数据</div>
                  <p className="text-xs text-muted-foreground">
                    「{displayName}」在资产库中仅有名称记录，缺少描述、设定和图片。
                    可在「出图提示词」区域走完整生成流程：润色提示词 → 生成图片 → 保存。
                  </p>
                </div>
              )}

              {/* ② 图片规范区(垂直滚动主体:role 型节骨架/scene·tool 单节横行/audio 播报卡) */}
              <StudioAssetDetailPreviewPane
                asset={asset}
                images={displayImages}
                /* 批3 复审 M 修(Round 3 Q1):完整度两行分级/核心红点基准=本行自有图集,
                 * 族聚显(displayImages 含族兄弟行)同型图不抵扣本行缺口;画廊展示序不变 */
                completenessImages={images}
                currentIndex={currentIndex}
                onSelectImage={setCurrentIndex}
                spokenText={spokenText}
                audioSrc={audioSrc}
                Icon={Icon}
                onImageClick={setPreviewIndex}
                onTranscribe={handleTranscribe}
                onRemoveImage={async (image, index) => {
                  // 10-19 删后即时刷新(用户报障):真删成功才过滤展示序(删失败不动);
                  // 索引随展示长度夹回,防删末图后选中位停越界处
                  const wasOwn = images.some((item) => item.filePath === image.filePath);
                  const ok = await handleRemoveImage(image, index);
                  if (ok && !wasOwn) {
                    setRemovedFamilyPaths((prev) => [...prev, image.filePath]);
                    setCurrentIndex((cur) => Math.min(cur, Math.max(displayImages.length - 2, 0)));
                  }
                }}
                onAddImage={handleAddImage}
                onReplaceImage={handleReplaceImage}
                onRegenerate={handleRegenerate}
                onImageToImage={handleImageToImageStyle}
                i2iPhase={i2iPhase}
                i2iMessage={i2iMessage}
                generatePhase={generatePhase}
                canImageToImage={canImageToImage}
                onFaceFromImage={handleFacePortraitFromImage}
                onExpression={handleExpressionSheet}
                expressionPhase={expressionPhase}
                expressionMessage={expressionMessage}
                onFaceFromText={handleFacePortraitFromText}
                facePhase={facePhase}
                faceMessage={faceMessage}
                canFacePortrait={canFacePortrait}
                canTypeShot={canTypeShot}
                onTypeShot={handleTypeShot}
                typeShotPhase={typeShotPhase}
                typeShotMessage={typeShotMessage}
                onFillMissing={handleFillMissingQueue}
                onCopyPrompt={() => copyText("出图提示词", draftPrompt || draftDescription || regenerationPrompt)}
                onOpenSource={handleOpenSource}
                onOpenFolder={handleOpenFolder}
                /* 批3(10-24)+Round 3 ⑤/⑥:占位卡 CTA/完整度缺失 chip 直达生成全型路由
                 * ——高清人脸按有图择图生图/文生图路,表情差分接既有路,余型走
                 * handleTypeShot 型驱动件(route 分流:设定卡/美宣/道具=t2i+base_type,
                 * 余=i2i+base_type 型层注入,Phase 2 已切) */
                onGenerateByKind={(kind) => {
                  if (kind === "高清人脸") {
                    if (displayImages.length > 0) handleFacePortraitFromImage();
                    else handleFacePortraitFromText();
                    return;
                  }
                  if (kind === "表情差分") {
                    handleExpressionSheet();
                    return;
                  }
                  handleTypeShot(kind);
                }}
                isImageRemovable={(image) => {
                  const entry = displayImages.find((item) => item.filePath === image.filePath);
                  return entry ? entry.removable : true;
                }}
              />
            </div>
          </ScrollArea>
        </div>
        </DialogContent>
      </Dialog>
      {/* 10-19 用户令:全屏缩放预览——复用 MediaPreviewModal(滚轮缩放/双击/拖拽/批量翻页) */}
      {/* 弹窗关=预览关:previewIndex 不清零→Lightbox 全屏遮罩残留→堵住所有 UI 点击(10-19 实弹勘误) */}
      {/* 批2 B 节:预览序列=当前节图集(节内上下张)——按点击位的型解析所属节,取该节
          图集与节内局部序;scene/tool/clip 单节=全展示序(行为不变)。节内 url 序与
          initialIndex 同构产出,根除旧「filter(Boolean) 后下标错位」隐患。 */}
      {open && previewIndex !== null && displayImages[previewIndex] && (() => {
        const clickedIndex = previewIndex;
        const sectionKind = asset.type === "role"
          ? classifyAssetImage(displayImages[clickedIndex])
          : null;
        const sectionEntries = displayImages
          .map((image, index) => ({ image, index }))
          .filter(({ image }) => (sectionKind ? classifyAssetImage(image) === sectionKind : true));
        const sectionLocalIndex = Math.max(
          sectionEntries.findIndex(({ index }) => index === clickedIndex),
          0,
        );
        return (
          <ImagePreviewModal
            imageUrl={displayImages[clickedIndex]?.url ?? ""}
            imageUrls={sectionEntries.map(({ image }) => image.url ?? "")}
            initialIndex={sectionLocalIndex}
            isOpen={previewIndex !== null}
            onClose={() => setPreviewIndex(null)}
          />
        );
      })()}
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
