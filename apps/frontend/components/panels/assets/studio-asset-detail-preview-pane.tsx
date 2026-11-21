import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";
import {
  Loader2,
  Maximize2,
  Music2,
  ScanFace,
  Sparkles,
  TextSearch,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AssetImage, AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";
import {
  ASSET_IMAGE_KIND_ASPECTS,
  asAssetImageTrack,
  getAssetImageKindSpectrum,
  groupAssetImagesByKind,
  type AssetImageTrack,
} from "@/lib/studio/asset-image-kind";
import { sortStageFirstThenInput } from "@/lib/studio/asset-stage-prompts";
import { ASSET_TYPE_SHOT_PROFILES } from "@/lib/studio/asset-type-shot";

const waveformBars = [42, 68, 50, 84, 46, 72, 58, 92, 54, 76, 48, 66, 40, 60, 36, 70];

/**
 * 10-24 图片展示规范(批1骨架+批2分类归节+Round 3 扩展令⑤三轨推广):图片三轨
 * (role/scene/tool)按各自型谱分节——role 谱=grill Round 1 裁定2(身份链根→常规产物
 * →重版式→工具型→兜底),scene 谱=场景/概念气氛图/3D剖面场景图+自由,tool 谱=道具+自由;
 * classifyAssetImage 三层解析(持久值→命名规则→自由)上线,存量图按命名归位,
 * 识别不出落「自由」节(10-25 用户裁定:自由就是放无类型图的);clip 无型谱=单节「图片」,audio 零动。
 */
/** clip 轨无型谱=单节「图片」横向行(裁定 D;Round 3 ⑤ 后仅 clip 走此分支)。 */
const SINGLE_SECTION_TITLE = "图片";

/** 轨道名词(零图 i2i 禁用 title/队列提示用;role 回归文案零变化)。 */
const TRACK_NOUNS: Record<AssetImageTrack, string> = { role: "角色", scene: "场景", tool: "道具" };

/** 1120 生图按钮忙碌态精修(§2 R2 键空间):busyTarget 键构造单一真源——点击点即键
 *  (节头钮 section:<kind>/占位 CTA placeholder:<kind>/一键 one-key/人脸 face-i2i/
 *  表情 expression/旧单镜 generate/画风转换 i2i)。发起处与 setPhase 同址设键,
 *  finally 清(失败必复原=AC4 硬门);禁手拼散落(§6 对策3:键走本 helper)。 */
export const busyKey = {
  section: (kind: AssetImageKind) => `section:${kind}`,
  placeholder: (kind: AssetImageKind) => `placeholder:${kind}`,
  oneKey: "one-key",
  faceI2i: "face-i2i",
  expression: "expression",
  generate: "generate",
  i2i: "i2i",
} as const;

/** 1121 失败持久态(界面不许撒谎):上次按型出图失败的型与原因。失败 toast/
 *  3s 相位窗一闪即逝,等待几分钟的用户回来看不到任何失败痕迹——本态持久驻留
 *  (型键控:该型节头钮/占位 CTA 红边+「生成失败」标签,title=原因全文);
 *  重发该型/该型成功/切资产即清;与 busyTarget 忙碌态互斥(在跑 spinner 优先)。 */
export interface AssetTypeShotFailureState {
  kind: AssetImageKind;
  reason: string;
}

/** 1120 按钮态精修(R1 即刻回 idle):互斥闸只认「运行态」相位——done/failed 反馈
 *  残留窗不再禁点(无任务在跑却灰=假忙);互斥语义(§3:同一时刻仅一个生成任务)
 *  不变:任一路运行态在跑即全族灰禁。导出供宿主折叠摘要「生成中」旗同源收窄
 *  (完成后反馈窗不再挂「生成中」误导旗)。 */
const LANE_RUNNING_PHASES = new Set(["polishing", "generating", "saving"]);
export const isLanePhaseRunning = (phase?: string | null) => LANE_RUNNING_PHASES.has(phase ?? "");

/** 中文计数(完整度两行分级 aria 标签:role=核心五必备/扩展四型恒零回归)。 */

/** 图卡统一高 h-40;宽随型画幅比(3:4≈120px/16:9≈284px/1:1=160px;未分类混排走方卡)。 */
function sectionCardWidthClass(_aspect: string | null): string {
  // 10-26 用户令「都按照横向展示,类似于人物多视图的展示方式」:全部型节统一
  // 宽卡(多视图同款 w-[284px]);卡内 h-40 object-contain,竖图完整居中不裁切
  return "w-[284px]";
}

interface StudioAssetDetailPreviewPaneProps {
  /** 10-26 人物海报画幅(横竖皆可裁定):取向值(true=横幅 16:9;持久化住调用方)。 */
  posterLandscape?: boolean;
  /** 人物海报画幅切换(挂「人物海报」节头;未传不渲染)。 */
  onTogglePosterLandscape?: () => void;
  asset: StudioAssetSummary;
  images: AssetImage[];
  /** 全局单选图:当前选中位(原轮播 currentIndex 状态机迁移;完成切新图/删图夹回语义不变)。 */
  currentIndex: number;
  spokenText: string;
  audioSrc: string;
  Icon: LucideIcon;
  /** 10-24 布局重造:点图卡即选中(高亮描边);替换 Carousel onSelect 等价。 */
  onSelectImage: (index: number) => void;
  /** 10-19 用户令:点击图卡放大钮开全屏缩放预览(MediaPreviewModal)。 */
  onImageClick?: (index: number) => void;
  onTranscribe: () => void | Promise<void>;
  onRemoveImage: (image: AssetImage, index: number) => void | Promise<void>;
  /** 10-19 图生图·画风转换:取全局选中图作唯一参考,qwen-image-2-1 本地渠道整体转画风。 */
  /** 画风转换相位("generating"|"done"|"failed"|null);在跑时 Loader2+相位文案并禁点。 */
  i2iPhase?: string | null;
  /** 画风转换相位文案(运行态按钮 title 全文,如「正在转换 主角 的画风...」)。 */
  i2iMessage?: string;
  /** 一键生成相位(互斥:任一生成相位在跑即禁点)。 */
  generatePhase?: string | null;
  /** 三轨且有图才可转(role/scene/tool 且有图);缺省 true 由装配方守门。 */
  /** 10-21 高清人脸(用户令:图生图/文生图两路都要);仅角色轨由装配方置真。
   *  批3 返值化:boolean=完成/守卫拒(供一键补缺队列探成功),pane 只派发零消费。 */
  onFaceFromImage?: () => void | Promise<unknown>;
  /** 人脸生成相位(两路共用一套状态机;在跑时 Loader2+文案并禁点)。 */
  facePhase?: string | null;
  /** 人脸生成相位文案(运行态按钮 title 全文)。 */
  faceMessage?: string;
  /** 角色轨才显示人脸按钮;缺省 false(非角色零侵入)。 */
  canFacePortrait?: boolean;
  /** 10-21 表情差分(用户令:图生图逻辑);仅角色轨由装配方置真(批3 返值化同上)。 */
  onExpression?: () => void | Promise<unknown>;
  /** 表情差分生成相位(在跑时 Loader2+文案并禁点)。 */
  expressionPhase?: string | null;
  /** 表情差分相位文案(运行态按钮 title 全文)。 */
  expressionMessage?: string;
  /** 批2(10-24):占位卡「点击生成」CTA 与完整度条核心缺失 chip 的直达生成入口;
   *  装配方路由(批3 起全型路由:高清人头/表情差分接既有路,余型走按型出图件)。 */
  onGenerateByKind?: (kind: AssetImageKind) => void | Promise<void>;
  /** 批3 复审 M 修(Round 3 Q1):完整度两行分级/核心空节红点判定基准=本行自有图集——
   *  族聚显在驾时 images(displayImages)含族兄弟行图,同型图不抵扣本行缺口;缺省回落
   *  images(非族聚显调用方零变化)。造型版本归属确认候版本系统落地后细化。 */
  completenessImages?: AssetImage[];
  /** 批3(10-24)按型出图:节头生成钮+「按型出图」下拉派发(型名单一参数);
   *  仅角色轨由装配方置真(缺省 false,非角色零侵入)。 */
  canTypeShot?: boolean;
  onTypeShot?: (kind: AssetImageKind) => void | Promise<void>;
  /** 按型出图相位(通用第五路互斥;一键补缺队列复用聚合);在跑时 Loader2+文案并禁点。 */
  typeShotPhase?: string | null;
  /** 按型出图相位文案(运行态按钮 title 全文,型名/队列进度进文案)。 */
  typeShotMessage?: string;
  /** 批3 一键补缺顺序队列入口(缺失核心型逐型顺序补全);缺省不渲染启用态。 */
  onFillMissing?: () => void | Promise<void>;
  /** B-3 查词(10-25 分层面板役):图片卡 hover 工具条「查词」入口(全部图片卡通用,
   *  含族聚显族兄弟图——读其原图 tEXt,弹层标注所属资产名);缺省不渲染该钮。 */
  onInspectPrompt?: (image: AssetImage, index: number) => void | Promise<void>;
  /** R4 族聚显:条目级删除可见性(族兄弟只读条目不显示删除);缺省恒可删
   *  (10-19 用户裁定:主图亦可删——含首位主图)。 */
  isImageRemovable?: (image: AssetImage, index: number) => boolean;
  /** 1120 按钮态精修(R3 单源):spinner 唯一真源=被点钮键(busyKey 族);五相位
   *  保留供结果反馈(done/failed 文案)/联动/状态文字消费,spinner 一律只认本键
   *  ——「任一 phase 在跑→全族 spinner」的旧渲染路径已删(§1 病灶根修)。 */
  busyTarget?: string | null;
  /** 1121 失败持久态:上次按型出图失败的型+原因(型键控红态;null=无失败记录)。
   *  与 busyTarget 互斥:该型在跑(busy)时红态不渲染,spinner 优先。 */
  typeShotFailure?: AssetTypeShotFailureState | null;
}

export function StudioAssetDetailPreviewPane({
  asset,
  images,
  currentIndex,
  spokenText,
  audioSrc,
  Icon,
  onSelectImage,
  onImageClick,
  onTranscribe,
  onRemoveImage,
  i2iPhase,
  generatePhase,
  onFaceFromImage,
  facePhase,
  faceMessage,
  canFacePortrait = false,
  onExpression,
  expressionPhase,
  expressionMessage,
  onGenerateByKind,
  completenessImages,
  posterLandscape,
  onTogglePosterLandscape,
  canTypeShot = false,
  onTypeShot,
  typeShotPhase,
  typeShotMessage,
  onFillMissing,
  onInspectPrompt,
  isImageRemovable,
  busyTarget,
  typeShotFailure,
}: StudioAssetDetailPreviewPaneProps) {
  const hasImagePreview = asset.type !== "audio" && images.length > 0;
  // 10-21 高清人脸/表情差分:与一键生成/画风转换互斥;批3 按型出图=通用第五路
  // 1120 按钮态精修:互斥闸收窄运行态(done/failed 反馈窗即刻回 idle 可点,R1)
  const generationBusy = isLanePhaseRunning(i2iPhase) || isLanePhaseRunning(generatePhase)
    || isLanePhaseRunning(facePhase) || isLanePhaseRunning(expressionPhase) || isLanePhaseRunning(typeShotPhase);
  // 人脸·图生图:角色轨+有图;人脸·文生图:角色轨(无图亦可,描述锚身份)
  const faceFromImageDisabled = generationBusy || images.length === 0;
  const faceFromImageTitle = images.length === 0
    ? "先有角色图片才能图生图生成人脸"
    : isLanePhaseRunning(generatePhase)
      ? "图片生成中，请稍候"
      : isLanePhaseRunning(i2iPhase)
        ? "正在转换画风，请稍候"
        : isLanePhaseRunning(facePhase)
          ? (faceMessage || "正在生成高清人头，请稍候")
          : isLanePhaseRunning(expressionPhase)
            ? "正在生成表情差分，请稍候"
            : isLanePhaseRunning(typeShotPhase)
              ? (typeShotMessage || "正在按型出图，请稍候")
              : undefined;
  // 相位 done/failed=结果反馈文案(spinner 只认 busyTarget;generating 不再驱动文案)
  const faceSettledLabel = facePhase === "done" ? "人脸生成完成" : facePhase === "failed" ? "人脸生成失败" : null;
  // 10-21 表情差分:角色轨+有图(全局选中图锚身份)
  const expressionDisabled = generationBusy || images.length === 0;
  const expressionTitle = images.length === 0
    ? "先有角色图片才能图生图生成表情差分"
    : isLanePhaseRunning(generatePhase)
      ? "图片生成中，请稍候"
      : isLanePhaseRunning(i2iPhase)
        ? "正在转换画风，请稍候"
        : isLanePhaseRunning(facePhase)
          ? "正在生成高清人头，请稍候"
          : isLanePhaseRunning(expressionPhase)
            ? (expressionMessage || "正在生成表情差分，请稍候")
            : isLanePhaseRunning(typeShotPhase)
              ? (typeShotMessage || "正在按型出图，请稍候")
              : undefined;
  const expressionSettledLabel = expressionPhase === "done" ? "表情差分完成" : expressionPhase === "failed" ? "表情差分失败" : null;
  // 批3 按型出图:通用第五路(在跑全族禁点;型名/队列进度在 typeShotMessage)
  const typeShotSettledLabel = typeShotPhase === "done" ? "生成完成" : typeShotPhase === "failed" ? "生成失败" : null;

  // audio 轨零动:播报卡/波形/试听转写链路保持原样(10-24 布局令)
  if (asset.type === "audio") {
    return (
      <div className="studio-asset-detail-audio-pane space-y-3 rounded-lg border border-border bg-background/90 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
            <Music2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-muted-foreground">说话内容</div>
            <div className="mt-0.5 text-sm leading-6 text-foreground">
              {spokenText || "暂无口播词句"}
            </div>
          </div>
        </div>
        <div className="studio-audio-waveform studio-audio-waveform-large" aria-hidden="true">
          {waveformBars.map((height, index) => (
            <span key={index} style={{ "--bar-height": `${height}%` } as CSSProperties} />
          ))}
        </div>
        <div className="rounded-md border border-border bg-muted/90 p-3">
          {audioSrc ? (
            <audio controls src={audioSrc} className="w-full" />
          ) : (
            <div className="text-xs text-muted-foreground">暂无可播放的音频地址</div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <div className="col-span-2">
            <Button variant="outline" size="sm" className="w-full" onClick={onTranscribe}>
              ✨ 智能生成说话内容
            </Button>
          </div>
        </div>
      </div>
    );
  }
  // Round 3 扩展令⑤:分节视图从 role 专属改图片三轨通用(按资产 type 取谱);
  // clip 无型谱(单节「图片」),audio 已在上方零动早退
  const track = asAssetImageTrack(asset.type);
  const spectrum = track ? getAssetImageKindSpectrum(track) : undefined;
  const isTypedGallery = !!track && !!spectrum;
  const trackNoun = track ? TRACK_NOUNS[track] : "资产";
  const CORE_KIND_SET = new Set<string>(spectrum?.core ?? []);
  const TYPED_SECTION_DEFS = (spectrum?.order ?? [])
    .map((kind) => ({ kind, aspect: ASSET_IMAGE_KIND_ASPECTS[kind as Exclude<AssetImageKind, "早期未分类">] }));

  /** 图卡:单击=选中(全局单选图);悬浮操作=放大(全屏预览)/删图(removable 守卫)。
   *  复审 M1(10-24):更换图片不进卡悬浮——回调恒换当前行主图(replaceImage 按行),
   *  按卡点名会误导「换这张」(族兄弟卡尤其错目标);10-25 工具行移除,本注释随役。 */
  const renderImageCard = (image: AssetImage, index: number, widthClass: string) => {
    const selected = index === currentIndex;
    const removable = isImageRemovable ? isImageRemovable(image, index) : true;
    return (
      <div
        key={image.filePath || index}
        className={`studio-asset-image-card group relative shrink-0 overflow-hidden rounded-lg border bg-background ${widthClass} ${
          selected ? "border-primary ring-2 ring-primary" : "border-border"
        }`}
      >
        <button
          type="button"
          className="relative block h-40 w-full cursor-pointer rounded-lg"
          onClick={() => onSelectImage(index)}
          title={`选中 ${image.name}`}
          aria-pressed={selected}
          aria-label={`选中图片 ${image.name}`}
        >
          <img
            src={image.url}
            alt={image.name}
            className="h-40 w-full object-contain"
            draggable={false}
          />
          <ResolutionBadge src={image.url} />
        </button>
        <div className="absolute right-1 top-1 z-[1] flex gap-0.5 rounded-md bg-background/80 p-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onImageClick && (
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onImageClick(index);
              }}
              title="全屏预览"
              aria-label={`全屏预览 ${image.name}`}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          {/* B-3 查词(10-25 分层面板役):读该图原图 tEXt 分层展示(引擎实收,
              族兄弟图计入,弹层标注所属资产名);无 tEXt/JPEG/断链走降级文案 */}
          {onInspectPrompt && (
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                void onInspectPrompt(image, index);
              }}
              title="查词:查看该图引擎实收的提示词"
              aria-label={`查词 ${image.name}`}
            >
              <TextSearch className="h-3.5 w-3.5" />
            </button>
          )}
          {removable && (
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                void onRemoveImage(image, index);
              }}
              title="删除"
              aria-label={`删除图片 ${image.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="truncate px-1.5 py-1 text-[11px] text-muted-foreground" title={image.name}>
          {image.name}
        </div>
      </div>
    );
  };

  /** 占位卡:虚线边框,型画幅比照图卡;空型槽位恒在(10-24 布局令)。
   *  批2 B 节规格:中央型 icon+「尚无{型名}」+「点击生成」CTA(装配方给
   *  onGenerateByKind 时);核心型带红色角标(裁定1 红色告警),扩展型灰;hover 高亮。
   *  1120 按钮态精修:CTA 补 disabled 灰态样式(R3;wiring 原对样式缺);候裁2=
   *  CTA 被点自身转+变「生成中…」(busyTarget===placeholder:<kind>,节头钮不代转)。
   *  1121 失败持久态:该型上次失败(!busy 时)=CTA 红边+「生成失败」标签,title=
   *  原因全文(与忙碌态互斥;重发/成功即清)。 */
  const renderPlaceholderCard = (
    label: string,
    widthClass: string,
    options?: { kind?: AssetImageKind; busy?: boolean },
  ) => {
    const isCore = !!options?.kind && CORE_KIND_SET.has(options.kind);
    // 1121 失败持久态:型键控;busy 中不渲染红态(互斥清晰)
    const failureReason = options?.kind && typeShotFailure?.kind === options.kind ? typeShotFailure.reason : null;
    const failed = !options?.busy && failureReason !== null;
    return (
      <div
        className={`studio-asset-image-placeholder relative flex ${widthClass} shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 text-center transition-colors ${
          isCore ? "border-destructive/50 bg-destructive/5 hover:border-destructive/70" : "border-border bg-muted/30 hover:border-primary/40"
        }`}
        aria-label={`尚无${label}`}
      >
        {isCore && (
          <span className="absolute right-1 top-1 rounded-sm bg-destructive px-1 py-px text-[9px] font-medium text-destructive-foreground" title="核心必备缺失">
            缺
          </span>
        )}
        <Icon className="h-6 w-6 opacity-50" />
        <span className="text-xs">尚无{label}</span>
        {options?.kind && onGenerateByKind && (
          <button
            type="button"
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              failed
                ? "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:hover:bg-destructive/10"
                : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:hover:bg-primary/10"
            }`}
            onClick={() => onGenerateByKind(options.kind!)}
            disabled={generationBusy}
            title={failed ? `上次生成失败:${failureReason}` : (generationBusy ? "有生成任务正在进行，请稍候" : `生成${options.kind}`)}
          >
            {options.busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            {options.busy ? "生成中…" : failed ? "生成失败" : "点击生成"}
          </button>
        )}
      </div>
    );
  };

  /** 类型节:节头(型名+画幅徽标+透明/route 徽标(批3 型档案)+计数+核心空节红点+
   *  该型生成钮)+横向卡片行(overflow-x 自由横滑)。
   *  批3 复审 M 修:红点基准=本行 completenessCount(核心型本行缺即红,族兄弟图
   *  在画廊展示不抵扣,count 张数仍按展示序)。 */
  const renderSection = (
    sectionKey: string,
    title: string,
    aspect: string | null,
    cards: ReactNode,
    count: number,
    headerButtons?: ReactNode,
    sectionMeta?: { rgba?: boolean; route?: string },
    coreMissing?: boolean,
  ) => (
    <section
      key={sectionKey}
      // 10-25 用户令:每个图片类型节都要有框圈定——统一边框卡(与基础信息区卡同语言)
      className="studio-asset-image-section space-y-2 rounded-lg border border-border bg-muted/30 p-3"
      aria-label={title}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {aspect && <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium">{aspect}</Badge>}
        {/* 批3 型档案徽标:透明(RGBA 真源)/route 生成路(裁定3 分流直读) */}
        {sectionMeta?.rgba && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium text-primary" title="型真源 rgba_default=透明(Phase2 型层注入直出真 Alpha)">透明</Badge>
        )}
        {/* 1120 R5 route 徽标中文化:展示层映射 i2i→图生图/t2i→文生图,悬浮 title
            补语义;数据/标识层不动(route 值仍是 ASSET_TYPE_SHOT_PROFILES 真源) */}
        {sectionMeta?.route && (
          <Badge
            variant="outline"
            className="px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
            title={sectionMeta.route === "i2i" ? "图生图(参考图生成)" : sectionMeta.route === "t2i" ? "文生图(纯文字生成)" : sectionMeta.route}
          >
            {sectionMeta.route === "i2i" ? "图生图" : sectionMeta.route === "t2i" ? "文生图" : sectionMeta.route}
          </Badge>
        )}
        {/* 批2 B 节:核心型空节=节头红点(裁定1 红色告警;批3 复审 M 修:基准=本行图集) */}
        {coreMissing && (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" title="核心必备缺失" aria-label={`${title}缺失`} />
        )}
        <span className="text-xs text-muted-foreground">{count} 张</span>
        {headerButtons && <div className="ml-auto flex flex-wrap items-center gap-1.5">{headerButtons}</div>}
      </div>
      <div className="studio-asset-image-row flex gap-3 overflow-x-auto pb-1">{cards}</div>
    </section>
  );

  /** 高清人头节头生成钮(10-21 既有功能迁居,守卫/相位文案零变;旧名高清人脸 1120 改名)。
   *  1120 按钮态精修:spinner+「生成中…」⟺ busyTarget===face-i2i(被点钮);相位
   *  done/failed 文案=结果反馈保留;队列/占位 CTA 触发的人脸路不代转(键不同)。 */
  const renderFaceSectionButtons = () => {
    const busy = busyTarget === busyKey.faceI2i;
    return (
      <>
        <Button
          variant="default"
          size="sm"
          className="h-6 gap-1 text-[11px]"
          onClick={onFaceFromImage}
          disabled={faceFromImageDisabled}
          title={faceFromImageTitle}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <ScanFace className="mr-1 h-3 w-3" />
          )}
          {busy ? "人脸生成中…" : (faceSettledLabel ?? "人脸·图生图")}
        </Button>
      </>
    );
  };

  /** 表情差分节头生成钮(10-21 既有功能迁居,守卫/相位文案零变;spinner 只认
   *  busyTarget===expression,1120 按钮态精修)。 */
  const renderExpressionSectionButton = () => {
    const busy = busyTarget === busyKey.expression;
    return (
      <Button
        variant="default"
        size="sm"
        className="h-6 gap-1 text-[11px]"
        onClick={onExpression}
        disabled={expressionDisabled}
        title={expressionTitle}
      >
        {busy ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <ScanFace className="mr-1 h-3 w-3" />
        )}
        {busy ? "表情差分生成中…" : (expressionSettledLabel ?? "表情差分")}
      </Button>
    );
  };

  /** 批3 按型出图节头生成钮(型驱动通用件派发,型名单一参数);i2i 型零图禁用
   *  (title 提示,轨道名词随轨),t2i 型(设定卡/美宣/道具)描述锚身份,零图可点。
   *  1120 按钮态精修(§1 病灶根修):spinner+「生成中…」⟺ busyTarget===section:<kind>
   *  (仅被点钮;一键队列时各型节头不陪转=候裁1,typeShotPhase 只进 title 播报);
   *  done/failed 相位文案=结果反馈保留。
   *  1121 失败持久态:该型上次失败(!busy 时)=红边钮+「生成失败」标签,title=原因
   *  全文(与忙碌态互斥:在跑 spinner 优先,红态不叠;重发/成功即清)。 */
  const renderTypeShotSectionButton = (kind: AssetImageKind, route: "i2i" | "t2i", busy: boolean) => {
    const needsReference = route === "i2i";
    // 1121 失败持久态:型键控(该型上次失败);busy 中不渲染红态(互斥清晰)
    const failureReason = typeShotFailure?.kind === kind ? typeShotFailure.reason : null;
    const failed = !busy && failureReason !== null;
    const disabled = generationBusy || (needsReference && images.length === 0);
    const title = needsReference && images.length === 0
      ? `先有${trackNoun}图片才能图生图生成${kind}`
      : isLanePhaseRunning(typeShotPhase)
        ? (typeShotMessage || `正在生成${kind}，请稍候`)
        : isLanePhaseRunning(generatePhase)
          ? "图片生成中，请稍候"
          : isLanePhaseRunning(i2iPhase)
            ? "正在转换画风，请稍候"
            : isLanePhaseRunning(facePhase)
              ? "正在生成高清人头，请稍候"
              : isLanePhaseRunning(expressionPhase)
                ? "正在生成表情差分，请稍候"
                : failed
                  ? `上次生成失败:${failureReason}`
                  : `生成${kind}(${route === "t2i" ? "文生图·型层" : "图生图·型层"})`;
    return (
      <Button
        variant={failed ? "destructive" : "default"}
        size="sm"
        className="h-6 gap-1 text-[11px]"
        onClick={() => onTypeShot?.(kind)}
        disabled={disabled}
        title={title}
      >
        {busy ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="mr-1 h-3 w-3" />
        )}
        {busy ? "生成中…" : failed ? "生成失败" : (typeShotSettledLabel ?? `生成${kind}`)}
      </Button>
    );
  };

  const squareWidth = sectionCardWidthClass(null);
  // 批2 分类归节+Round 3 ⑤ 三轨取谱:全部图经 classifyAssetImage 三层解析按当前资产轨
  // 型谱分组(index=原下标,单选图/预览序列回调仍按全局序)——画廊分节/张数按展示序;
  // 完整度判定按本行自有图集(见下 completenessGroups,复审 M 修),非展示序。
  const spectrumOrder = spectrum?.order;
  const kindGroups = groupAssetImagesByKind(images, spectrumOrder);
  // 批3 复审 M 修(Round 3 Q1):完整度 chips/核心红点基准=本行自有图集——族兄弟行
  // 同型图不抵扣本行缺口,归属未确认候版本系统落地后细化;缺省回落 images
  // (非族聚显调用方 displayImages≡本行图集,零行为变化)
  const completenessGroups = groupAssetImagesByKind(completenessImages ?? images, spectrumOrder);
  const completenessCount = (kind: AssetImageKind) => completenessGroups.get(kind)?.length ?? 0;
  // 批3 按型出图:型档案快查(节头钮/徽标装配用;高清人头/表情差分既有路恒不收编)
  const typeShotProfileByKind = new Map(ASSET_TYPE_SHOT_PROFILES.map((profile) => [profile.kind as AssetImageKind, profile]));

  /** 完整度总览条(grill Round 1 裁定1 两行分级+Round 3 ⑤ 三轨同款):核心行逐型
   *  ✓/✗/n(role 五必备/scene 三核心/tool 一核心),缺失红色可点=直达该型生成(展示
   *  与生成两腿闭环);扩展行灰占不告警。批3 装配:「按型出图」下拉(按轨取谱,菜单项
   *  带画幅/透明徽标)+ 一键补缺顺序队列。
   *  复审 H/M 修:chips 计数与缺失判定按本行 completenessCount(Q1 不抵扣);任一
   *  生成相位在跑,缺失 chip 直达入口禁用+title(与节头钮/下拉/一键补缺同闸)。 */
  const renderCompletenessBar = () => {
    // 10-26 二次令(用户实录「为什么包裹住/按钮怎么是灰的不能按」):
    // ①无缺图=整块不渲染(核心全齐的角色弹窗直接没有这个按钮,不再灰置);
    // ②裸按钮无容器框(旧完整度条边框容器删);busy 态保留可见+转圈(进度反馈)
    const coreKinds = spectrum?.core ?? [];
    const missingCoreCount = coreKinds.filter((kind) => completenessCount(kind) === 0).length;
    if (onFillMissing == null || missingCoreCount === 0) return null;
    // 1120 按钮态精修:spinner ⟺ busyTarget===one-key(被点钮;节头钮触发的
    // typeShot 跑时它不代转);typeShotPhase 运行态只进 title/状态文字播报(R4)
    const oneKeyBusy = busyTarget === busyKey.oneKey;
    const fillMissingTitle = isLanePhaseRunning(typeShotPhase)
      ? (typeShotMessage || "正在生成，请稍候")
      : generationBusy
        ? "有生成任务正在进行，请稍候"
        : `补全缺失的 ${missingCoreCount} 类核心图(已有图不重新生成)`;
    return (
    <div className="sticky top-0 z-[1]">
      <Button
        variant="outline"
        size="sm"
        className="studio-asset-fill-missing h-6 gap-1 px-2 text-[11px]"
        onClick={() => onFillMissing?.()}
        disabled={generationBusy}
        title={fillMissingTitle}
      >
        {oneKeyBusy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        一键生图
      </Button>
      {typeShotPhase && typeShotMessage && (
        <span className="ml-2 min-w-0 truncate text-[11px] text-muted-foreground" title={typeShotMessage}>
          {typeShotMessage}
        </span>
      )}
    </div>
    ); };

  return (
    <div className="studio-asset-image-spec-region space-y-4">
      {isTypedGallery && renderCompletenessBar()}

      {isTypedGallery ? (
        <>
          {TYPED_SECTION_DEFS.map(({ kind, aspect }) => {
            const group = kindGroups.get(kind) ?? [];
            const widthClass = sectionCardWidthClass(aspect);
            const typeShotProfile = typeShotProfileByKind.get(kind);
            const baseSectionButtons = kind === "高清人头" && canFacePortrait
              ? renderFaceSectionButtons()
              : kind === "表情差分" && canFacePortrait
                ? renderExpressionSectionButton()
                : typeShotProfile && canTypeShot && onTypeShot
                  ? renderTypeShotSectionButton(kind, typeShotProfile.route, busyTarget === busyKey.section(kind))
                  : undefined;
            // 10-26 人物海报画幅开关挪节头(用户令:功能对的,位置要在它管的型旁)
            const sectionButtons = kind === "人物海报" && onTogglePosterLandscape
              ? <>{baseSectionButtons}<button
                  type="button"
                  onClick={onTogglePosterLandscape}
                  className={posterLandscape
                    ? "rounded-md border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                    : "rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"}
                  title={posterLandscape ? "当前横幅 16:9;点击切回竖幅 3:4(跟型)" : "当前竖幅 3:4(跟型);点击切横幅 16:9(选择全局记住)"}
                >
                  {posterLandscape ? "横幅 16:9" : "竖幅 3:4"}
                </button></>
              : baseSectionButtons;
            return renderSection(
              kind,
              kind,
              aspect,
              group.length > 0
                ? sortStageFirstThenInput(group, (entry) => entry.image.name).map(({ image, index }) => renderImageCard(image, index, widthClass))
                : renderPlaceholderCard(kind, widthClass, { kind, busy: busyTarget === busyKey.placeholder(kind) }),
              group.length,
              sectionButtons,
              typeShotProfile ? { rgba: typeShotProfile.rgba, route: typeShotProfile.route } : undefined,
              // 批3 复审 M 修:红点判定=本行 completenessCount(族兄弟图不抵扣)
              CORE_KIND_SET.has(kind) && completenessCount(kind) === 0,
            );
          })}
        </>
      ) : (
        renderSection(
          SINGLE_SECTION_TITLE,
          SINGLE_SECTION_TITLE,
          null,
          hasImagePreview
            ? sortStageFirstThenInput(
                images.map((image, index) => ({ image, index })),
                (entry) => entry.image.name,
              ).map(({ image, index }) => renderImageCard(image, index, squareWidth))
            : renderPlaceholderCard("图片", squareWidth),
          images.length,
        )
      )}

    </div>
  );
}
