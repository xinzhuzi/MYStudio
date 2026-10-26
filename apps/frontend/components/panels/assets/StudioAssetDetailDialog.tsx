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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  mergeFamilyDisplayImages,
  type FamilyDisplayImageEntry,
  type FamilyImageEntry,
} from "@/lib/studio/asset-family-images";
import { classifyAssetImage } from "@/lib/studio/asset-image-kind";
import { clusterAssetStages } from "@/lib/studio/asset-stage-prompts";
import { parseWorkflowPrompt } from "@/lib/studio/workflow-prompt-parser";
import { parsePromptOverrides } from "@/lib/studio/asset-prompt-layers";
import {
  buildFinalDraftCandidates,
  resolvePromptOwnerNote,
  type PromptInspectCandidate,
  type PromptTextFailReason,
} from "@/lib/studio/asset-prompt-inspect";
import { getAssetTypeShotProfile } from "@/lib/studio/asset-type-shot";
import { StudioAssetDetailPreviewPane } from "./studio-asset-detail-preview-pane";
import { StudioAssetSourcePromptDialog } from "./studio-asset-source-prompt-dialog";
import { StudioAssetCharacterJsonDialog } from "./studio-asset-character-json-dialog";
import { StudioAssetCharacterPrompts } from "./studio-asset-character-prompts";
import {
  deriveSubjectFromCharacterJson,
  resolveBareTypeSubjectGate,
  getCharacterJsonInfo,
  loadCharacterJsonText,
  parseCharacterPromptCatalog,
} from "@/lib/studio/asset-character-json";
import { StudioAssetPromptTextDialog, type PromptTextInspectTarget } from "./studio-asset-prompt-text-dialog";
import {
  StudioAssetGenerationResultDialog,
  type GenerationOutcome,
  type GenerationOutcomeRecord,
} from "./studio-asset-generation-result-dialog";
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

/** ③ 按钮旁小字(probe 态→注明文案;ready=PRD 钉的固定小字;idle 空=R4 砍除提示行)。 */
const FINAL_DRAFT_NOTE_BY_STATUS: Record<FinalDraftProbe["status"], string> = {
  idle: "",
  "no-products": "该型尚无产物",
  probing: "正在读取该型最近产物…",
  unreadable: "该型最近产物未携带提示词元数据",
  "bridge-missing": "当前环境不支持读取提示词元数据",
  ready: "来自该型最近产物的引擎实收,非本次预演",
};

/**
 * 阶段提示词子区·单型懒读结果(10-25 阶段矩阵 T2,PRD §3.2):ready=该阶段该型
 * 组最新一张 tEXt 解构出的正向终稿+字数;failed=桥缺席/B-1 reason/键位漂移
 * (parse-drift 单列文案,禁把原始 JSON 当终稿展示)。按 `阶段__型` 键缓存组件态,
 * 弹窗关/切资产清零。
 */
type StagePromptTextEntry =
  | { status: "probing" }
  | { status: "ready"; finalText: string; charCount: number }
  | { status: "failed"; reason: PromptTextFailReason | "bridge-missing" | "parse-drift" };

/** 阶段缓存键(PRD §3.2 钉「按 stage+kind 缓存」;切资产/关弹窗整表清零)。 */
function stagePromptCacheKey(stage: string, kind: AssetImageKind): string {
  return `${stage}__${kind}`;
}

/** T3「阶段」选择器「无」哨兵值(Radix Select 值域须字符串;null 语义映射到此)。 */
const STAGE_SELECT_NONE = "__stage_none__";

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
  const [posterLandscape, setPosterLandscape] = useState(false);
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
  // 10-25 阶段矩阵(T2/T3 共用,PRD §3.2/§3.3):生成路「阶段」选择与子区聚焦共用;
  // null=「无」(T3 默认);子区展示位回落聚类末位(最高境界,§3.2)。随弹窗关/切资产重置。
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  // T2 阶段子区懒读缓存(阶段__型→终稿/降级态;PRD 钉组件态,弹窗关清)+在飞去重集
  // (值位随构成区砍除退役:读取走 ref,本态仅作缓存写入的重渲染触发)
  const [, setStageTextCache] = useState<Record<string, StagePromptTextEntry>>({});
  const stageTextCacheRef = useRef<Record<string, StagePromptTextEntry>>({});
  const stageReadInFlightRef = useRef<Set<string>>(new Set());
  // 会话代(10-25 复审竞态修):复位点(关弹窗/切资产 resetStageState)递增——在飞读取的
  // 迟到写入按代隔离,旧代全弃防污染下一会话;同会话内依赖重跑(images 异步回填/重开弹窗
  // bridge.get 回填/生成完成,凡换 displayImages→activeStageCluster 身份)不换代,在飞
  // 结果照常落缓存。取代旧 cancelled 旗:cancelled 在依赖重跑时也置位,在飞结果被整批
  // 丢弃+重跑轮 pending 又滤掉在飞键→作业完成后无人再触发,该阶段型卡正文区静默空白。
  const stageSessionRef = useRef(0);
  // T2 型卡全文折叠态(仅展开渲染长文;键=阶段__型;置焦/切阶段不强制收,关弹窗清;
  // 值位随构成区砍除退役,复位走 resetStageState)
  const [, setStageKindExpanded] = useState<Record<string, boolean>>({});

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
  // R5 孤儿防护闸①:宿主开关活取探针(每渲染同步;生成完成回调迟到时对照,宿主已关零作用)
  const hostOpenRef = useRef(open);
  hostOpenRef.current = open;
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
  // 10-25 派生流水线修:展示序活取探针(队列闭包陈旧图集问题,见 actions ctx 注释)
  const displayImagesRef = useRef<AssetImage[]>(displayImages);
  displayImagesRef.current = displayImages;

  // 10-25 阶段矩阵(T2/T3 同源):displayImages 聚类→阶梯序阶段数组(clusterAssetStages
  // 内嵌显示守卫,<2 阶段恒 []=子区与「阶段」选择器整段不渲染,配角弹窗零变化);
  // activeStage=T3 选中值优先,缺省回落聚类末位(最高境界,§3.2「默认=末位」)。
  const stageClusters = useMemo(() => clusterAssetStages(displayImages), [displayImages]);
  const stageOptions = useMemo(() => stageClusters.map((cluster) => cluster.stage), [stageClusters]);
  // 角色真源 JSON(10-26):按资产名解析 art_skills/<包>/json/<角色名>.json;模块级
  // 缓存,无真源角色恒 null(按钮整段不渲染,配角弹窗零变化)
  const characterJsonInfo = getCharacterJsonInfo(asset?.name);
  // 真源接线(10-26 用户令:「提示词应由 JSON 数据化控制+标注文生图/图生图」):
  // 有真源的角色,提示词区=结构化人物提示词面板(随「阶段」联动,逐条路由徽标),
  // 主体句文本框退场;内部派发仍吃派生主体句(镜像走展示+派发边界覆写,不抢
  // draftPrompt state——水合链桥 get 异步回填竞态下恒以真源为准,保存时落 DB=
  // 陈旧种子自愈)。JSON 编辑弹窗关闭后重载,编辑即时反映。派生失败(null)整体
  // 回退既有 DB 行为,fail-safe。
  const [characterJsonText, setCharacterJsonText] = useState<string | null>(null);
  useEffect(() => {
    if (!characterJsonInfo) {
      setCharacterJsonText(null);
      return;
    }
    let cancelled = false;
    loadCharacterJsonText(asset?.name).then((load) => {
      if (!cancelled) setCharacterJsonText(load.status === "ready" ? load.text : null);
    });
    return () => {
      cancelled = true;
    };
  }, [characterJsonInfo, asset?.name, characterJsonOpen]);
  const characterSubjectMirror = useMemo(
    () => characterJsonInfo && characterJsonText !== null
      ? deriveSubjectFromCharacterJson(characterJsonText, selectedStage)
      : null,
    [characterJsonInfo, characterJsonText, selectedStage],
  );
  // 10-26 型区分令:「无衣物定妆」=素体型——恒用 body_base 素体主体词,不吃阶段
  // (选了境界也不发该境带衣主体词;该型定义=全身无衣物,衣物系此后 i2i 注入)
  const characterBodyBaseSubject = useMemo(
    () => characterJsonInfo && characterJsonText !== null
      ? deriveSubjectFromCharacterJson(characterJsonText, null)
      : null,
    [characterJsonInfo, characterJsonText],
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
  const activeStage = selectedStage && stageOptions.includes(selectedStage)
    ? selectedStage
    : (stageOptions[stageOptions.length - 1] ?? null);
  const activeStageCluster = activeStage
    ? (stageClusters.find((cluster) => cluster.stage === activeStage) ?? null)
    : null;
  /** 阶段懒读缓存写入(ref+state 同步;effect 读 ref 免缓存写入引发的重跑/在飞对撞)。 */
  const writeStageTextCache = (key: string, entry: StagePromptTextEntry) => {
    stageTextCacheRef.current = { ...stageTextCacheRef.current, [key]: entry };
    setStageTextCache(stageTextCacheRef.current);
  };
  /** 阶段态整清(关弹窗/切资产复位点;selectedStage/缓存/折叠态一并归零)。
   * 会话代随每次复位递增(复审竞态修):旧会话在飞读取的迟到写入按代全弃。 */
  const resetStageState = () => {
    stageSessionRef.current += 1;
    stageTextCacheRef.current = {};
    setStageTextCache({});
    stageReadInFlightRef.current.clear();
    setSelectedStage(null);
    setStageKindExpanded({});
  };

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

  // T2 阶段提示词懒读(10-25 阶段矩阵,PRD §3.2):「提示词构成」展开且阶段矩阵在场
  // 才对当前阶段每型 latest 各发一发 readImagePromptText(简单池并发≤3;不展开零调用);
  // 结果按 `阶段__型` 缓存组件态(命中不重读,切换阶段只读新阶段未缓存键);失败走
  // §4.4 降级文案(no-texr/not-png/file-missing 等复用既有矩阵;键位漂移单列)。
  // 缓存读走 ref(写入不触发本 effect 重跑,防在飞读被取消重启=IPC 重复);关弹窗/切资产
  // 后的迟到写入污染由会话代隔离(复位点 resetStageState 递增,旧代写入全弃;同会话
  // 依赖重跑不换代,在飞结果照常落缓存——复审竞态修)。
  useEffect(() => {
    if (!open || !activeStageCluster) return;
    const stage = activeStageCluster.stage;
    const bridge = getStudioAssetsBridge();
    if (!bridge?.readImagePromptText) {
      // 桥缺席:未缓存各型落 bridge-missing 占位(已缓存结果不覆盖)
      for (const [kind, group] of activeStageCluster.byKind) {
        if (!group.latest.filePath) continue;
        const key = stagePromptCacheKey(stage, kind);
        if (stageTextCacheRef.current[key] === undefined) {
          writeStageTextCache(key, { status: "failed", reason: "bridge-missing" });
        }
      }
      return;
    }
    const pending = [...activeStageCluster.byKind.entries()]
      .filter(([kind, group]) => {
        if (!group.latest.filePath) return false;
        const key = stagePromptCacheKey(stage, kind);
        return stageTextCacheRef.current[key] === undefined && !stageReadInFlightRef.current.has(key);
      })
      .map(([kind, group]) => ({ key: stagePromptCacheKey(stage, kind), filePath: group.latest.filePath }));
    if (pending.length === 0) return;
    for (const job of pending) {
      stageReadInFlightRef.current.add(job.key);
      // 复审#3 补(亲读证实):派发即写 probing——否则在飞期间 entry===undefined
      // 三分支皆不渲染,型卡正文区无加载反馈(probing 分支原为死码)
      writeStageTextCache(job.key, { status: "probing" });
    }
    // 会话代快照(复审竞态修):同会话依赖重跑不换代→在飞结果照常落缓存;只有复位点
    // (关弹窗/切资产 resetStageState)换代→迟到写入全弃,防污染下一会话。
    const session = stageSessionRef.current;
    const runJob = async (job: { key: string; filePath: string }) => {
      try {
        const result = await bridge.readImagePromptText!({ filePath: job.filePath });
        // 复审修:此处不再因依赖重跑丢弃在飞结果——重跑轮的 pending 已把在飞键滤掉
        // (在飞集互斥,同键无并发双读),本写入幂等;仅复位点换代后弃(旧会话缓存已整清)。
        if (stageSessionRef.current !== session) return;
        if (!result.ok) {
          writeStageTextCache(job.key, { status: "failed", reason: result.reason });
          return;
        }
        try {
          const breakdown = parseWorkflowPrompt(result.text);
          if (stageSessionRef.current !== session) return;
          writeStageTextCache(job.key, {
            status: "ready",
            finalText: breakdown.finalText,
            charCount: breakdown.finalText.length,
          });
        } catch {
          // tEXt 在但键位漂移:不把原始 JSON 当终稿,降级注明(查词弹层可看原文)
          if (stageSessionRef.current === session) {
            writeStageTextCache(job.key, { status: "failed", reason: "parse-drift" });
          }
        }
      } catch {
        if (stageSessionRef.current === session) {
          writeStageTextCache(job.key, { status: "failed", reason: "read-failed" });
        }
      } finally {
        // 同代才清在飞键:跨代时该键可能已被复位点清空后由新会话作业重新占用,
        // 误删会让下一轮 effect 对同图重复发 IPC。
        if (stageSessionRef.current === session) {
          stageReadInFlightRef.current.delete(job.key);
        }
      }
    };
    // 简单并发池≤3(§七风险表:只读当前阶段每型一发,不预读全量)
    const queue = [...pending];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) return;
        await runJob(job);
      }
    });
    void Promise.all(workers);
    // 复审修:不设 cleanup cancelled 旗——依赖重跑(images 刷新换 activeStageCluster
    // 身份)时取消在飞读取并整批丢弃结果,恰是「型卡正文区静默空白」竞态根因(重跑轮
    // pending 把仍在飞的键滤掉,作业完成后无人再触发 effect);迟到写入的污染防线移交
    // 会话代(复位点递增,旧代写入全弃)。
    // stageTextCache 刻意不入依赖(读 ref):缓存写入不触发本 effect 重跑;activeStageCluster
    // 身份变化触发的重跑靠在飞集去重,同图零重复 IPC(懒读计数测试钉此约束)。
  }, [open, activeStageCluster]);

  // 10-19 双弹勘误:弹窗关(无论因)=预览关——previewIndex 不清零→下次开弹窗时
  // open&&previewIndex 条件双真→Lightbox 与 Dialog 同时弹出
  // 10-25 分层面板 A-1:focusKind 随弹窗关重置(生命周期:随弹窗开关重置,不持久化);
  // 10-25 A-2③/B-3:查词/实发终稿弹层随主弹窗关同关(不残留遮罩)
  useEffect(() => {
    if (!open) {
      setPreviewIndex(null);
      setFocusKind(null);
      setPromptInspectTarget(null);
      // R5 结果弹窗随主弹窗关整清(「宿主关时已弹」时序;「关后才弹」由回调守卫拦)
      setGenerationOutcome(null);
      queueRecordsRef.current = [];
      // 10-25 阶段矩阵:阶段选择/懒读缓存/折叠态随弹窗关整清(PRD §四生命周期)
      resetStageState();
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
    // 阶段矩阵(T2/T3)同理:selectedStage/懒读缓存/折叠态随切资产重置)
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
  // 收拢为降态行,高清人脸双路并注),一键生成/画风转换清空回通用态;生成派发
  // 本身零变。定义在 actions 装配之前:一键补缺队列经 onFillMissingKindFocus
  // 钩子逐型复用(队列直调底层执行器,复审修 A-1 写入点第4项)。
  const focusOnKind = (kind: AssetImageKind) => {
    setFocusKind(kind);
    setSubjectExpanded(false);
    setInstructionEditOpen(false);
  };

  // R5 生成结果回调(10-26 用户令:每次生成完成自动弹出):四路 done 即发,与 get/
  // 写回成败无关(写回失败弹窗照弹,②段走降级文案)。孤儿防护双闸——①宿主关后
  // 回调零作用(hostOpenRef 活取);②跨资产 record 丢弃(单发/队列同闸:单发防旧资产
  // 结果弹错宿主,队列防切资产后旧资产汇总盖新宿主——对齐 10-25 深审修哲学;丢弃路
  // 靠既有 toast「已入库;不回填」+库内产物兜底告知)。
  const handleImageGenerated = (record: GenerationOutcomeRecord) => {
    if (!hostOpenRef.current) return;
    if (record.assetId !== activeAssetIdRef.current) return;
    if (record.fromQueue) {
      queueRecordsRef.current = [...queueRecordsRef.current, record];
      return;
    }
    setGenerationOutcome({ records: [record], batch: null });
  };
  // R5 队列收口=末尾汇总(方案定死):恒先清空 ref 防跨会话陈旧累积;宿主关/零记录
  // 不弹(同资产关后再开=队列继续且汇总照弹,记录连续)。
  const handleQueueSettled = (batch: { total: number; completed: number; abortedKind?: string }) => {
    const records = queueRecordsRef.current;
    queueRecordsRef.current = [];
    if (!hostOpenRef.current || records.length === 0) return;
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
    onOpenChange,
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
      if (gate.subject) return gate.subject;
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

  const handleTypeShot = (kind: AssetImageKind) => {
    focusOnKind(kind);
    // T3(10-25 阶段矩阵,PRD §3.3):生成路「阶段」选择随派发同帧透传(命名与 i2i
    // 参考图锚定用;「无」=不带阶段,既有行为)。人脸双钮/表情差分/重掷不经此包装。
    dispatchTypeShot(kind, { stage: selectedStage ?? undefined });
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
  // 高清人脸(其文生图路主体句参与;i2i 族主体句不参与,槽无意义不展示)
  const kindSlotActive = !!focusKind && promptOverridesDraft[focusKind] !== undefined;
  const subjectSlotEligible = !!focusKind && (!focusIsI2iFamily || focusKind === "高清人脸");
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="studio-asset-detail-dialog h-[92vh] w-[90vw]! max-w-[90vw]! overflow-hidden bg-card/50 p-0">
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
                            {/* 角色真源 JSON(10-26 用户令):该角色有真源文件
                                (art_skills/<包>/json/<角色名>.json,如 晏燎.json)才出钮;
                                弹窗=完整展示+CodeMirror 可编辑,存桌面技能存储 */}
                            {characterJsonInfo ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 gap-1 text-[11px]"
                                onClick={() => setCharacterJsonOpen(true)}
                                title={`查看/编辑该角色的真源 JSON(${characterJsonInfo.relativePath})`}
                              >
                                <FileJson className="h-3 w-3" />
                                角色真源JSON
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
                        {characterPromptCatalog ? null : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] text-muted-foreground">主体句</div>
                          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                            {stageOptions.length > 0 && (
                              <Select
                                value={selectedStage ?? STAGE_SELECT_NONE}
                                onValueChange={(value) => {
                                  setSelectedStage(value === STAGE_SELECT_NONE ? null : value);
                                }}
                              >
                                <SelectTrigger
                                  className="h-6 w-auto gap-1 px-2 py-0 text-[11px]"
                                  aria-label="阶段"
                                  title="阶段(命名与参考图锚定用):选中后按型出图命名带阶段段、图生图参考图锚该阶段最新图;「无」=不带阶段"
                                >
                                  <span className="text-[10px] text-muted-foreground">阶段</span>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={STAGE_SELECT_NONE} className="text-xs">无</SelectItem>
                                  {stageOptions.map((stage) => (
                                    <SelectItem key={stage} value={stage} className="text-xs">{stage}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                            {subjectSlotEligible && focusKind && (!characterPromptCatalog || kindSlotActive) && (
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
                        </div>
                        )}
                        {characterPromptCatalog ? (
                          /* 10-26 用户令「展示基础相关的提示词,而不是阶段相关的」+
                             「不要重复」:面板只显基础两卡(人脸基准/人物基底素体),
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
                    可在「提示词」区域填写主体句，在各型节头点「生成…」出图，完成后自动弹出结果确认，再点「保存」。
                  </p>
                </div>
              )}

              {/* ② 图片规范区(垂直滚动主体:role 型节骨架/scene·tool 单节横行/audio 播报卡) */}
              {/* 10-26 横竖皆可(人物海报裁定):画幅取向会话开关+16:9 型构图约束提示 */}
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>人物海报画幅</span>
                  <button
                    type="button"
                    onClick={() => setPosterLandscape((v) => !v)}
                    className={posterLandscape
                      ? "rounded-md border border-primary/50 bg-primary/10 px-1.5 py-0.5 font-medium text-primary"
                      : "rounded-md border border-border px-1.5 py-0.5 text-muted-foreground"}
                  >
                    {posterLandscape ? "横幅 16:9" : "竖幅 3:4(跟型)"}
                  </button>
                </div>
              </div>
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
                i2iPhase={i2iPhase}
                i2iMessage={i2iMessage}
                generatePhase={generatePhase}
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
                facePhase={facePhase}
                faceMessage={faceMessage}
                canFacePortrait={canFacePortrait}
                canTypeShot={canTypeShot}
                onTypeShot={handleTypeShot}
                typeShotPhase={typeShotPhase}
                typeShotMessage={typeShotMessage}
                onFillMissing={handleFillMissingQueue}
                onInspectPrompt={handleInspectPrompt}
                /* 批3(10-24)+Round 3 ⑤/⑥:占位卡 CTA/完整度缺失 chip 直达生成全型路由
                 * ——高清人脸按有图择图生图/文生图路,表情差分接既有路,余型走
                 * handleTypeShot 型驱动件(route 分流:设定卡/美宣/道具=t2i+base_type,
                 * 余=i2i+base_type 型层注入,Phase 2 已切)。
                 * 10-25 分层面板 A-1:入口点击即聚焦目标型(focusOnKind 同帧写入) */
                onGenerateByKind={(kind) => {
                  focusOnKind(kind);
                  if (kind === "高清人脸") {
                    // 10-26 用户令:高清人脸没有文生图——恒走无衣物定妆图生图;
                    // 缺定妆图=runFacePortrait 内建守卫拦截并引导先生成定妆
                    handleFacePortraitFromImage();
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
      <StudioAssetSourcePromptDialog
        open={sourcePromptOpen}
        onOpenChange={setSourcePromptOpen}
        initialKind={focusKind}
      />
      {/* 角色真源 JSON(10-26 用户令):完整展示+可编辑该角色真源文件;宿主关即卸 */}
      <StudioAssetCharacterJsonDialog
        open={open && characterJsonOpen}
        characterName={asset.name}
        onOpenChange={setCharacterJsonOpen}
      />
      {/* R5 生成结果弹窗(10-26 用户令:每次生成完成自动弹出)。挂载守卫=宿主开+有
          记录:宿主关后任何异步竞态漏网 setState 也零渲染(嵌套弹窗已知坑①) */}
      <StudioAssetGenerationResultDialog
        open={open && generationOutcome !== null}
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
