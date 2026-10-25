"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import type { AssetImage, AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";
import { RoleVoiceAssignDialog } from "./RoleVoiceAssignDialog";
import { RoleVoicePreviewButton } from "./RoleVoicePreviewButton";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  ImageIcon,
  Loader2,
  Map,
  Music2,
  Sparkles,
  Undo2,
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
import {
  buildPromptLayerSummary,
  getPromptLayers,
  getPromptStyleBaseLayer,
  parsePromptOverrides,
} from "@/lib/studio/asset-prompt-layers";
import {
  buildFinalDraftCandidates,
  resolvePromptOwnerNote,
  type PromptInspectCandidate,
} from "@/lib/studio/asset-prompt-inspect";
import { getAssetTypeShotProfile } from "@/lib/studio/asset-type-shot";
import { FACE_I2I_INSTRUCTION } from "@/lib/studio/asset-face-portrait";
import { EXPRESSION_I2I_INSTRUCTION } from "@/lib/studio/asset-expression-sheet";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { buildAssetRegenerationPrompt, getAssetDisplayName, getAssetOperationError } from "./studio-asset-detail-utils";
import { StudioAssetDetailPreviewPane } from "./studio-asset-detail-preview-pane";
import { StudioAssetPromptTextDialog, type PromptTextInspectTarget } from "./studio-asset-prompt-text-dialog";
import { ImagePreviewModal } from "@/components/ui/media-preview-modal";
import { StudioAssetRoleAttributes } from "./studio-asset-role-attributes";
import { StudioAssetRoleSkills } from "./studio-asset-role-skills";

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

/**
 * 指令卡取源分型(10-25 分层面板役 A-2,PRD §4.0 推论+事实9):指令层真源按入口族
 * 分三处——按型 i2i 族=型档案 i2iInstruction(asset-type-shot);高清人脸=
 * FACE_I2I_INSTRUCTION(asset-face-portrait);表情差分=九宫格指令常量
 * (asset-expression-sheet)。t2i 族(设定卡/美宣/道具)无固定指令,返回 null
 * (指令卡位换「主体句参与」标记)。只读展示,不改任何生成行为。
 */
function resolveFocusInstruction(kind: AssetImageKind): { label: string; text: string } | null {
  if (kind === "高清人脸") {
    return { label: "高清人脸 · 图生图固定指令", text: FACE_I2I_INSTRUCTION };
  }
  if (kind === "表情差分") {
    return { label: "表情差分 · 九宫格固定指令", text: EXPRESSION_I2I_INSTRUCTION };
  }
  const profile = getAssetTypeShotProfile(kind);
  if (profile?.route === "i2i" && profile.i2iInstruction) {
    return { label: `${kind} · 按型出图 i2i 指令`, text: profile.i2iInstruction };
  }
  return null;
}

/**
 * focusKind 是否属 i2i 族(§4.0 参与矩阵):按型出图 i2i 型(型档案 route=i2i)+
 * 高清人脸/表情差分两专属 handler 型(虽 i2i 但带型层,与按型 i2i 同族)。
 * i2i 族聚焦时主体句降灰降权折叠、指令卡显型;t2i 族聚焦时指令卡位换「主体句参与」。
 */
function isI2iFocusKind(kind: AssetImageKind): boolean {
  if (kind === "高清人脸" || kind === "表情差分") return true;
  return getAssetTypeShotProfile(kind)?.route === "i2i";
}

/**
 * 主体句降态行文案(i2i 族聚焦时的折叠钮/收起头一行)。通用=单边「走图生图…
 * 主体句不参与」;高清人脸例外双路并注(§4.0 矩阵行4:文生图路主体句 ✅ 参与,
 * 图生图路指令即终稿)——文生图入口(onFaceFromText)与零图占位卡分支同样聚焦
 * 本型,单 focusKind 分不出实际走哪路,恒降态单边文案会让文生图路失真
 * (复审修:与型层卡头「仅文生图路注入;图生图路指令即终稿不注型」同款双路口径)。
 */
function subjectDowngradeNote(kind: AssetImageKind): string {
  if (kind === "高清人脸") {
    return "高清人脸双路:文生图路主体句参与;图生图路固定指令即终稿";
  }
  return `${kind}走图生图:固定指令锚画面,主体句不参与`;
}

/** 10-24 布局重造批1:元信息区折叠态记忆键(grill Round 2 B 裁定;缺省展开)。 */
const META_COLLAPSED_STORAGE_KEY = "asset-dialog-meta-collapsed";

function readMetaCollapsed(): boolean {
  try {
    return window.localStorage?.getItem(META_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * ③ 实发终稿探针态(10-25 分层面板役 A-2③):focusKind 组按数组序末位起回溯读
 * tEXt——ready=命中首个携带 tEXt 的该型产物(最近实发);no-products/unreadable/
 * idle/bridge-missing 按 §4.4 降级矩阵置灰注明;probing=回溯读取中。
 */
type FinalDraftProbe =
  | { status: "idle" }
  | { status: "no-products" }
  | { status: "probing" }
  | { status: "unreadable" }
  | { status: "bridge-missing" }
  | { status: "ready"; candidate: PromptInspectCandidate };

/** ③ 按钮旁小字(probe 态→注明文案;ready=PRD 钉的固定小字)。 */
const FINAL_DRAFT_NOTE_BY_STATUS: Record<FinalDraftProbe["status"], string> = {
  idle: "点击任一生成按钮聚焦某型后可查",
  "no-products": "该型尚无产物",
  probing: "正在读取该型最近产物…",
  unreadable: "该型最近产物未携带提示词元数据",
  "bridge-missing": "当前环境不支持读取提示词元数据",
  ready: "来自该型最近产物的引擎实收,非本次预演",
};

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
  // 10-25 分层面板役 A-1:focusKind 联动状态机(null=通用态)。点击生成入口置目标型
  // (与生成派发同帧);一键生成/画风转换清空回通用态(深检 C4:主体句/用户指令参与,
  // 降态滞留会误导);随弹窗开关/切资产重置,不持久化。
  const [focusKind, setFocusKind] = useState<AssetImageKind | null>(null);
  // A-2 ①:i2i 型聚焦时主体句折叠位(false=折叠为一行「不参与」提示;点开仍可编辑;
  // 每次置焦即回折叠,保证逐入口准确)
  const [subjectExpanded, setSubjectExpanded] = useState(true);
  // A-2 ②:「提示词构成」单折叠组默认收起一行摘要(裁定 Q3;展开态记忆视用感再补)
  const [compositionOpen, setCompositionOpen] = useState(false);
  // A-3 润色还原(10-25 分层面板役,PRD §4.1 A-3/裁定 Q5a):applyPolishedPrompt
  // 覆写前的润色前快照(组件态单条,null=本次会话未润色;随切资产重置,不持久化,
  // 刷新即丢;「还原上次润色前」钮=润色过且当前值≠存值时可用)
  const [prePolishPrompt, setPrePolishPrompt] = useState<string | null>(null);
  // Phase C 按型主体句槽(10-25 追加令):Record<型名,本型专用句>;focusKind 聚焦且
  // 槽在场时主体句框绑槽值,保存随 handleSave 入库(prompt_overrides 列);切资产重置重播种
  const [promptOverridesDraft, setPromptOverridesDraft] = useState<Partial<Record<AssetImageKind, string>>>({});
  // 追加令·i2i 指令可编辑:会话级指令覆盖(非空=本次生成用此指令作终稿);不持久化
  const [instructionDrafts, setInstructionDrafts] = useState<Partial<Record<AssetImageKind, string>>>({});
  // 指令卡编辑态开合(作用于当前 focusKind;置焦/清焦即收)
  const [instructionEditOpen, setInstructionEditOpen] = useState(false);
  // ③ 实发终稿(A-2③):探针态+弹层目标(弹层目标亦承载 B-3 查词,共用壳)
  const [finalDraftProbe, setFinalDraftProbe] = useState<FinalDraftProbe>({ status: "idle" });
  const [promptInspectTarget, setPromptInspectTarget] = useState<PromptTextInspectTarget | null>(null);

  // 获取当前项目的视觉手册 ID
  const visualManualId = useStudioStore((s) => s.workflowConfig?.visualManualId);
  // 10-25 分层面板役(§4.0 脚注/事实8):设置页「全局默认型」兜底只感知不改动——
  // 非空时「提示词构成」折叠组头部显示一行兜底提示(引擎 engine:577 条件注入)
  const globalImageBaseType = useAppSettingsStore((s) => s.imageGenerationSettings.localImageBaseType);
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
  // 10-25 深审修(跨资产污染):生成完成尾段的活性探针——闭包持启动资产 id,
  // 完成时对照当前弹窗资产,切换过即只入库不回填表单(防 A 产物污染 B 草稿/图集)
  const activeAssetIdRef = useRef<string | null>(asset?.id ?? null);
  activeAssetIdRef.current = asset?.id ?? null;
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

  // ③ 实发终稿探针(10-25 分层面板役 A-2③,PRD §4.1 算法):displayImages(族聚显
  // 口径,与用户所见一致)按 classifyAssetImage 归型→focusKind 组最后一张(数组序)
  // 起向前回溯,读原图 tEXt(B-1 只读通道)首个 ok 即「该型最近实发」;组内全无
  // tEXt→unreadable;无产物→no-products;无聚焦→idle——按钮按此置灰注明。
  // 生成完成 displayImages 变更即重探(新产物自动成为候选)。竞态用 cancelled 旗
  // 防旧轮探针覆写新一轮结果。
  useEffect(() => {
    if (!open) {
      setFinalDraftProbe({ status: "idle" });
      return;
    }
    if (!focusKind) {
      setFinalDraftProbe({ status: "idle" });
      return;
    }
    const candidates = buildFinalDraftCandidates(displayImages, focusKind);
    if (candidates.length === 0) {
      setFinalDraftProbe({ status: "no-products" });
      return;
    }
    const bridge = getStudioAssetsBridge();
    if (!bridge?.readImagePromptText) {
      setFinalDraftProbe({ status: "bridge-missing" });
      return;
    }
    let cancelled = false;
    setFinalDraftProbe({ status: "probing" });
    void (async () => {
      for (const candidate of candidates) {
        try {
          const result = await bridge.readImagePromptText!({ filePath: candidate.filePath });
          if (cancelled) return;
          if (result.ok) {
            setFinalDraftProbe({ status: "ready", candidate });
            return;
          }
        } catch {
          // 单张读取异常按无 tEXt 续走回溯(下一张同型产物)
        }
      }
      if (!cancelled) setFinalDraftProbe({ status: "unreadable" });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, focusKind, displayImages]);

  // 10-19 双弹勘误:弹窗关(无论因)=预览关——previewIndex 不清零→下次开弹窗时
  // open&&previewIndex 条件双真→Lightbox 与 Dialog 同时弹出
  // 10-25 分层面板 A-1:focusKind 随弹窗关重置(生命周期:随弹窗开关重置,不持久化);
  // 10-25 A-2③/B-3:查词/实发终稿弹层随主弹窗关同关(不残留遮罩)
  useEffect(() => {
    if (!open) {
      setPreviewIndex(null);
      setFocusKind(null);
      setPromptInspectTarget(null);
    }
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
      setFocusKind(null);
      setPrePolishPrompt(null);
      setPromptInspectTarget(null);
      setPromptOverridesDraft({});
      setInstructionDrafts({});
      setInstructionEditOpen(false);
      return;
    }

    // 切资产也清(同弹窗内换资产时 previewIndex 可能指向旧资产图序;族过滤
    // 路径属旧资产会话,直换 A→B 时同样清——10-25 深审修,与注释「切资产即清」对齐;
    // focusKind 同理属旧资产会话的聚焦态,随切重置;A-3 润色快照/查词弹层目标同理)
    setPreviewIndex(null);
    setRemovedFamilyPaths([]);
    setFocusKind(null);
    setPrePolishPrompt(null);
    setPromptInspectTarget(null);
    setPromptOverridesDraft({});
    setInstructionDrafts({});
    setInstructionEditOpen(false);

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
    // Phase C 播种:桥缺席兜底资产行的槽值(桥成功位随后覆盖)
    setPromptOverridesDraft(parsePromptOverrides(asset.promptOverrides));

    if (getStudioAssetsBridge()?.get) {
      getStudioAssetsBridge()!.get(asset.id).then((result) => {
        if (!result || cancelled) return;
        setFullAsset(result);
        setDraftName(result.name || "");
        setDraftDescription(result.description || "");
        setDraftPrompt(result.prompt || "");
        setDraftSetting(result.setting || "");
        // Phase C 播种:fullAsset 槽值为准(桥 get 全列)
        setPromptOverridesDraft(parsePromptOverrides(result.promptOverrides));
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

  // 10-25 分层面板役 A-1 联动装配方:点击生成入口即聚焦目标型(主体句随 i2i 族
  // 收拢为降态行,高清人脸双路并注),一键生成/画风转换清空回通用态;生成派发
  // 本身零变。定义在 actions 装配之前:一键补缺队列经 onFillMissingKindFocus
  // 钩子逐型复用(队列直调底层执行器,复审修 A-1 写入点第4项)。
  const focusOnKind = (kind: AssetImageKind) => {
    setFocusKind(kind);
    setSubjectExpanded(false);
    setInstructionEditOpen(false);
  };
  const clearFocus = () => {
    setFocusKind(null);
    setSubjectExpanded(true);
    setInstructionEditOpen(false);
  };

  // This action factory is named with a use* prefix for historical API
  // compatibility, but it is a pure closure factory. Invoke it on every
  // render before the nullable-asset early return so React hook ordering is
  // stable even while the dialog is closed or clearing its selection.
  const {
    handlePolishPrompt, handleSave, handleDelete, copyText,
    handleOneClickGenerateAssetImage, handleImageToImageStyle: dispatchImageToImageStyle, handleRegenerate,
    handleOpenSource, handleOpenFolder, handleAddImage, handleReplaceImage,
    handleRemoveImage, handleTranscribe, handleFacePortraitFromImage, handleFacePortraitFromText, handleExpressionSheet,
    handleTypeShot: dispatchTypeShot, handleFillMissingQueue, handleRerollFromPrompt,
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
    getActiveAssetId: () => activeAssetIdRef.current,
    removedFamilyPaths,
    draftName,
    draftDescription,
    draftPrompt,
    draftSetting,
    setIsPolishingPrompt,
    setDraftName,
    setDraftDescription,
    setDraftPrompt,
    setDraftSetting,
    setPrePolishPrompt,
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
    onFillMissingKindFocus: focusOnKind,
    getKindSubjectOverride: (kind) => promptOverridesDraft[kind]?.trim() || undefined,
    getInstructionOverride: (kind) => instructionDrafts[kind]?.trim() || undefined,
    promptOverridesDraft: promptOverridesDraft as Record<string, string>,
    setActiveStudio,
    setActiveTab,
    resolveAssetGenerationReferenceImage,
    resolveThreeTrackAssetType,
  });

  const handleTypeShot = (kind: AssetImageKind) => {
    focusOnKind(kind);
    dispatchTypeShot(kind);
  };
  const handleImageToImageStyle = () => {
    clearFocus();
    dispatchImageToImageStyle();
  };

  if (!asset) return null;

  // A-3 润色还原(10-25 分层面板役):回滚 draftPrompt 与 fullAsset.prompt 两处;
  // 快照不随还原清除——润色后再手编再还原,仍照常还原到润色前快照(语义=撤销上次
  // 润色,非撤销全部编辑,PRD §4.1 A-3 边界),钮的可用性由「当前值≠存值」自然闸住。
  const handleRestorePrePolishPrompt = () => {
    if (prePolishPrompt === null || draftPrompt === prePolishPrompt) return;
    const restored = prePolishPrompt;
    setDraftPrompt(restored);
    setFullAsset((current) => (current ? { ...current, prompt: restored } : current));
  };

  // ③ 实发终稿(A-2③):探针 ready 才可点;弹层展示正向终稿+注入层全文(共用查词壳),
  // 底部小字注明「非本次预演」;族兄弟产物标注所属资产名(§4.4 矩阵)。
  const handleOpenFinalDraft = () => {
    if (finalDraftProbe.status !== "ready" || !focusKind) return;
    const candidate = finalDraftProbe.candidate;
    setPromptInspectTarget({
      imagePath: candidate.filePath,
      imageName: candidate.imageName,
      imageUrl: candidate.imageUrl,
      title: `${focusKind} · 实发终稿`,
      ownerNote: resolvePromptOwnerNote(candidate, asset.id),
      footnote: "来自该型最近产物的引擎实收,非本次预演",
    });
  };

  // B-3 查词(10-25 分层面板役 §4.2):图片卡 hover 工具条「查词」入口——读该图
  // 原图 tEXt 分层展示;族兄弟图标注所属资产名;无 tEXt/JPEG/断链由弹层走降级矩阵。
  const handleInspectPrompt = (image: AssetImage, index: number) => {
    const entry = displayImages[index];
    const candidate: PromptInspectCandidate = entry
      ? { filePath: entry.filePath, imageName: entry.name, assetId: entry.assetId, assetName: entry.assetName }
      : { filePath: image.filePath, imageName: image.name };
    setPromptInspectTarget({
      imagePath: candidate.filePath,
      imageName: candidate.imageName,
      imageUrl: entry?.url ?? image.url,
      title: `查词 · ${image.name}`,
      ownerNote: resolvePromptOwnerNote(candidate, asset.id),
    });
  };

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

  // 10-25 分层面板役 A-2 聚焦态派生:focusKind→i2i 族判定/型层分层/指令卡取源/
  // 折叠组收起摘要(全部只读展示,生成行为零变)
  const focusIsI2iFamily = focusKind ? isI2iFocusKind(focusKind) : false;
  const focusLayers = focusKind ? getPromptLayers(focusKind) : null;
  // 底座层与聚焦无关恒可取(通用态展开也展示底座两卡)
  const promptStyleBase = focusLayers?.base ?? getPromptStyleBaseLayer();
  const focusInstruction = focusKind ? resolveFocusInstruction(focusKind) : null;
  // Phase C(10-25 追加令):主体句槽派生——槽在场=框绑槽值;eligible=t2i 族或
  // 高清人脸(其文生图路主体句参与;i2i 族主体句不参与,槽无意义不展示)
  const kindSlotActive = !!focusKind && promptOverridesDraft[focusKind] !== undefined;
  const subjectSlotEligible = !!focusKind && (!focusIsI2iFamily || focusKind === "高清人脸");
  const subjectValue = kindSlotActive && focusKind ? (promptOverridesDraft[focusKind] ?? "") : draftPrompt;
  const handleSubjectChange = (value: string) => {
    if (kindSlotActive && focusKind) {
      setPromptOverridesDraft((prev) => ({ ...prev, [focusKind]: value }));
    } else {
      setDraftPrompt(value);
    }
  };
  const toggleKindSlot = () => {
    if (!focusKind) return;
    setPromptOverridesDraft((prev) => {
      if (prev[focusKind] !== undefined) {
        const next = { ...prev };
        delete next[focusKind];
        return next;
      }
      return { ...prev, [focusKind]: draftPrompt };
    });
  };
  // 追加令·i2i 指令可编辑:当前聚焦型的覆盖态
  const focusInstructionOverrideActive = !!focusKind && !!instructionDrafts[focusKind]?.trim();
  const compositionSummary = focusKind
    ? (buildPromptLayerSummary(focusKind) ?? "点击任一生成按钮查看该型构成")
    : "点击任一生成按钮查看该型构成";

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
          <ScrollArea className="studio-asset-dialog-scrollbar min-h-0 min-w-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:block!">
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
                    {/* 行2: 角色属性 | 音色(仅 role)——10-25 二令:音色钉右列(描述正下方),
                     col-start-2 保属性卡为空(设定无可解析字段)时也恒在描述下方不漂左列;
                     框只留一层(组件本体自带 border 卡,外层包裹去框去底,防框套框) */}
                    {asset.type === "role" && (
                      <div className="min-w-0">
                        <StudioAssetRoleAttributes setting={draftSetting || asset.setting || ""} />
                      </div>
                    )}
                    {asset.type === "role" && (
                      <div className="col-start-2 min-w-0 h-full">
                        {(() => {
                          if (!roleVoiceBinding || !roleVoiceProfile) {
                            return (
                              <button
                                type="button"
                                onClick={() => setVoiceAssignOpen(true)}
                                className="group flex h-full w-full flex-col justify-center gap-2.5 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-left transition-colors hover:border-primary/50"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                    <Volume2 className="h-3.5 w-3.5" />
                                  </span>
                                  <span className="text-xs font-semibold text-foreground">音色</span>
                                </div>
                                <p className="text-xs leading-5 text-muted-foreground">
                                  尚未分配音色。<span className="text-primary/80 group-hover:text-primary">点击选择资产库音频</span>，用于试听与成片配音。
                                </p>
                              </button>
                            );
                          }
                          return (
                            <section className="flex h-full min-w-0 flex-col gap-2 rounded-lg border border-border bg-muted/90 p-3">
                              <button
                                type="button"
                                onClick={() => setVoiceAssignOpen(true)}
                                className="space-y-2 rounded-md p-2 text-left transition-colors hover:bg-primary/10"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                      <Volume2 className="h-3.5 w-3.5" />
                                    </span>
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-foreground">音色</div>
                                      <div className="truncate text-[11px] text-muted-foreground">点击更换资产库音频</div>
                                    </div>
                                  </div>
                                  <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary">
                                    更换音色
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 overflow-hidden text-xs">
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
                      </div>
                    )}
                    {/* 10-25 用户令:人物技能文档展示(像设定一样;数据=入库役
                     campaigns/role_skills_ingest_1025.py 写的 skills 列,五系/单道途结构)。
                     col-span-2 全宽:晏燎五系×十境术法量大,半宽折叠树太挤 */}
                    {asset.type === "role" && (
                      <div className="col-span-2 min-w-0">
                        <StudioAssetRoleSkills skills={fullAsset?.skills ?? asset.skills} />
                      </div>
                    )}
                    {/* 行3: 提示词(10-25 分层面板役 A-2:①主体句+②「提示词构成」折叠组
                     +③实发终稿桩;替换原「出图提示词」单框区,三轨 role/scene/tool 通用)
                     | 设定(非 audio) */}
                    {asset.type !== "audio" ? (
                      <section className="studio-asset-prompt-region min-w-0 space-y-1.5" aria-label="提示词">
                        <div className="text-xs font-medium text-muted-foreground">提示词</div>
                        {/* ① 主体句(主位可编辑;Phase C:聚焦型可开「本型专用」槽) */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] text-muted-foreground">主体句</div>
                          {subjectSlotEligible && focusKind && (
                            <button
                              type="button"
                              className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                                kindSlotActive
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              }`}
                              onClick={toggleKindSlot}
                              aria-pressed={kindSlotActive}
                              title={kindSlotActive ? "本型专用句生效中:该型生成走槽内句(保存入库);点击关闭回共享主体句" : "为该型单独立一句专用主体句(保存入库;该型生成优先用槽内句)"}
                            >
                              {kindSlotActive ? `${focusKind}专用句 · 生效中` : "本型专用句"}
                            </button>
                          )}
                        </div>
                        {focusIsI2iFamily && focusKind && !subjectExpanded ? (
                          <button
                            type="button"
                            className="w-full rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-left text-[11px] leading-4 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                            onClick={() => setSubjectExpanded(true)}
                            title="点开仍可编辑"
                          >
                            {subjectDowngradeNote(focusKind)}(点开仍可编辑)
                          </button>
                        ) : (
                          <>
                            {focusIsI2iFamily && focusKind && (
                              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] leading-4 text-muted-foreground">
                                <span className="min-w-0 truncate" title={subjectDowngradeNote(focusKind)}>
                                  {subjectDowngradeNote(focusKind)}
                                </span>
                                <button
                                  type="button"
                                  className="shrink-0 rounded-md transition-colors hover:text-foreground"
                                  onClick={() => setSubjectExpanded(false)}
                                >
                                  收起
                                </button>
                              </div>
                            )}
                            <Textarea
                              value={subjectValue}
                              onChange={(event) => handleSubjectChange(event.target.value)}
                              placeholder={kindSlotActive && focusKind ? `本型专用句(仅${focusKind}生成路生效;保存入库)` : "暂无出图提示词"}
                              className={`min-h-[96px] resize-none bg-muted/90 text-xs leading-5 ${focusIsI2iFamily ? "opacity-70" : ""}`}
                            />
                          </>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {isThreeTrackAsset && (
                            <Button
                              variant="paid"
                              size="sm"
                              className="h-6 gap-1 text-[11px]"
                              onClick={() => {
                                // A-1 清除点:一键生成主体句参与(LLM 润色对象),清空聚焦回通用态
                                clearFocus();
                                handleOneClickGenerateAssetImage();
                              }}
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
                          {isThreeTrackAsset && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 text-[11px]"
                              onClick={handleRestorePrePolishPrompt}
                              disabled={prePolishPrompt === null || draftPrompt === prePolishPrompt}
                              title="撤销上次润色,还原润色前的提示词(非撤销全部编辑;刷新后不可还原)"
                            >
                              <Undo2 className="h-3 w-3" />
                              还原上次润色前
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
                        {/* ②「提示词构成」单折叠组(默认收起一行摘要;展开分四层卡,
                            全部只读、全文仅展开时渲染——收起态零长文渲染) */}
                        <div className="studio-asset-prompt-composition overflow-hidden rounded-lg border border-border bg-muted/30">
                          <button
                            type="button"
                            className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left"
                            onClick={() => setCompositionOpen((open) => !open)}
                            aria-expanded={compositionOpen}
                            aria-controls="studio-asset-prompt-composition-body"
                          >
                            {compositionOpen ? (
                              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            )}
                            <span className="shrink-0 text-xs font-medium text-foreground">提示词构成</span>
                            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={compositionSummary}>
                              {compositionSummary}
                            </span>
                          </button>
                          {/* §4.0 脚注(事实8):全局默认型兜底开启时组头一行如实提示
                              (只感知不改动,不替用户开关设置) */}
                          {globalImageBaseType ? (
                            <div
                              className="border-t border-border/40 px-2.5 py-1 text-[11px] leading-4 text-muted-foreground"
                              title="设置页「全局默认型」开启时,未显式带型的本地请求由引擎层兜底注入该型"
                            >
                              全局默认型兜底开启:{globalImageBaseType}
                            </div>
                          ) : null}
                          {compositionOpen && (
                            <div id="studio-asset-prompt-composition-body" className="space-y-2 px-2.5 pb-2.5">
                              {/* 型层卡:型名/purpose/画幅/rgba/steps/正负全文(只读);
                                  高清人脸聚焦时卡头标注注入路差异(深检 C2) */}
                              <section className="rounded-md border border-border/60 bg-background/40 p-2.5" aria-label="型层">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs font-semibold text-foreground">型层</span>
                                  {focusLayers && (
                                    <>
                                      <span className="text-xs text-foreground">{focusLayers.type.kind}</span>
                                      <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium">{focusLayers.type.aspectRatioShort}</Badge>
                                      {focusLayers.type.rgbaDefault && (
                                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium text-primary" title="型真源 rgba_default=透明(型层注入直出真 Alpha)">透明</Badge>
                                      )}
                                      {focusLayers.type.stepsHint && (
                                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
                                          steps fast {focusLayers.type.stepsHint.fast}/quality {focusLayers.type.stepsHint.quality}
                                        </Badge>
                                      )}
                                    </>
                                  )}
                                </div>
                                {focusKind === "高清人脸" && (
                                  <p className="text-[11px] leading-4 text-primary/90">仅文生图路注入;图生图路指令即终稿不注型</p>
                                )}
                                {focusLayers ? (
                                  <>
                                    <p className="text-[11px] leading-4 text-muted-foreground">{focusLayers.type.purpose}</p>
                                    <div className="space-y-0.5">
                                      <div className="text-[10px] font-medium text-muted-foreground">型层正向全文(只读)</div>
                                      <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">
                                        {focusLayers.type.positiveText || "(空——自由型无型文约束)"}
                                      </p>
                                    </div>
                                    <div className="space-y-0.5">
                                      <div className="text-[10px] font-medium text-muted-foreground">型层负面全文(只读)</div>
                                      <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">{focusLayers.type.negativeText}</p>
                                    </div>
                                  </>
                                ) : focusKind ? (
                                  <p className="text-[11px] leading-4 text-muted-foreground">该型无独立型文(共用底座)</p>
                                ) : (
                                  <p className="text-[11px] leading-4 text-muted-foreground">点击任一生成按钮查看该型构成</p>
                                )}
                              </section>
                              {/* 风格底座卡:L4 底座正/负全文(全部型共用,只读) */}
                              <section className="rounded-md border border-border/60 bg-background/40 p-2.5" aria-label="风格底座">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs font-semibold text-foreground">美术风格底座</span>
                                  <span className="text-[10px] text-muted-foreground">全部型共用 · 只读</span>
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-[10px] font-medium text-muted-foreground">底座正向全文(只读)</div>
                                  <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">{promptStyleBase.positiveText}</p>
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-[10px] font-medium text-muted-foreground">底座负面全文(只读)</div>
                                  <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">{promptStyleBase.negativeText}</p>
                                </div>
                              </section>
                              {/* 指令卡(L5):i2i 族聚焦时显固定指令全文+「引擎级不可改」标注
                                  (取源分型见 resolveFocusKind 指令族注释);t2i 族聚焦时
                                  指令卡位换「主体句参与」标记;通用态不占位 */}
                              {focusKind && focusIsI2iFamily && focusInstruction ? (
                                <section className="rounded-md border border-border/60 bg-background/40 p-2.5" aria-label="固定指令">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs font-semibold text-foreground">固定指令</span>
                                    <span className="text-[10px] text-muted-foreground">{focusInstruction.label}</span>
                                    {focusInstructionOverrideActive ? (
                                      <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium text-primary">覆盖生效中 · 本次生成用此指令</Badge>
                                    ) : (
                                      <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium text-muted-foreground">固定指令 · 默认</Badge>
                                    )}
                                    <button
                                      type="button"
                                      className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                                      onClick={() => {
                                        if (!focusKind) return;
                                        setInstructionEditOpen((open) => {
                                          if (open) return false;
                                          // 开编辑即物化草稿(已有覆盖用覆盖,否则预填固定指令)
                                          setInstructionDrafts((prev) => ({
                                            ...prev,
                                            [focusKind]: prev[focusKind] ?? focusInstruction.text,
                                          }));
                                          return true;
                                        });
                                      }}
                                    >
                                      {instructionEditOpen ? "收起" : "编辑指令"}
                                    </button>
                                  </div>
                                  {instructionEditOpen && focusKind ? (
                                    <div className="space-y-1">
                                      <Textarea
                                        value={instructionDrafts[focusKind] ?? ""}
                                        onChange={(event) =>
                                          setInstructionDrafts((prev) => ({ ...prev, [focusKind]: event.target.value }))
                                        }
                                        placeholder="清空=用引擎级固定指令"
                                        className="min-h-[96px] resize-none bg-muted/90 text-[11px] leading-5"
                                      />
                                      <p className="text-[10px] leading-4 text-muted-foreground">
                                        非空=本次生成「{focusKind}」用此指令作终稿(指令即终稿纪律不变,不持久化,弹窗关闭即清);清空=用引擎级固定指令。
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">
                                      {instructionDrafts[focusKind]?.trim() || focusInstruction.text}
                                    </p>
                                  )}
                                </section>
                              ) : focusKind && !focusIsI2iFamily ? (
                                <section className="rounded-md border border-border/60 bg-background/40 p-2.5" aria-label="主体句参与">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs font-semibold text-foreground">固定指令</span>
                                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium text-primary">主体句参与</Badge>
                                  </div>
                                  <p className="text-[11px] leading-4 text-muted-foreground">
                                    {focusKind}走文生图:该路无固定指令,主体句(出图提示词/描述)与型层、底座叠加成稿。
                                  </p>
                                </section>
                              ) : null}
                              {/* 负面汇总卡:型负+底座负并陈,各标来源 */}
                              <section className="rounded-md border border-border/60 bg-background/40 p-2.5" aria-label="负面汇总">
                                <span className="text-xs font-semibold text-foreground">负面汇总</span>
                                {focusLayers && (
                                  <div className="space-y-0.5">
                                    <div className="text-[10px] font-medium text-muted-foreground">来源:型层 negative_text({focusLayers.type.kind})</div>
                                    <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">{focusLayers.type.negativeText}</p>
                                  </div>
                                )}
                                <div className="space-y-0.5">
                                  <div className="text-[10px] font-medium text-muted-foreground">来源:底座 art_style_base negative_text</div>
                                  <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">{promptStyleBase.negativeText}</p>
                                </div>
                              </section>
                            </div>
                          )}
                        </div>
                        {/* ③ 查看实发终稿(A-2③,10-25 分层面板役):探针 ready 才可点
                            (focusKind 组末位回溯读 tEXt);无聚焦/无产物/全无 tEXt
                            置灰注明(§4.4);弹层=正向终稿+注入层全文(共用查词壳) */}
                        <div className="flex min-w-0 items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 gap-1 text-[11px]"
                            disabled={finalDraftProbe.status !== "ready"}
                            onClick={handleOpenFinalDraft}
                            title={
                              finalDraftProbe.status === "ready"
                                ? "查看该型最近产物的引擎实收终稿"
                                : FINAL_DRAFT_NOTE_BY_STATUS[finalDraftProbe.status]
                            }
                          >
                            {finalDraftProbe.status === "probing" ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <FileText className="h-3 w-3" />
                            )}
                            查看实发终稿
                          </Button>
                          <span
                            className="studio-asset-final-draft-note min-w-0 truncate text-[10px] text-muted-foreground/80"
                            title={FINAL_DRAFT_NOTE_BY_STATUS[finalDraftProbe.status]}
                          >
                            {FINAL_DRAFT_NOTE_BY_STATUS[finalDraftProbe.status]}
                          </span>
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
                    可在「提示词」区域走完整生成流程：润色提示词 → 生成图片 → 保存。
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
                onFaceFromImage={() => {
                  // A-1 写入点:高清人脸双钮→高清人脸
                  focusOnKind("高清人脸");
                  handleFacePortraitFromImage();
                }}
                onExpression={() => {
                  // A-1 写入点:表情差分→表情差分
                  focusOnKind("表情差分");
                  handleExpressionSheet();
                }}
                expressionPhase={expressionPhase}
                expressionMessage={expressionMessage}
                onFaceFromText={() => {
                  focusOnKind("高清人脸");
                  handleFacePortraitFromText();
                }}
                facePhase={facePhase}
                faceMessage={faceMessage}
                canFacePortrait={canFacePortrait}
                canTypeShot={canTypeShot}
                onTypeShot={handleTypeShot}
                typeShotPhase={typeShotPhase}
                typeShotMessage={typeShotMessage}
                onFillMissing={handleFillMissingQueue}
                onInspectPrompt={handleInspectPrompt}
                onCopyPrompt={() => copyText("出图提示词", draftPrompt || draftDescription || regenerationPrompt)}
                onOpenSource={handleOpenSource}
                onOpenFolder={handleOpenFolder}
                /* 批3(10-24)+Round 3 ⑤/⑥:占位卡 CTA/完整度缺失 chip 直达生成全型路由
                 * ——高清人脸按有图择图生图/文生图路,表情差分接既有路,余型走
                 * handleTypeShot 型驱动件(route 分流:设定卡/美宣/道具=t2i+base_type,
                 * 余=i2i+base_type 型层注入,Phase 2 已切)。
                 * 10-25 分层面板 A-1:入口点击即聚焦目标型(focusOnKind 同帧写入) */
                onGenerateByKind={(kind) => {
                  focusOnKind(kind);
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
          图集与节内局部序;10-25 深审修:三轨(role/scene/tool)均分节=节内序,
          clip/audio 单节=全展示序(Round 3 ⑤ 后 scene/tool 已型谱分节,原 role 限定
          属旧口径)。节内 url 序与 initialIndex 同构产出,根除下标错位隐患。 */}
      {open && previewIndex !== null && displayImages[previewIndex] && (() => {
        const clickedIndex = previewIndex;
        const sectionKind = asset.type !== "clip" && asset.type !== "audio"
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
      {/* 10-25 分层面板役:③实发终稿/B-3 查词共用 tEXt 查询弹层(打开=目标非空;
          关闭清目标,复用按目标重读) */}
      <StudioAssetPromptTextDialog
        open={promptInspectTarget !== null}
        onOpenChange={(next) => {
          if (!next) setPromptInspectTarget(null);
        }}
        target={promptInspectTarget}
        onReroll={
          promptInspectTarget
            ? ({ breakdown }) => {
                // B-4(10-25 追加令):按引擎实收终稿原路重掷(动作内含忙守卫/相位/收编)
                handleRerollFromPrompt({
                  imageName: promptInspectTarget.imageName,
                  imagePath: promptInspectTarget.imagePath,
                  imageUrl: promptInspectTarget.imageUrl,
                  finalText: breakdown.finalText,
                  routeHint: breakdown.routeHint,
                  hasInjectedLayers: breakdown.layers.length > 0,
                });
              }
            : undefined
        }
      />
    </>
  );
}
