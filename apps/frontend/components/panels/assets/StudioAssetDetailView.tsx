"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useStudioAssetDialogActions } from "./studio-asset-detail-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFreedomStore } from "@/stores/comfyui/freedom-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import type { AssetImage, AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";
import { toast } from "sonner";
import { useDetailCollapsedFlags } from "./studio-asset-detail-collapsed";
import { useAssetDisplayImages } from "./studio-asset-detail-family-images";
import { useAssetCharacterPromptSource } from "./studio-asset-detail-prompt-source";
import { useFinalDraftProbe } from "./studio-asset-detail-probe";
import { useAssetDetailVoice } from "./studio-asset-detail-voice";
import { useAssetDetailHydration } from "./studio-asset-detail-hydration";
import { StudioAssetMetaRegion } from "./studio-asset-detail-meta-region";
import { StudioAssetDetailDialogs } from "./studio-asset-detail-dialogs";
import { parseAssetNames } from "@/lib/studio/asset-names";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  ASSET_IMAGE_KIND_ASPECTS,
  SHEET_CARD_FORMAT_DEFAULT,
  asAssetImageTrack,
  classifyAssetImage,
  getAssetImageKindSpectrum,
  type SheetCardFormat,
} from "@/lib/studio/asset-image-kind";
import { StudioAssetDetailPreviewPane, busyKey, isLanePhaseRunning, type AssetTypeShotFailureState } from "./studio-asset-detail-preview-pane";
import { ArrowLeft, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { ImagePreviewModal } from "@/components/ui/media-preview-modal";
import { getAssetDisplayName } from "./studio-asset-detail-utils";
import {
  resolvePromptOwnerNote,
  type PromptInspectCandidate,
} from "@/lib/studio/asset-prompt-inspect";
import { resolveBareTypeSubjectGate } from "@/lib/studio/asset-character-json";
import type { FamilyImageEntry } from "@/lib/studio/asset-family-images";
import type { PromptTextInspectTarget } from "./studio-asset-prompt-text-dialog";
import { type GenerationOutcome, type GenerationOutcomeRecord } from "./studio-asset-generation-result-dialog";
import {
  isI2iFocusKind,
  resolveAssetGenerationReferenceImage,
  resolveThreeTrackAssetType,
  TYPE_ICON,
  TYPE_LABEL,
} from "./studio-asset-detail-helpers";
export {
  resolveAssetGenerationReferenceImage,
  resolveThreeTrackAssetType,
} from "./studio-asset-detail-helpers";

export { buildAssetRegenerationPrompt, getAssetDisplayName, getAssetImageOpenTarget, getAssetOperationError, getAssetSpokenText, updateImagesAfterReplacingMainImage } from "./studio-asset-detail-utils";
export { persistGeneratedAssetPromptToLibrary, saveGeneratedAssetImageToLibrary } from "./studio-asset-generation-persistence";

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
  // 1121 失败持久态(界面不许撒谎):上次按型出图失败的型+原因——失败 toast/3s
  // 相位窗一闪即逝,等待几分钟的用户回来界面已回静止态(1121 实弹实录);本态持久
  // 驻留(该型节头钮/占位 CTA 红边+「生成失败」+title 原因),重发该型/该型成功/
  // 切资产即清;与 busyTarget 互斥(渲染层在跑 spinner 优先,红态不叠)。
  const [typeShotFailure, setTypeShotFailure] = useState<AssetTypeShotFailureState | null>(null);
  const [faceMessage, setFaceMessage] = useState("");
  const [voiceAssignOpen, setVoiceAssignOpen] = useState(false);
  // 10-25 分层面板役 A-1:focusKind 联动状态机(null=通用态)。点击生成入口置目标型
  // (与生成派发同帧);一键生成/画风转换清空回通用态(深检 C4:主体句/用户指令参与,
  // 降态滞留会误导);随弹窗开关/切资产重置,不持久化。
  const [focusKind, setFocusKind] = useState<AssetImageKind | null>(null);
  // A-2 ①:i2i 型聚焦时主体句折叠位(false=折叠为一行「不参与」提示;点开仍可编辑;
  // 每次置焦即回折叠,保证逐入口准确)
  const [subjectExpanded, setSubjectExpanded] = useState(true);
  // 1121 布局统一:主体句卡「编辑」钮的开合(独立于 i2i 旧 subjectExpanded——
  // 旧态默认 true 会让 DB 补位卡恒直出 Textarea,破坏双卡统一形态)
  const [subjectEditorOpen, setSubjectEditorOpen] = useState(false);
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
  // 1122 设定卡格式档(多张化解禁,裁定B):会话级选择(缺省全卡=真源首键契约),
  // 设定卡节生成入口四选一消费;同档再生成=槽内替换/异档并存(槽语义在 actions
  // executeTypeShot C 守卫内)。不持久化(会话偏好,照 selectedStage 同款口径)。
  const [sheetCardFormat, setSheetCardFormat] = useState<SheetCardFormat>(SHEET_CARD_FORMAT_DEFAULT);
  // 指令卡编辑态开合(作用于当前 focusKind;置焦/清焦即收;值位随构成区砍除退役)
  const [, setInstructionEditOpen] = useState(false);
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
  // 1121 换靶串台根治(尾部写收口):lane 相位/文案 setter 宿主守卫——A 时代闭包
  // 的异步续体在换靶后的一切尾部写(done/failed/进度文案/3s 延迟清)对 B 宿主
  // no-op(ref 渲染期同步=守卫恒读最新靶;View 自身 reset effect 直调原始 setter
  // 不经此层,换靶清零不受阻;dispatch 期写发生在发起帧守卫恒过;与 actions 内
  // finally 的 isSameHostAsset 同语义双保险)
  const hostGuarded = <T,>(setter: Dispatch<SetStateAction<T>>): Dispatch<SetStateAction<T>> =>
    (value) => {
      if (activeAssetIdRef.current === (asset?.id ?? null)) setter(value);
    };
  // R5 孤儿防护闸①(宿主开关活取探针)随弹窗壳退役:独立页由宿主二态挂载/卸载,
  // 「宿主关」=组件卸载(React 卸载后 setState 零渲染),跨资产闸①仍在下面接管。
  // 10-19 用户令:点击图卡开全屏缩放预览(MediaPreviewModal,滚轮缩放/双击/拖拽/翻页)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // 1121 灯箱僵死根修(用户实录「点X还是无法关闭」):生成完成时结果弹窗(R5 自动弹)
  // 开在灯箱(z=2^31)之下不可见——灯箱 X 关掉后结果弹窗顶上,视觉与灯箱几乎同态
  // (全屏黑+大图),其 X 在 720px 弹窗右上而非屏幕角落,用户点原角落位落空=
  // 「X 失效」。转移:灯箱 open + outcome 落地 → 灯箱即闭,结果弹窗成唯一前景。
  useEffect(() => {
    if (generationOutcome !== null && previewIndex !== null) setPreviewIndex(null);
  }, [generationOutcome, previewIndex]);
  const { metaCollapsed, setMetaCollapsed, galleryCollapsed, setGalleryCollapsed } = useDetailCollapsedFlags();
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
  const { familyImages, displayImages, displayImagesRef } = useAssetDisplayImages({
    asset,
    images,
    externalFamilyImages,
    removedFamilyPaths,
    setCurrentIndex,
  });

  const {
    characterJsonInfo,
    storePromptHit,
    characterSubjectMirror,
    characterBodyBaseSubject,
    unifiedPromptCatalog,
    subjectCardEditable,
    subjectMirrorActive,
    effectiveSubjectPrompt,
  } = useAssetCharacterPromptSource({ asset, selectedStage, draftPrompt, characterJsonOpen });
  /** 关弹窗/切资产时清理生成路的阶段选择；退役阶段子区不再维护读取缓存。 */
  const resetStageState = () => {
    setSelectedStage(null);
  };


  const { roleVoiceBinding, roleVoiceProfile, linkedSpeakerIds } = useAssetDetailVoice(asset);


  const { finalDraftProbe } = useFinalDraftProbe({ focusKind, displayImages });

  // 阶段提示词子区已退役；PNG 元数据仅由仍在使用的终稿探针和查词入口读取。

  useAssetDetailHydration({
    asset,
    setDraftName,
    setDraftDescription,
    setDraftPrompt,
    setDraftSetting,
    setFullAsset,
    setImages,
    setCurrentIndex,
    setRecognizedText,
    setVoiceAssignOpen,
    setRemovedFamilyPaths,
    setPreviewIndex,
    setFocusKind,
    setPrePolishPrompt,
    setPromptInspectTarget,
    setGenerationOutcome,
    queueRecordsRef,
    setPromptOverridesDraft,
    setPromptOverridesHydrated,
    setInstructionDrafts,
    setInstructionEditOpen,
    setTypeShotFailure,
    setGeneratePhase,
    setI2iPhase,
    setFacePhase,
    setExpressionPhase,
    setTypeShotPhase,
    setBusyTarget,
    setI2iMessage,
    setExpressionMessage,
    setTypeShotMessage,
    setFaceMessage,
    resetStageState,
  });

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
    // 1121 换靶串台根治:lane setter 全走 hostGuarded(见定义处注释)
    setGeneratePhase: hostGuarded(setGeneratePhase),
    setGenerateMessage: hostGuarded(setGenerateMessage),
    setRecognizedText,
    setI2iPhase: hostGuarded(setI2iPhase),
    setI2iMessage: hostGuarded(setI2iMessage),
    facePhase,
    setFacePhase: hostGuarded(setFacePhase),
    setFaceMessage: hostGuarded(setFaceMessage),
    expressionPhase,
    setExpressionPhase: hostGuarded(setExpressionPhase),
    setExpressionMessage: hostGuarded(setExpressionMessage),
    generatePhaseForGuard: generatePhase,
    typeShotPhase,
    setTypeShotPhase: hostGuarded(setTypeShotPhase),
    setTypeShotMessage: hostGuarded(setTypeShotMessage),
    // 1120 按钮态精修(§10.3):busyTarget 写入口(六条发起链设/清同址 try/finally)
    setBusyTarget: hostGuarded(setBusyTarget),
    // 1121 失败持久态:按型出图失败写入口(失败落/重发清/成功清,own 键控)
    setTypeShotFailure: hostGuarded(setTypeShotFailure),
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
    // 1122 格式入参化:设定卡四选一值随派发透传(命名格式段/B线 extra/槽内替换轴)。
    dispatchTypeShot(kind, {
      stage: selectedStage ?? undefined,
      busyTargetKey: options?.busyTargetKey,
      ...(kind === "设定卡" ? { sheetFormat: sheetCardFormat } : {}),
    });
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
    /* 1122 设定卡格式档四选一(缺省全卡;节头生成入口旁紧凑选择,已占档打点) */
    sheetCardFormat={sheetCardFormat}
    onSheetCardFormatChange={setSheetCardFormat}
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
    /* 1121 失败持久态:上次按型出图失败(型键控红态;与 busyTarget 互斥) */
    typeShotFailure={typeShotFailure}
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
              <StudioAssetMetaRegion
                asset={asset}
                displayName={displayName}
                draftName={draftName}
                setDraftName={setDraftName}
                parsedDraftName={parsedDraftName}
                metaCollapsed={metaCollapsed}
                setMetaCollapsed={setMetaCollapsed}
                spokenText={spokenText}
                setDraftDescription={setDraftDescription}
                setRecognizedText={setRecognizedText}
                setSettingEditorOpen={setSettingEditorOpen}
                setVoiceAssignOpen={setVoiceAssignOpen}
                roleVoiceBinding={roleVoiceBinding}
                roleVoiceProfile={roleVoiceProfile}
                imageRuleRows={imageRuleRows}
                finalDraftProbe={finalDraftProbe}
                draftSetting={draftSetting}
                subjectExpanded={subjectExpanded}
                handleOpenFinalDraft={handleOpenFinalDraft}
                setSourcePromptOpen={setSourcePromptOpen}
                characterJsonInfo={characterJsonInfo}
                storePromptHit={storePromptHit}
                setCharacterJsonOpen={setCharacterJsonOpen}
                unifiedPromptCatalog={unifiedPromptCatalog}
                subjectCardEditable={subjectCardEditable}
                setSubjectExpanded={setSubjectExpanded}
                setSubjectEditorOpen={setSubjectEditorOpen}
                subjectEditorOpen={subjectEditorOpen}
                focusIsI2iFamily={focusIsI2iFamily}
                focusKind={focusKind}
                subjectValue={subjectValue}
                handleSubjectChange={handleSubjectChange}
                kindSlotActive={kindSlotActive}
                subjectMirrorActive={subjectMirrorActive}
              />
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
      <StudioAssetDetailDialogs
        asset={asset}
        parsedDraftName={parsedDraftName}
        linkedSpeakerIds={linkedSpeakerIds}
        voiceAssignOpen={voiceAssignOpen}
        setVoiceAssignOpen={setVoiceAssignOpen}
        settingEditorOpen={settingEditorOpen}
        setSettingEditorOpen={setSettingEditorOpen}
        draftDescription={draftDescription}
        draftSetting={draftSetting}
        onApply={(next) => {
          setDraftDescription(next.description);
          setDraftSetting(next.setting);
          setRecognizedText(null);
        }}
        characterJsonOpen={characterJsonOpen}
        sourcePromptOpen={sourcePromptOpen}
        setSourcePromptOpen={setSourcePromptOpen}
        focusKind={focusKind}
        characterJsonInfo={characterJsonInfo}
        storePromptHit={storePromptHit}
        setCharacterJsonOpen={setCharacterJsonOpen}
        generationOutcome={generationOutcome}
        setGenerationOutcome={setGenerationOutcome}
        promptInspectTarget={promptInspectTarget}
        setPromptInspectTarget={setPromptInspectTarget}
        handleRerollFromPrompt={handleRerollFromPrompt}
      />
    </>
  );
}
