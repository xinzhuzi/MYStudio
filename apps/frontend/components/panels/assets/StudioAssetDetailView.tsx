"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStudioAssetDialogActions } from "./studio-asset-detail-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useAssetDetailViewStore } from "@/stores/assets/asset-detail-view-store";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import type { AssetImage, AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";
import { RoleVoiceAssignDialog } from "./RoleVoiceAssignDialog";
import { RoleVoicePreviewButton } from "./RoleVoicePreviewButton";
import { StudioAssetSettingDialog } from "./StudioAssetSettingDialog";
import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronRight,
  FileJson,
  FileText,
  ImageIcon,
  Loader2,
  Map,
  Music2,
  UserCircle,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { type AssetType } from "@/lib/ai/prompt-polisher";
import { mapDaojieLibraryAssetType } from "@/lib/ai/daojie-prompt-contract";
import type { StudioAssetKind } from "@/types/studio-assets";
import { parseAssetNames } from "@/lib/studio/asset-names";
import { getAssetDisplayName, getAssetOperationError } from "./studio-asset-detail-utils";
import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";
import type { TtsSpeakerId } from "@/types/tts";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import {
  fetchFamilyImageEntries,
  mergeFamilyDisplayImages,
  type FamilyDisplayImageEntry,
  type FamilyImageEntry,
} from "@/lib/studio/asset-family-images";
import { ASSET_IMAGE_KIND_ASPECTS, asAssetImageTrack, classifyAssetImage, getAssetImageKindSpectrum } from "@/lib/studio/asset-image-kind";
import { parsePromptOverrides } from "@/lib/studio/asset-prompt-layers";
import {
  buildFinalDraftCandidates,
  resolvePromptOwnerNote,
  type PromptInspectCandidate,
} from "@/lib/studio/asset-prompt-inspect";
import { getAssetTypeShotProfile } from "@/lib/studio/asset-type-shot";
import { StudioAssetDetailPreviewPane, busyKey, isLanePhaseRunning } from "./studio-asset-detail-preview-pane";
import { StudioAssetSourcePromptDialog } from "./studio-asset-source-prompt-dialog";
import { StudioAssetCharacterJsonDialog } from "./studio-asset-character-json-dialog";
import { StudioAssetCharacterPrompts } from "./studio-asset-character-prompts";
import {
  deriveSubjectFromCharacterJson,
  resolveBareTypeSubjectGate,
  getCharacterJsonInfo,
  loadCharacterJsonText,
  parseCharacterPromptCatalog,
  resolveAssetPromptJsonInfo,
  type AssetPromptJsonInfo,
  type AssetPromptJsonType,
} from "@/lib/studio/asset-character-json";
import { StudioAssetPromptTextDialog, type PromptTextInspectTarget } from "./studio-asset-prompt-text-dialog";
import {
  StudioAssetGenerationResultDialog,
  type GenerationOutcome,
  type GenerationOutcomeRecord,
} from "./studio-asset-generation-result-dialog";
import { ImagePreviewModal } from "@/components/ui/media-preview-modal";

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
 * focusKind 是否属 i2i 族(§4.0 参与矩阵):按型出图 i2i 型(型档案 route=i2i)+
 * 高清人头/表情差分两专属 handler 型(虽 i2i 但带型层,与按型 i2i 同族)。
 * i2i 族聚焦时主体句降灰降权折叠、指令卡显型;t2i 族聚焦时指令卡位换「主体句参与」。
 */
function isI2iFocusKind(kind: AssetImageKind): boolean {
  if (kind === "高清人头" || kind === "表情差分") return true;
  return getAssetTypeShotProfile(kind)?.route === "i2i";
}

/**
 * 主体句降态行文案(i2i 族聚焦时的折叠钮/收起头一行)。通用=单边「走图生图…
 * 主体句不参与」;高清人头例外双路并注(§4.0 矩阵行4:文生图路主体句 ✅ 参与,
 * 图生图路指令即终稿)——文生图入口(onFaceFromText)与零图占位卡分支同样聚焦
 * 本型,单 focusKind 分不出实际走哪路,恒降态单边文案会让文生图路失真
 * (复审修:与型层卡头「仅文生图路注入;图生图路指令即终稿不注型」同款双路口径)。
 */
function subjectDowngradeNote(kind: AssetImageKind): string {
  if (kind === "高清人头") {
    return "高清人头双路:文生图路主体句参与;图生图路固定指令即终稿";
  }
  return `${kind}走图生图:固定指令锚画面,主体句不参与`;
}

/** 10-24 布局重造批1:基础信息区折叠态记忆键(grill Round 2 B 裁定;缺省展开)。
 * 1120 详情独立页役(§5.3 三令1):区名更名「基础信息」(旧名随弹窗退役,见 git
 * 留痕)——存储键沿旧键 asset-dialog-meta-collapsed(键名语义偏旧系历史留痕,
 * 改名不丢用户既有折叠记忆)。 */
const META_COLLAPSED_STORAGE_KEY = "asset-dialog-meta-collapsed";

/** 1120 详情独立页役(§5.3 三令2):生图区(preview pane)整区折叠态记忆键
 * (与基础信息区同范式:chevron+标题+计数摘要;缺省展开)。 */
const GALLERY_COLLAPSED_STORAGE_KEY = "asset-detail-gallery-collapsed";

/** 资产型→提示词真源域型收窄(10-27 接线):真源域只覆盖 role/scene/tool 三轨,
 *  clip/audio 传 undefined(按平铺名探测,与旧角色路语义一致)。 */
function promptJsonTypeOf(type: StudioAssetKind | undefined): AssetPromptJsonType | undefined {
  return type === "role" || type === "scene" || type === "tool" ? type : undefined;
}

/** 1120 用户令:参考音频路径展示解码——profile 存的 referenceAudioPath 是
 * asset-file:// URI(路径段 percent-encode),原样直出是 %E7%94%B7… 天书;
 * 仅展示层解码(decodeURI 不动 :// 与保留字),存储/传参/引擎解析恒原文。 */
function displayAudioPath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

function readMetaCollapsed(): boolean {
  try {
    return window.localStorage?.getItem(META_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readGalleryCollapsed(): boolean {
  try {
    return window.localStorage?.getItem(GALLERY_COLLAPSED_STORAGE_KEY) === "1";
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

/** ③ 按钮旁小字(probe 态→注明文案;ready=PRD 钉的固定小字;idle 空=R4 砍除提示行)。 */
const FINAL_DRAFT_NOTE_BY_STATUS: Record<FinalDraftProbe["status"], string> = {
  idle: "",
  "no-products": "该型尚无产物",
  probing: "正在读取该型最近产物…",
  unreadable: "该型最近产物未携带提示词元数据",
  "bridge-missing": "当前环境不支持读取提示词元数据",
  ready: "来自该型最近产物的引擎实收,非本次预演",
};

/** T3「阶段」选择器「无」哨兵值(Radix Select 值域须字符串;null 语义映射到此)。 */

/**
 * StudioAssetDetailView — 资产详情独立页(1120-asset-detail-standalone-view §5.1):
 * 弹窗壳(DialogContent)退役为资产 tab 内下钻全页视图,由 AssetsView 按
 * detail-view store 的 target 二态挂载/卸载(页常在,open 门随壳退役)。
 * 页头栏常驻「← 返回列表」+资产名+型徽章+保存/删除(唯一真源);
 * Esc 不再关详情页(只关页内子弹窗,它们仍是合法的瞬态弹窗)。
 */
export function StudioAssetDetailView({
  asset,
  onBack,
  familyImages: externalFamilyImages,
}: {
  asset: StudioAssetSummary | null;
  /** 返回列表(唯一返回口;§5.5 跨 tab 打开时也回资产列表)。 */
  onBack: () => void;
  /** R4 族聚显(10-19-script-asset-corridor-blank D1+D3):外部直供族图
   *  (测试/特殊场景);undefined=由本视图按资产键自取(1120 独立页役:拉取随
   *  view——两入口同键=资产名,bridge 缺席/查询失败回落本行单图,旧行为)。 */
  familyImages?: FamilyImageEntry[];
}) {
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  const setActiveStudio = useFreedomStore((state) => state.setActiveStudio);

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftSetting, setDraftSetting] = useState("");
  const [, setIsPolishingPrompt] = useState(false);
  const [generatePhase, setGeneratePhase] = useState<"polishing" | "generating" | "saving" | "done" | "failed" | null>(null);
  const [, setGenerateMessage] = useState("");
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
  // 1120 生图按钮忙碌态精修(§10.1):busyTarget=spinner 唯一真源(被点钮键,
  // busyKey 族);与五相位并存分工——相位供结果反馈/联动/状态文字,busyTarget
  // 只管「谁在转」(§6 对策2:双源分工注释钉死)。发起链 setPhase 同址设键,
  // finally 清(失败必复原=AC4 硬门)。
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
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
  const [sourcePromptOpen, setSourcePromptOpen] = useState(false);
  const [characterJsonOpen, setCharacterJsonOpen] = useState(false);
  // A-3 润色还原(10-25 分层面板役,PRD §4.1 A-3/裁定 Q5a):applyPolishedPrompt
  // 覆写前的润色前快照(组件态单条,null=本次会话未润色;随切资产重置,不持久化,
  // 刷新即丢;「还原上次润色前」钮=润色过且当前值≠存值时可用)
  const [, setPrePolishPrompt] = useState<string | null>(null);
  // Phase C 按型主体句槽(10-25 追加令):Record<型名,本型专用句>;focusKind 聚焦且
  // 槽在场时主体句框绑槽值,保存随 handleSave 入库(prompt_overrides 列);切资产重置重播种
  const [promptOverridesDraft, setPromptOverridesDraft] = useState<Partial<Record<AssetImageKind, string>>>({});
  // 水合旗(补检1):列表行不带 promptOverrides,真值靠桥 get 回填;未水合前保存
  // 禁写该列(防 get 未返回的窗口内保存把库内槽位清成 {}——数据丢失边界)
  const [promptOverridesHydrated, setPromptOverridesHydrated] = useState(false);
  // 追加令·i2i 指令可编辑:会话级指令覆盖(非空=本次生成用此指令作终稿);不持久化
  const [instructionDrafts, setInstructionDrafts] = useState<Partial<Record<AssetImageKind, string>>>({});
  // 10-26 横竖皆可(人物海报裁定):横幅取向会话开关(缺省竖=跟型)
  // 10-26 人物海报画幅(横竖皆可):选择持久化(localStorage 全局记住,重开弹窗不重置)
  const [posterLandscape, setPosterLandscape] = useState(() => {
    try { return window.localStorage.getItem("studio-asset-poster-landscape") === "1"; } catch { return false; }
  });
  const togglePosterLandscape = () => setPosterLandscape((v) => {
    const next = !v;
    try { window.localStorage.setItem("studio-asset-poster-landscape", next ? "1" : "0"); } catch { /* 无痕/受限环境静默 */ }
    return next;
  });
  // 指令卡编辑态开合(作用于当前 focusKind;置焦/清焦即收;值位随构成区砍除退役)
  const [, setInstructionEditOpen] = useState(false);
  // ③ 实发终稿(A-2③):探针态+弹层目标(弹层目标亦承载 B-3 查词,共用壳)
  const [finalDraftProbe, setFinalDraftProbe] = useState<FinalDraftProbe>({ status: "idle" });
  const [promptInspectTarget, setPromptInspectTarget] = useState<PromptTextInspectTarget | null>(null);
  // R5 生成结果弹窗(10-26 用户令:每次生成完成自动弹出):单发记录/队列末尾汇总;
  // 孤儿防护双闸见 handleImageGenerated/handleQueueSettled(宿主关/切资产全闭环)
  const [generationOutcome, setGenerationOutcome] = useState<GenerationOutcome | null>(null);
  // R5 队列逐发累积池(fromQueue 记录;队列收口一次取走汇总,跨会话恒清零)
  const queueRecordsRef = useRef<GenerationOutcomeRecord[]>([]);
  // 保留生成路的阶段选择语义，null=「无」；随弹窗关/切资产重置。
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

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
  // 10-25 深审修(跨资产污染):生成完成尾段的活性探针——闭包持启动资产 id,
  // 完成时对照当前弹窗资产,切换过即只入库不回填表单(防 A 产物污染 B 草稿/图集)
  const activeAssetIdRef = useRef<string | null>(asset?.id ?? null);
  activeAssetIdRef.current = asset?.id ?? null;
  // R5 孤儿防护闸①(宿主开关活取探针)随弹窗壳退役:独立页由宿主二态挂载/卸载,
  // 「宿主关」=组件卸载(React 卸载后 setState 零渲染),跨资产闸①仍在下面接管。
  // 10-19 用户令:点击图卡开全屏缩放预览(MediaPreviewModal,滚轮缩放/双击/拖拽/翻页)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // 10-24 布局重造批1:基础信息区折叠态(默认展开;localStorage 记忆)
  const [metaCollapsed, setMetaCollapsed] = useState(readMetaCollapsed);
  // 1120 详情独立页(§5.3 三令2):生图区整区折叠态(默认展开;localStorage 记忆)
  const [galleryCollapsed, setGalleryCollapsed] = useState(readGalleryCollapsed);
  // 1120 版式③:设定 MD 编辑弹窗开合
  const [settingEditorOpen, setSettingEditorOpen] = useState(false);
  // 1120 用户令·图像规范清单:三轨型谱(核心/扩展)×画幅×本行已有计数——回答
  // 「这个人该有哪些类型的图、各有几张、现在几张」;只读账本,生成入口恒在
  // 图片区占位卡,此处不重复入口(极简)。计数基准=本行 images(与完整度条
  // 批3 M 修同口径,族兄弟图不抵扣)
  const imageRuleRows = useMemo(() => {
    if (!asset) return [] as Array<{ kind: AssetImageKind; aspect: string; core: boolean; count: number }>;
    const track = asAssetImageTrack(asset.type);
    if (!track) return [] as Array<{ kind: AssetImageKind; aspect: string; core: boolean; count: number }>;
    const spectrum = getAssetImageKindSpectrum(track);
    // 注意:本文件 lucide 导入遮蔽全局 Map,此处用 Record 计数
    const counts: Partial<Record<AssetImageKind, number>> = {};
    for (const image of images) {
      const kind = classifyAssetImage(image);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    // 1120 用户令:清单序=全局型谱序(人脸基准已置顶于 ASSET_IMAGE_KIND_ORDER,
    // 提示词清单/图片区分节/两卡全走同一序,零特例)
    return spectrum.order
      .filter((kind) => kind !== "早期未分类")
      .map((kind) => ({
        kind,
        aspect: ASSET_IMAGE_KIND_ASPECTS[kind],
        core: spectrum.core.includes(kind),
        count: counts[kind] ?? 0,
      }));
  }, [asset, images]);
  // R4 族聚显(1120 独立页役:拉取随 view):进页/切资产按资产键(=两入口
  // batchMatch 同源键:资产类型+资产名)自取族图;undefined=桥缺席/查询失败,
  // 回落本行单图。连点换行时晚到的旧族图丢弃(请求序号守卫,链路排查#7 同款)。
  const [selfFamilyImages, setSelfFamilyImages] = useState<FamilyImageEntry[] | undefined>(undefined);
  const familyReqSeqRef = useRef(0);
  useEffect(() => {
    const seq = ++familyReqSeqRef.current;
    setSelfFamilyImages(undefined);
    if (!asset || (asset.type !== "role" && asset.type !== "scene" && asset.type !== "tool")) {
      return;
    }
    let cancelled = false;
    void fetchFamilyImageEntries(getStudioAssetsBridge(), asset.type, asset.name).then((entries) => {
      if (!cancelled && familyReqSeqRef.current === seq) setSelfFamilyImages(entries);
    });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id]);
  const familyImages = externalFamilyImages !== undefined ? externalFamilyImages : selfFamilyImages;

  // R4 族聚显展示序:族序(updatedAt 倒序)+ live 新图置顶;本行条目可编辑、
  // 族兄弟只读。familyImages 未提供时恒等 images(资产库面板等调用方零变化)。
  const displayImages = useMemo<FamilyDisplayImageEntry[]>(
    () => mergeFamilyDisplayImages(familyImages, images, asset?.id)
      .filter((entry) => !removedFamilyPaths.includes(entry.filePath)),
    [familyImages, images, asset?.id, removedFamilyPaths],
  );
  // 10-25 派生流水线修:展示序活取探针(队列闭包陈旧图集问题,见 actions ctx 注释)
  const displayImagesRef = useRef<AssetImage[]>(displayImages);
  displayImagesRef.current = displayImages;

  // 角色真源 JSON(10-26):按资产名解析 art_skills/<包>/json/<角色名>.json;模块级
  // 缓存,无真源角色恒 null(按钮整段不渲染,配角弹窗零变化)
  const characterJsonInfo = getCharacterJsonInfo(asset?.name);
  // store 位真源探测(10-27 接线):项目库 store/assets/files/prompts/<名>.json 命中
  // 的 role/scene/tool 资产与 repo 手工真源同待遇(按钮/弹窗/素体句闸放开);弹窗
  // 重开/切资产/编辑弹窗关闭即重探(缓存随 save invalidate)。探测中=null。
  const [storePromptInfo, setStorePromptInfo] = useState<AssetPromptJsonInfo | null>(null);
  useEffect(() => {
    if (!asset?.name) {
      setStorePromptInfo(null);
      return;
    }
    let cancelled = false;
    resolveAssetPromptJsonInfo(asset.name, promptJsonTypeOf(asset.type))
      .then((info) => {
        if (!cancelled) setStorePromptInfo(info);
      })
      .catch(() => {
        if (!cancelled) setStorePromptInfo({ origin: null });
      });
    return () => {
      cancelled = true;
    };
  }, [asset?.name, asset?.type, characterJsonOpen]);
  const storePromptHit = storePromptInfo?.origin === "store";
  // 真源接线(10-26 用户令:「提示词应由 JSON 数据化控制+标注文生图/图生图」):
  // 有真源的角色,提示词区=结构化人物提示词面板(随「阶段」联动,逐条路由徽标),
  // 主体句文本框退场;内部派发仍吃派生主体句(镜像走展示+派发边界覆写,不抢
  // draftPrompt state——水合链桥 get 异步回填竞态下恒以真源为准,保存时落 DB=
  // 陈旧种子自愈)。JSON 编辑弹窗关闭后重载,编辑即时反映。派生失败(null)整体
  // 回退既有 DB 行为,fail-safe。
  // 10-27 store 位接线:文本链可含 store 文本(store-only 角色同待遇);门控从
  // 「repo glob 命中」放开为「repo info 或 store 探测命中任一」。
  const [characterJsonText, setCharacterJsonText] = useState<string | null>(null);
  useEffect(() => {
    if (!characterJsonInfo && !storePromptHit) {
      setCharacterJsonText(null);
      return;
    }
    let cancelled = false;
    loadCharacterJsonText(asset?.name, promptJsonTypeOf(asset?.type)).then((load) => {
      if (!cancelled) setCharacterJsonText(load.status === "ready" ? load.text : null);
    });
    return () => {
      cancelled = true;
    };
  }, [characterJsonInfo, storePromptHit, asset?.name, asset?.type, characterJsonOpen]);
  const characterSubjectMirror = useMemo(
    () => characterJsonText !== null
      ? deriveSubjectFromCharacterJson(characterJsonText, selectedStage)
      : null,
    [characterJsonText, selectedStage],
  );
  // 10-26 型区分令:「无衣物定妆」=素体型——恒用 body_base 素体主体词,不吃阶段
  // (选了境界也不发该境带衣主体词;该型定义=全身无衣物,衣物系此后 i2i 注入)
  // 10-27 store 位接线:store-only 角色的骨架素体句与运行时派生 parity
  // (characterJsonInfo||storePromptInfo 收窄放宽;用户改 store JSON 后闸句随变)。
  const characterBodyBaseSubject = useMemo(
    () => (characterJsonInfo || storePromptHit) && characterJsonText !== null
      ? deriveSubjectFromCharacterJson(characterJsonText, null)
      : null,
    [characterJsonInfo, storePromptHit, characterJsonText],
  );
  const characterPromptCatalog = useMemo(
    () => characterJsonInfo && characterJsonText !== null ? parseCharacterPromptCatalog(characterJsonText) : null,
    [characterJsonInfo, characterJsonText],
  );
  const subjectMirrorActive = Boolean(characterJsonInfo) && characterSubjectMirror !== null;
  // 派发/保存用主体句(TS 收窄:镜像激活=真源派生句,否则 DB 值)
  const effectiveSubjectPrompt = characterSubjectMirror !== null && Boolean(characterJsonInfo)
    ? characterSubjectMirror
    : draftPrompt;
  /** 关弹窗/切资产时清理生成路的阶段选择；退役阶段子区不再维护读取缓存。 */
  const resetStageState = () => {
    setSelectedStage(null);
  };

  useEffect(() => {
    try {
      window.localStorage?.setItem(META_COLLAPSED_STORAGE_KEY, metaCollapsed ? "1" : "0");
    } catch {
      // localStorage 不可用(隐私模式等):折叠态仅会话内生效,不阻断
    }
  }, [metaCollapsed]);

  useEffect(() => {
    try {
      window.localStorage?.setItem(GALLERY_COLLAPSED_STORAGE_KEY, galleryCollapsed ? "1" : "0");
    } catch {
      // localStorage 不可用(隐私模式等):折叠态仅会话内生效,不阻断
    }
  }, [galleryCollapsed]);


  // linkedSpeakerIds(1120 独立页役:计算随弹窗退役迁入 view 消费):资产名全
  // 分隔符别名解析后收集项目内匹配的角色库条目 speaker 键(共享资产如「李先生;
  // 管事」拆开的各角色键都接住),分配音色时统一双写,保证工作流试听/成片一致。
  // 旧 fallbackRow(工作流行 id 兜底键)随两消费方改 store 落 target 而退役——
  // 名字匹配主体保留(实现期按 PRD §10.5 最小面定)。
  const linkedProjectId = useProjectStore((state) => state.activeProjectId);
  const linkedCharacters = useCharacterLibraryStore((state) => state.characters);
  const detailOrigin = useAssetDetailViewStore((state) => state.origin);
  const detailSourceRowId = useAssetDetailViewStore((state) => state.sourceRowId);
  const linkedSpeakerIds = useMemo<TtsSpeakerId[]>(() => {
    if (asset?.type !== "role") return [];
    const names = new Set(parseAssetNames(asset.name ?? "").allNames);
    const ids = linkedCharacters
      .filter(
        (character) =>
          (!linkedProjectId || character.projectId === linkedProjectId) &&
          names.has(character.name.trim()),
      )
      .map((character) => toRoleSpeakerId(character.id));
    // 复审 M2 修:script-tab 行兜底(旧 collectLinkedSpeakerIds 语义回归)——
    // 资产名≠角色库现名(改名晚于剧本行生成)时,角色行自身 speaker 键仍入列,
    // 分配音色双写不静默断
    if (detailOrigin === "script-tab" && detailSourceRowId) {
      const fallback = toRoleSpeakerId(detailSourceRowId);
      if (!ids.includes(fallback)) ids.push(fallback);
    }
    return ids;
  }, [asset?.type, asset?.name, linkedCharacters, linkedProjectId, detailOrigin, detailSourceRowId]);

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
  }, [focusKind, displayImages]);

  // 阶段提示词子区已退役；PNG 元数据仅由仍在使用的终稿探针和查词入口读取。

  // 「弹窗关即清理」effect 随弹窗壳退役(1120 详情独立页):「宿主关」=组件卸载,
  // state/队列/ref 全随卸载销毁;切资产清理由下方 [asset?.id] effect 接管
  // (10-19 双弹勘误/10-25 A-1/A-2③/B-3 的关时清语义由「卸载即清」承接)。

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
      setGenerationOutcome(null);
      queueRecordsRef.current = [];
      setPromptOverridesDraft({});
      setPromptOverridesHydrated(false);
      setInstructionDrafts({});
      setInstructionEditOpen(false);
      resetStageState();
      return;
    }

    // 切资产也清(同弹窗内换资产时 previewIndex 可能指向旧资产图序;族过滤
    // 路径属旧资产会话,直换 A→B 时同样清——10-25 深审修,与注释「切资产即清」对齐;
    // focusKind 同理属旧资产会话的聚焦态,随切重置;A-3 润色快照/查词弹层目标同理;
    // 生成路 selectedStage 同样随切资产重置。
    setPreviewIndex(null);
    setRemovedFamilyPaths([]);
    setFocusKind(null);
    setPrePolishPrompt(null);
    setPromptInspectTarget(null);
    // R5 结果弹窗/队列累积随切资产清(旧资产会话的记录不带入新宿主)
    setGenerationOutcome(null);
    queueRecordsRef.current = [];
    setPromptOverridesDraft({});
    setPromptOverridesHydrated(false);
    setInstructionDrafts({});
    setInstructionEditOpen(false);
    resetStageState();

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
    // Phase C 播种:桥缺席兜底资产行的槽值(桥成功位随后覆盖)——播种即水合
    setPromptOverridesDraft(parsePromptOverrides(asset.promptOverrides));
    setPromptOverridesHydrated(true);

    if (getStudioAssetsBridge()?.get) {
      getStudioAssetsBridge()!.get(asset.id).then((result) => {
        if (!result || cancelled) return;
        setFullAsset(result);
        setDraftName(result.name || "");
        setDraftDescription(result.description || "");
        setDraftPrompt(result.prompt || "");
        setDraftSetting(result.setting || "");
        // Phase C 播种:fullAsset 槽值为准(桥 get 全列)——播种即水合
        setPromptOverridesDraft(parsePromptOverrides(result.promptOverrides));
        setPromptOverridesHydrated(true);
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
  // 收拢为降态行,高清人头双路并注),一键生成/画风转换清空回通用态;生成派发
  // 本身零变。定义在 actions 装配之前:一键补缺队列经 onFillMissingKindFocus
  // 钩子逐型复用(队列直调底层执行器,复审修 A-1 写入点第4项)。
  const focusOnKind = (kind: AssetImageKind) => {
    setFocusKind(kind);
    setSubjectExpanded(false);
    setInstructionEditOpen(false);
  };

  // R5 生成结果回调(10-26 用户令:每次生成完成自动弹出):四路 done 即发,与 get/
  // 写回成败无关(写回失败弹窗照弹,②段走降级文案)。孤儿防护——宿主关闸随弹窗壳
  // 退役(卸载=关,卸载后 setState 零渲染);跨资产 record 丢弃闸仍在(单发防旧资产
  // 结果弹错宿主,队列防切资产后旧资产汇总盖新宿主——对齐 10-25 深审修哲学;丢弃路
  // 靠既有 toast「已入库;不回填」+库内产物兜底告知)。
  const handleImageGenerated = (record: GenerationOutcomeRecord) => {
    if (record.assetId !== activeAssetIdRef.current) return;
    if (record.fromQueue) {
      queueRecordsRef.current = [...queueRecordsRef.current, record];
      return;
    }
    setGenerationOutcome({ records: [record], batch: null });
  };
  // R5 队列收口=末尾汇总(方案定死):恒先清空 ref 防跨会话陈旧累积;零记录
  // 不弹(宿主关=卸载,卸载后 setState 零渲染;同资产关后再开=队列继续且汇总照弹)。
  const handleQueueSettled = (batch: { total: number; completed: number; abortedKind?: string }) => {
    const records = queueRecordsRef.current;
    queueRecordsRef.current = [];
    if (records.length === 0) return;
    setGenerationOutcome({ records, batch });
  };

  // This action factory is named with a use* prefix for historical API
  // compatibility, but it is a pure closure factory. Invoke it on every
  // render before the nullable-asset early return so React hook ordering is
  // stable even while the dialog is closed or clearing its selection.
  const {
    handleSave, handleDelete,
    handleRemoveImage, handleTranscribe, handleFacePortraitFromImage, handleExpressionSheet,
    handleTypeShot: dispatchTypeShot, handleFillMissingQueue, handleRerollFromPrompt,
  } = useStudioAssetDialogActions({
    asset,
    // 1120 独立页:actions 内的「关闭宿主」语义(删除成功/打开 ComfyUI 画布)
    // 由弹窗 onOpenChange(false) 改为返回列表 onBack()
    onOpenChange: () => onBack(),
    visualManualId,
    detail: fullAsset || asset,
    images,
    i2iPhase,
    displayImages,
    familyImages,
    currentIndex,
    getActiveAssetId: () => activeAssetIdRef.current,
    getDisplayImages: () => displayImagesRef.current,
    onImagesCollected: (collected) => {
      displayImagesRef.current = collected;
    },
    removedFamilyPaths,
    draftName,
    draftDescription,
    // 真源接线(10-26):镜像激活时派发/保存用真源派生主体句(陈旧 DB 种子自愈)
    draftPrompt: effectiveSubjectPrompt,
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
    // 1120 按钮态精修(§10.3):busyTarget 写入口(六条发起链设/清同址 try/finally)
    setBusyTarget,
    onFillMissingKindFocus: focusOnKind,
    onImageGenerated: handleImageGenerated,
    onFillMissingQueueSettled: handleQueueSettled,
    // 10-26 型区分令:素体型主体句走闸函数(恒 body_base 素体句;无真源且兜底句
    // 带衣物→阻断,禁发带衣人设句出带衣错图)
    getKindSubjectOverride: (kind) => {
      const slot = promptOverridesDraft[kind]?.trim() || undefined;
      const gate = resolveBareTypeSubjectGate({
        kind,
        bodyBaseSubject: characterBodyBaseSubject,
        fallback: effectiveSubjectPrompt,
        slot,
      });
      if (gate.subject) {
        // 10-27 用户令「自动生成+看位置」:自动派生的素体句落该型本型槽
        // (槽按钮可见可改,随保存入库;下次派发槽优先直用不再重派生)
        if (gate.derived) {
          const derivedText = gate.subject;
          if (slot !== derivedText) {
            setPromptOverridesDraft((prev) => ({ ...prev, [kind]: derivedText }));
            toast.info(`已自动生成${kind}素体主体句(剥除衣物描述,随保存入库)`);
          }
        }
        return gate.subject;
      }
      if (gate.block) return undefined; // 阻断型:不给 override,actions 侧 block 先拦
      return slot; // 其他型=既有槽行为
    },
    getKindSubjectBlock: (kind) =>
      resolveBareTypeSubjectGate({
        kind,
        bodyBaseSubject: characterBodyBaseSubject,
        fallback: effectiveSubjectPrompt,
        slot: promptOverridesDraft[kind]?.trim() || undefined,
      }).block ?? null,
    getInstructionOverride: (kind) => instructionDrafts[kind]?.trim() || undefined,
    // 10-26 横竖皆可(人物海报裁定):会话级横幅取向
    getLandscapeOrientation: (kind) => kind === "人物海报" && posterLandscape,
    promptOverridesDraft: promptOverridesHydrated ? (promptOverridesDraft as Record<string, string>) : undefined,
    setActiveStudio,
    setActiveTab,
    resolveAssetGenerationReferenceImage,
    resolveThreeTrackAssetType,
  });

  const handleTypeShot = (kind: AssetImageKind, options?: { busyTargetKey?: string }) => {
    focusOnKind(kind);
    // T3(10-25 阶段矩阵,PRD §3.3):生成路「阶段」选择随派发同帧透传(命名与 i2i
    // 参考图锚定用;「无」=不带阶段,既有行为)。人脸双钮/表情差分/重掷不经此包装。
    // 1120 按钮态精修:节头钮调用缺省 busyTargetKey(undefined=actions 侧落
    // section:<kind> 键);占位 CTA 入口显式传 placeholder:<kind>(候裁2 CTA 自转)。
    dispatchTypeShot(kind, { stage: selectedStage ?? undefined, busyTargetKey: options?.busyTargetKey });
  };
  if (!asset) return null;

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
  // 10-21 高清人脸:仅角色轨显示人脸按钮(图生图/文生图两路)
  const canFacePortrait = asset.type === "role";
  // 10-24 批3 按型出图+Round 3 扩展令⑤:图片三轨(role/scene/tool)显示型驱动生成族
  // (节头钮+下拉+一键补缺;型谱按轨取谱),clip/audio 零侵入
  const canTypeShot = isThreeTrackAsset;
  const roleSpeakerId = toRoleSpeakerId(asset.id);
  const roleVoiceBindings = activeTtsProjectId ? (ttsProjects[activeTtsProjectId]?.bindings ?? {}) : {};
  const roleVoiceBinding = asset.type === "role" ? roleVoiceBindings[roleSpeakerId] : undefined;
  const roleVoiceProfile = roleVoiceBinding ? voiceProfiles[roleVoiceBinding.profileId] : undefined;

  // 10-25 分层面板役 A-2 聚焦态派生:focusKind→i2i 族判定(主体句降态/槽资格用;
  // 10-26 用户令:型层分层/指令卡取源/构成摘要随旧构成区砍除退役)
  const focusIsI2iFamily = focusKind ? isI2iFocusKind(focusKind) : false;
  // Phase C(10-25 追加令):主体句槽派生——槽在场=框绑槽值;eligible=t2i 族或
  // 高清人头(其文生图路主体句参与;i2i 族主体句不参与,槽无意义不展示)
  const kindSlotActive = !!focusKind && promptOverridesDraft[focusKind] !== undefined;
  const subjectValue = kindSlotActive && focusKind
    ? (promptOverridesDraft[focusKind] ?? "")
    : subjectMirrorActive && characterSubjectMirror !== null
      // 真源镜像优先于 DB 种子(本型专用槽仍最优先——应用层显式覆写)
      ? characterSubjectMirror
      : draftPrompt;
  const handleSubjectChange = (value: string) => {
    if (kindSlotActive && focusKind) {
      setPromptOverridesDraft((prev) => ({ ...prev, [focusKind]: value }));
    } else {
      setDraftPrompt(value);
    }
  };

  // 1120 三令2:五路生成相位任一在跑=图片区折叠摘要的「生成中」旗(进度不因折叠失明;
  // 1120 按钮态精修随迁:同源收窄运行态——done/failed 反馈窗不挂「生成中」误导旗)
  const isGenerationLaneBusy = isLanePhaseRunning(generatePhase) || isLanePhaseRunning(i2iPhase)
    || isLanePhaseRunning(facePhase) || isLanePhaseRunning(expressionPhase) || isLanePhaseRunning(typeShotPhase);

  // ② 图片区主体(preview pane 全 props 装配;audio 型播报卡与三轨/clip 图片区共用
  // 同一装配——1120 三令2 折叠壳只包图片区,audio 照旧随页不折叠)
  const previewPane = (
    <StudioAssetDetailPreviewPane
    asset={asset}
    images={displayImages}
    /* 批3 复审 M 修(Round 3 Q1):完整度两行分级/核心红点基准=本行自有图集,
     * 族聚显(displayImages 含族兄弟行)同型图不抵扣本行缺口;画廊展示序不变 */
    completenessImages={images}
    posterLandscape={posterLandscape}
    onTogglePosterLandscape={togglePosterLandscape}
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
    i2iPhase={i2iPhase}
    i2iMessage={i2iMessage}
    generatePhase={generatePhase}
    onFaceFromImage={() => {
      // A-1 写入点:高清人头双钮→高清人头
      focusOnKind("高清人头");
      handleFacePortraitFromImage();
    }}
    onExpression={() => {
      // A-1 写入点:表情差分→表情差分
      focusOnKind("表情差分");
      handleExpressionSheet();
    }}
    expressionPhase={expressionPhase}
    expressionMessage={expressionMessage}
    facePhase={facePhase}
    faceMessage={faceMessage}
    canFacePortrait={canFacePortrait}
    canTypeShot={canTypeShot}
    onTypeShot={handleTypeShot}
    typeShotPhase={typeShotPhase}
    typeShotMessage={typeShotMessage}
    /* 1120 按钮态精修(§10.5):spinner 唯一真源键传入(五相位照旧并行供反馈) */
    busyTarget={busyTarget}
    onFillMissing={handleFillMissingQueue}
    onInspectPrompt={handleInspectPrompt}
    /* 批3(10-24)+Round 3 ⑤/⑥:占位卡 CTA/完整度缺失 chip 直达生成全型路由
     * ——高清人头按有图择图生图/文生图路,表情差分接既有路,余型走
     * handleTypeShot 型驱动件(route 分流:设定卡/美宣/道具=t2i+base_type,
     * 余=i2i+base_type 型层注入,Phase 2 已切)。
     * 10-25 分层面板 A-1:入口点击即聚焦目标型(focusOnKind 同帧写入) */
    onGenerateByKind={(kind) => {
      focusOnKind(kind);
      // 1120 按钮态精修(候裁2):占位 CTA 被点=CTA 自身转(placeholder:<kind> 键,
      // 该型节头钮不代转)
      if (kind === "高清人头") {
        // 10-26 用户令:高清人脸没有文生图——恒走无衣物定妆图生图;
        // 缺定妆图=runFacePortrait 内建守卫拦截并引导先生成定妆
        handleFacePortraitFromImage({ busyTargetKey: busyKey.placeholder(kind) });
        return;
      }
      if (kind === "表情差分") {
        handleExpressionSheet({ busyTargetKey: busyKey.placeholder(kind) });
        return;
      }
      handleTypeShot(kind, { busyTargetKey: busyKey.placeholder(kind) });
    }}
    isImageRemovable={(image) => {
      const entry = displayImages.find((item) => item.filePath === image.filePath);
      return entry ? entry.removable : true;
    }}
  />);

  return (
    <>
      {/* 1120 详情独立页(§5.1):DialogContent 弹窗壳退役→页容器占满资产 tab 内容区;
          页头栏=「← 返回列表」+Icon+名+型徽章+保存/删除常驻(原底部行撤,页头单真源——
          折叠基础信息也不再留保存/删除摘要)。Esc 不再关详情页(弹窗壳拆即天然退役)。 */}
      <div
        className="studio-asset-detail-view flex h-full min-h-0 flex-col overflow-hidden bg-card/50"
        role="region"
        aria-label={`资产详情 ${displayName}`}
      >
        <header className="studio-asset-detail-header flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2"
            onClick={onBack}
            aria-label="返回列表"
            title="返回资产列表"
          >
            <ArrowLeft className="h-4 w-4" />
            返回列表
          </Button>
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 truncate text-base font-semibold" title={displayName}>{displayName}</span>
          <Badge variant="outline" className="ml-1 shrink-0">{TYPE_LABEL[asset.type]}</Badge>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button size="sm" className="h-7" onClick={handleSave}>保存</Button>
            <Button size="sm" variant="destructive" className="h-7" onClick={handleDelete}>删除</Button>
          </div>
        </header>

        {/* 10-24 布局重造批1:竖向滑动单列——① 基础信息区置顶(可折叠)→ ② 图片规范区主体 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ScrollArea className="studio-asset-dialog-scrollbar min-h-0 min-w-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:block!">
            <div className="min-w-0 space-y-4 p-5">
              {/* ① 基础信息区(1120 三令1 更名;紧凑四行网格+可折叠,
                  折叠留摘要;保存/删除=页头常驻单真源,折叠摘要不再重复) */}
              <section className="studio-asset-meta-region rounded-lg border border-border bg-muted/30" aria-label="资产基础信息">
                <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-4 py-2">
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setMetaCollapsed((collapsed) => !collapsed)}
                    aria-expanded={!metaCollapsed}
                    aria-controls="studio-asset-meta-body"
                  >
                    {metaCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    基础信息
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
                    </>
                  )}
                </div>
                {!metaCollapsed && (
                  <div id="studio-asset-meta-body" className="grid grid-cols-2 gap-3 p-4">
                    {/* 1120 用户令·版式重构③:名字|设定按钮同行 → 音频配置(音色) →
                     出图提示词;设定点击弹 MD 编辑(描述+设定同框编辑+预览)。 */}
                    <section className={`min-w-0 space-y-1.5 ${asset.type === "audio" ? "col-span-2" : ""}`}>
                      <div className="text-xs font-medium text-muted-foreground">名字</div>
                      <input
                        className="w-full rounded-md border border-border bg-muted/90 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        placeholder="主名字;副名字1;副名字2"
                      />
                      {/* 1120 用户令·清理:主名字提示/英文分号提示砍除(提示文案),
                          只留副名字徽章(数据) */}
                      {parsedDraftName.secondaryNames.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {parsedDraftName.secondaryNames.map((name) => (
                            <Badge key={name} variant="outline" className="px-1.5 py-0 text-[10px] font-medium">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </section>
                    {/* 设定入口(1120 用户令③:与名字同行,按钮弹 MD 编辑) */}
                    {asset.type !== "audio" && (
                      <section className="flex min-w-0 flex-col gap-1.5">
                        <div className="shrink-0 text-xs font-medium text-muted-foreground">设定</div>
                        <button
                          type="button"
                          onClick={() => setSettingEditorOpen(true)}
                          className="flex h-[38px] w-full items-center gap-2 rounded-md border border-border bg-muted/90 px-3 text-left text-sm transition-colors outline-none hover:border-primary/50 focus-visible:border-primary"
                          title="打开设定 Markdown 编辑(描述+设定,源码与预览同框)"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate">{(draftSetting || asset.setting || "").trim() ? "编辑设定(Markdown)" : "编写设定(Markdown)"}</span>
                        </button>
                      </section>
                    )}
                    {/* audio 型:无音色/提示词/设定卡,说话内容独占全宽 */}
                    {asset.type === "audio" && (
                      <section className="col-span-2 flex min-w-0 flex-col gap-1.5">
                        <div className="shrink-0 text-xs font-medium text-muted-foreground">说话内容</div>
                        <Textarea
                          value={spokenText}
                          onChange={(event) => {
                            setDraftDescription(event.target.value);
                            setRecognizedText(null);
                          }}
                          placeholder="暂无口播词句"
                          className="min-h-[96px] flex-1 resize-none bg-muted/90 text-xs leading-5"
                        />
                      </section>
                    )}
                    {/* 行2: 音色(仅 role,恒全宽)——1120 用户令:人物属性卡撤除,
                     与「设定」合一(属性卡本就是设定文本的只读解析视图,信息本体在
                     设定框,双框展示属冗余);音色不再钉右列,col-span-2 恒全宽 */}
                    {asset.type === "role" && (
                      <div className="col-span-2 min-w-0 h-full">
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
                                  {roleVoiceProfile.referenceAudioPath && <div className="col-span-2 truncate" title={displayAudioPath(roleVoiceProfile.referenceAudioPath)}><span className="text-muted-foreground">参考音频：</span>{displayAudioPath(roleVoiceProfile.referenceAudioPath)}</div>}
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
                    {/* 10-27 用户令「技能之类的确实不应该展示」:技能卡整块撤
                     (数据仍在 DB skills 列,仅弹窗不渲染) */}
                    {/* 出图提示词(1120 用户令:设定收进按钮+MD 弹窗后,提示词紧随
                     音色;10-25 分层面板役 A-2:①主体句+②「提示词构成」折叠组
                     +③实发终稿桩,三轨 role/scene/tool 通用) */}
                    {asset.type !== "audio" ? (
                      <section className="studio-asset-prompt-region col-span-2 min-w-0 space-y-1.5" aria-label="提示词">
                        {/* R1/R3(10-26 用户令):「查看源提示词/查看实发终稿」收敛到首行紧凑
                            动作组;R2 复制钮砍除(文本框全选即复制);R4 idle 态提示行砍除
                            (非 idle 旁注仍随 probe 态展示) */}
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <div className="text-xs font-medium text-muted-foreground">提示词</div>
                          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                            {/* ② 源提示词 JSON 弹窗(10-26 用户令:砍旧构成四层卡,一钮直出) */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 text-[11px]"
                              onClick={() => setSourcePromptOpen(true)}
                              title="弹窗展示该型在 qi21_bases.json 中的原始提示词数据(JSON 格式)"
                            >
                              <FileText className="h-3 w-3" />
                              查看源提示词
                            </Button>
                            {/* 提示词真源 JSON(10-26 用户令;10-27 接线放宽):repo 手工
                                真源(art_skills/<包>/json/<角色名>.json,如 晏燎.json)或
                                项目库 store 位(store/assets/files/prompts/<名>.json)任一
                                命中即出钮;弹窗=完整展示+CodeMirror 可编辑,存 store 位。
                                scene/tool 同轨复用 */}
                            {characterJsonInfo || storePromptHit ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 gap-1 text-[11px]"
                                onClick={() => setCharacterJsonOpen(true)}
                                title={`查看/编辑该${TYPE_LABEL[asset.type]}的提示词真源 JSON(${characterJsonInfo?.relativePath ?? "store/assets/files/prompts"})`}
                              >
                                <FileJson className="h-3 w-3" />
                                提示词真源JSON
                              </Button>
                            ) : null}
                            {/* ③ 查看实发终稿(A-2③):探针 ready 才可点(focusKind 组末位
                                回溯读 tEXt);无聚焦/无产物/全无 tEXt 置灰注明(§4.4);
                                弹层=正向终稿+注入层全文(共用查词壳) */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 text-[11px]"
                              disabled={finalDraftProbe.status !== "ready"}
                              onClick={handleOpenFinalDraft}
                              title={
                                finalDraftProbe.status === "ready"
                                  ? "查看该型最近产物的引擎实收终稿"
                                  : finalDraftProbe.status === "idle"
                                    ? "聚焦某型后可查看该型最近产物的实发终稿"
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
                            {FINAL_DRAFT_NOTE_BY_STATUS[finalDraftProbe.status] ? (
                              <span
                                className="studio-asset-final-draft-note min-w-0 truncate text-[10px] text-muted-foreground/80"
                                title={FINAL_DRAFT_NOTE_BY_STATUS[finalDraftProbe.status]}
                              >
                                {FINAL_DRAFT_NOTE_BY_STATUS[finalDraftProbe.status]}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {/* 1120 用户令·图像规范清单:一表答「该有哪些类型/各几张/
                            现有几张」;加粗=核心必备,红数字=核心缺失,灰=扩展可选。
                            1120 独立页顺手修(§5.4):列沟 gap-x-6 加宽,计数与下一列
                            名拉开(vision 实测显挤,速读易错配) */}
                        {imageRuleRows.length > 0 && (
                          <div className="grid grid-cols-3 gap-x-6 gap-y-1 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[11px]" aria-label="图像规范清单">
                            {imageRuleRows.map((row) => (
                              <div key={row.kind} className="flex min-w-0 items-baseline gap-1.5">
                                <span
                                  className={`min-w-0 truncate ${row.core ? "font-medium text-foreground" : "text-muted-foreground"}`}
                                  title={`${row.kind}(${row.aspect}${row.core ? ",核心必备" : ",扩展可选"})`}
                                >
                                  {row.kind}
                                </span>
                                <span className="shrink-0 text-[10px] text-muted-foreground/70">{row.aspect}</span>
                                <span className={`ml-auto shrink-0 tabular-nums ${row.core && row.count === 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                                  {row.count}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* ① 主体句(主位可编辑;Phase C:聚焦型可开「本型专用」槽)。
                            头部行旁=T3「阶段」选择器(10-25 阶段矩阵,PRD §3.3):选项=
                            已聚类阶段集+「无」(默认);守卫同子区(<2 阶段不渲染);
                            选中后按型出图命名带阶段段+i2i 参考图锚该阶段最新图。
                            10-26 真源接线:有真源目录的角色,本区=「人物提示词」结构化
                            面板(JSON 数据化呈现+文生图/图生图标注,随阶段联动),
                            主体句文本框退场(派发仍吃真源派生句)。
                            10-26 控件精简令:真源角色区头整行不渲染(标签/「阶段」
                            选择器/专用句钮全退场,卡片直接排;面板恒显 activeStage
                            =聚类最高境界,阶段职能退由派发默认承担) */}
                        {/* 10-27 用户令「这些控件不需要展示」:区头行整行不渲染(主体句标签/阶段
                            选择器/本型专用句钮,真源与非真源一律零区头;槽机制转地下,派发照吃槽值) */}
                        {characterPromptCatalog ? (
                          /* 10-26 用户令「展示基础相关的提示词,而不是阶段相关的」+
                             「不要重复」:面板只显基础两卡(人脸基准/无衣物定妆(素体基底)),
                             阶段指令不展示(仍住真源JSON,「角色真源JSON」弹窗可查) */
                          <StudioAssetCharacterPrompts catalog={characterPromptCatalog} />
                        ) : focusIsI2iFamily && focusKind && !subjectExpanded ? (
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
                            {subjectMirrorActive ? (
                              <div
                                className="text-[10px] leading-3 text-muted-foreground/80"
                                title={`主体句随「阶段」选择取自角色真源 JSON(${characterJsonInfo?.relativePath ?? ""});要改内容请点「角色真源JSON」编辑保存`}
                              >
                                主体句随阶段取自真源JSON(只读镜像,编辑走「角色真源JSON」)
                              </div>
                            ) : null}
                            <Textarea
                              value={subjectValue}
                              onChange={(event) => handleSubjectChange(event.target.value)}
                              placeholder={kindSlotActive && focusKind ? `本型专用句(仅${focusKind}生成路生效;保存入库)` : "暂无出图提示词"}
                              className={`min-h-[96px] resize-none bg-muted/90 text-xs leading-5 ${focusIsI2iFamily ? "opacity-70" : ""}`}
                              readOnly={subjectMirrorActive}
                            />
                          </>
                        )}
                      </section>
                    ) : null}
                    {/* 底部保存/删除行已撤(1120 详情独立页:保存/删除上移页头常驻,
                        一处真源——折叠任意区也不用再留按钮副本;留痕见 git 历史) */}
                  </div>
                )}
              </section>

              {/* 空壳资产生成引导(基础信息区与图片区之间,现链路保持) */}
              {asset.type !== "audio" && !draftDescription.trim() && !draftPrompt.trim() && !draftSetting.trim() && !hasImagePreview && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="text-sm font-medium text-foreground">此角色尚无详细数据</div>
                  <p className="text-xs text-muted-foreground">
                    「{displayName}」在资产库中仅有名称记录，缺少描述、设定和图片。
                    可在「提示词」区域填写主体句，在各型节头点「生成…」出图，完成后自动弹出结果确认，再点「保存」。
                  </p>
                </div>
              )}

              {/* ② 图片区(垂直滚动主体:role 型节骨架/scene·tool 单节横行/audio 播报卡)。 */}
              {/* 10-26 人物海报画幅开关挪「人物海报」节头(位置在它管的型旁)+
                  持久化(localStorage);全局区不再渲染独立行 */}
              {/* 1120 三令2(§5.3):preview pane 外包整区折叠壳(标题「图片」,§9 候裁1/2
                  已定=整区折叠+文案「图片」;默认展开,localStorage 记忆)——折叠态整区
                  只留一行摘要(N 型 · M 张;生成中:五路相位任一在跑即增补,进度不因折叠
                  失明)。audio 型播报卡照旧随页不折叠(§3 非目标:audio 特殊分支语义不迁移)。 */}
              {asset.type === "audio" ? (
                previewPane
              ) : (
              <section className="studio-asset-gallery-region rounded-lg border border-border bg-muted/30" aria-label="图片">
                <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-4 py-2">
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setGalleryCollapsed((collapsed) => !collapsed)}
                    aria-expanded={!galleryCollapsed}
                    aria-controls="studio-asset-gallery-body"
                  >
                    {galleryCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    图片
                  </button>
                  {galleryCollapsed && (
                    <>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm text-muted-foreground">
                        {imageRuleRows.length > 0
                          ? `${imageRuleRows.length} 型 · ${displayImages.length} 张`
                          : `${displayImages.length} 张`}
                        {isGenerationLaneBusy && (
                          <span className="inline-flex shrink-0 items-center gap-1 text-primary">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            生成中
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </div>
                {!galleryCollapsed && <div id="studio-asset-gallery-body">{previewPane}</div>}
              </section>
              )}

            </div>
          </ScrollArea>
        </div>
      </div>
      {/* 10-19 用户令:全屏缩放预览——复用 MediaPreviewModal(滚轮缩放/双击/拖拽/批量翻页) */}
      {/* 弹窗关=预览关:previewIndex 不清零→Lightbox 全屏遮罩残留→堵住所有 UI 点击(10-19 实弹勘误) */}
      {/* 批2 B 节:预览序列=当前节图集(节内上下张)——按点击位的型解析所属节,取该节
          图集与节内局部序;10-25 深审修:三轨(role/scene/tool)均分节=节内序,
          clip/audio 单节=全展示序(Round 3 ⑤ 后 scene/tool 已型谱分节,原 role 限定
          属旧口径)。节内 url 序与 initialIndex 同构产出,根除下标错位隐患。 */}
      {previewIndex !== null && displayImages[previewIndex] && (() => {
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
      {/* 1120 版式③:设定 MD 编辑弹窗(描述+设定同框,应用回填 draft) */}
      {asset.type !== "audio" && (
        <StudioAssetSettingDialog
          open={settingEditorOpen}
          name={parsedDraftName.primaryName}
          description={draftDescription}
          setting={draftSetting}
          onOpenChange={setSettingEditorOpen}
          onApply={(next) => {
            setDraftDescription(next.description);
            setDraftSetting(next.setting);
            setRecognizedText(null);
          }}
        />
      )}
      {/* 10-25 分层面板役:③实发终稿/B-3 查词共用 tEXt 查询弹层(打开=目标非空;
          关闭清目标,复用按目标重读) */}
      <StudioAssetSourcePromptDialog
        open={sourcePromptOpen}
        onOpenChange={setSourcePromptOpen}
        initialKind={focusKind}
      />
      {/* 提示词真源 JSON(10-26 用户令;10-27 store 位接线):完整展示+可编辑
          (repo 手工真源与 store 位生成件同待遇);宿主关即卸。type 收窄=真源域
          只覆盖 role/scene/tool 三轨,clip/audio 不传(按 undefined 平铺名探测)。 */}
      <StudioAssetCharacterJsonDialog
        open={characterJsonOpen && Boolean(characterJsonInfo || storePromptHit)}
        characterName={asset.name}
        type={promptJsonTypeOf(asset.type)}
        onOpenChange={setCharacterJsonOpen}
      />
      {/* R5 生成结果弹窗(10-26 用户令:每次生成完成自动弹出)。挂载守卫=有记录
          (宿主关=页卸载,卸载后任何异步竞态漏网 setState 也零渲染;嵌套弹窗已知坑①) */}
      <StudioAssetGenerationResultDialog
        open={generationOutcome !== null}
        onOpenChange={(next) => {
          if (!next) setGenerationOutcome(null);
        }}
        outcome={generationOutcome}
      />
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
