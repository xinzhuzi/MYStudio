import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";
import {
  ChevronDown,
  Clipboard,
  ExternalLink,
  FolderOpen,
  ImageIcon,
  Loader2,
  Maximize2,
  Music2,
  Plus,
  ScanFace,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AssetImage, AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";
import {
  ASSET_IMAGE_KIND_ASPECTS,
  asAssetImageTrack,
  classifyAssetImage,
  getAssetImageKindSpectrum,
  groupAssetImagesByKind,
  type AssetImageTrack,
} from "@/lib/studio/asset-image-kind";
import { ASSET_TYPE_SHOT_PROFILES, getAssetTypeShotProfilesForTrack } from "@/lib/studio/asset-type-shot";

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

/** 中文计数(完整度两行分级 aria 标签:role=核心五必备/扩展四型恒零回归)。 */
const COUNT_ZH = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"] as const;

/** 图卡统一高 h-40;宽随型画幅比(3:4≈120px/16:9≈284px/1:1=160px;未分类混排走方卡)。 */
function sectionCardWidthClass(aspect: string | null): string {
  if (aspect === "3:4") return "w-[120px]";
  if (aspect === "16:9") return "w-[284px]";
  return "w-[160px]";
}

interface StudioAssetDetailPreviewPaneProps {
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
  onAddImage: () => void | Promise<void>;
  onReplaceImage: () => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
  /** 10-19 图生图·画风转换:取全局选中图作唯一参考,qwen-image-2-1 本地渠道整体转画风。 */
  onImageToImage?: () => void | Promise<void>;
  /** 画风转换相位("generating"|"done"|"failed"|null);在跑时 Loader2+相位文案并禁点。 */
  i2iPhase?: string | null;
  /** 画风转换相位文案(运行态按钮 title 全文,如「正在转换 主角 的画风...」)。 */
  i2iMessage?: string;
  /** 一键生成相位(互斥:任一生成相位在跑即禁点)。 */
  generatePhase?: string | null;
  /** 三轨且有图才可转(role/scene/tool 且有图);缺省 true 由装配方守门。 */
  canImageToImage?: boolean;
  /** 10-21 高清人脸(用户令:图生图/文生图两路都要);仅角色轨由装配方置真。
   *  批3 返值化:boolean=完成/守卫拒(供一键补缺队列探成功),pane 只派发零消费。 */
  onFaceFromImage?: () => void | Promise<unknown>;
  onFaceFromText?: () => void | Promise<unknown>;
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
  onCopyPrompt: () => void | Promise<void>;
  onOpenSource: () => void | Promise<void>;
  onOpenFolder: () => void | Promise<void>;
  /** 批2(10-24):占位卡「点击生成」CTA 与完整度条核心缺失 chip 的直达生成入口;
   *  装配方路由(批3 起全型路由:高清人脸/表情差分接既有路,余型走按型出图件)。 */
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
  /** R4 族聚显:条目级删除可见性(族兄弟只读条目不显示删除);缺省恒可删
   *  (10-19 用户裁定:主图亦可删——含首位主图)。 */
  isImageRemovable?: (image: AssetImage, index: number) => boolean;
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
  onAddImage,
  onReplaceImage,
  onRegenerate,
  onImageToImage,
  i2iPhase,
  i2iMessage,
  generatePhase,
  canImageToImage = true,
  onFaceFromImage,
  onFaceFromText,
  facePhase,
  faceMessage,
  canFacePortrait = false,
  onExpression,
  expressionPhase,
  expressionMessage,
  onCopyPrompt,
  onOpenSource,
  onOpenFolder,
  onGenerateByKind,
  completenessImages,
  canTypeShot = false,
  onTypeShot,
  typeShotPhase,
  typeShotMessage,
  onFillMissing,
  isImageRemovable,
}: StudioAssetDetailPreviewPaneProps) {
  const hasImagePreview = asset.type !== "audio" && images.length > 0;
  // 10-21 高清人脸/表情差分:与一键生成/画风转换互斥;批3 按型出图=通用第五路
  const generationBusy = !!i2iPhase || !!generatePhase || !!facePhase || !!expressionPhase || !!typeShotPhase;
  const imageToImageDisabled = generationBusy || !canImageToImage;
  const imageToImageTitle = !canImageToImage
    ? "仅角色/场景/道具三轨且有图资产可转画风"
    : generatePhase
      ? "图片生成中，请稍候"
      : i2iPhase
        ? (i2iMessage || "正在转换画风，请稍候")
        : facePhase
          ? (faceMessage || "正在生成高清人脸，请稍候")
          : expressionPhase
            ? (expressionMessage || "正在生成表情差分，请稍候")
            : typeShotPhase
              ? (typeShotMessage || "正在按型出图，请稍候")
              : undefined;
  const i2iPhaseLabel = i2iPhase === "done"
    ? "画风转换完成"
    : i2iPhase === "failed"
      ? "画风转换失败"
      : "正在转换画风…";
  // 人脸·图生图:角色轨+有图;人脸·文生图:角色轨(无图亦可,描述锚身份)
  const faceFromImageDisabled = generationBusy || images.length === 0;
  const faceFromImageTitle = images.length === 0
    ? "先有角色图片才能图生图生成人脸"
    : generatePhase
      ? "图片生成中，请稍候"
      : i2iPhase
        ? "正在转换画风，请稍候"
        : facePhase
          ? (faceMessage || "正在生成高清人脸，请稍候")
          : expressionPhase
            ? "正在生成表情差分，请稍候"
            : typeShotPhase
              ? (typeShotMessage || "正在按型出图，请稍候")
              : undefined;
  const faceFromTextDisabled = generationBusy;
  const faceFromTextTitle = generatePhase
    ? "图片生成中，请稍候"
    : i2iPhase
      ? "正在转换画风，请稍候"
      : facePhase
        ? (faceMessage || "正在生成高清人脸，请稍候")
        : expressionPhase
          ? "正在生成表情差分，请稍候"
          : typeShotPhase
            ? (typeShotMessage || "正在按型出图，请稍候")
            : undefined;
  const facePhaseLabel = facePhase === "done"
    ? "人脸生成完成"
    : facePhase === "failed"
      ? "人脸生成失败"
      : "人脸生成中…";
  // 10-21 表情差分:角色轨+有图(全局选中图锚身份)
  const expressionDisabled = generationBusy || images.length === 0;
  const expressionTitle = images.length === 0
    ? "先有角色图片才能图生图生成表情差分"
    : generatePhase
      ? "图片生成中，请稍候"
      : i2iPhase
        ? "正在转换画风，请稍候"
        : facePhase
          ? "正在生成高清人脸，请稍候"
          : expressionPhase
            ? (expressionMessage || "正在生成表情差分，请稍候")
            : typeShotPhase
              ? (typeShotMessage || "正在按型出图，请稍候")
              : undefined;
  const expressionPhaseLabel = expressionPhase === "done"
    ? "表情差分完成"
    : expressionPhase === "failed"
      ? "表情差分失败"
      : "表情差分生成中…";
  // 批3 按型出图:通用第五路(在跑全族禁点;型名/队列进度在 typeShotMessage)
  const typeShotPhaseLabel = typeShotPhase === "done"
    ? "生成完成"
    : typeShotPhase === "failed"
      ? "生成失败"
      : "生成中…";

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

  const selectedImage = images[currentIndex];
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
   *  按卡点名会误导「换这张」(族兄弟卡尤其错目标);更换恒居工具行单钮(#10 新家)。 */
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
          {/* 批2 B 节+Round 3 ⑤:左上角型徽标(图片三轨型谱画廊;classifyAssetImage 三层解析) */}
          {isTypedGallery && (
            <span className="pointer-events-none absolute left-1 top-1 z-[1] rounded bg-background/80 px-1 py-0.5 text-[10px] leading-4 text-muted-foreground">
              {classifyAssetImage(image)}
            </span>
          )}
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
   *  onGenerateByKind 时);核心型带红色角标(裁定1 红色告警),扩展型灰;hover 高亮。 */
  const renderPlaceholderCard = (
    label: string,
    widthClass: string,
    options?: { kind?: AssetImageKind },
  ) => {
    const isCore = !!options?.kind && CORE_KIND_SET.has(options.kind);
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
            className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/20"
            onClick={() => onGenerateByKind(options.kind!)}
            disabled={generationBusy}
            title={generationBusy ? "有生成任务正在进行，请稍候" : `生成${options.kind}`}
          >
            点击生成
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
      // 10-25 用户令:每个图片类型节都要有框圈定——统一边框卡(与元信息区卡同语言)
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
        {sectionMeta?.route && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium text-muted-foreground">{sectionMeta.route}</Badge>
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

  /** 高清人脸节头生成钮(10-21 既有功能迁居,守卫/相位文案零变)。 */
  const renderFaceSectionButtons = () => (
    <>
      <Button
        variant="default"
        size="sm"
        className="h-6 gap-1 text-[11px]"
        onClick={onFaceFromImage}
        disabled={faceFromImageDisabled}
        title={faceFromImageTitle}
      >
        {facePhase ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <ScanFace className="mr-1 h-3 w-3" />
        )}
        {facePhase ? facePhaseLabel : "人脸·图生图"}
      </Button>
      <Button
        variant="default"
        size="sm"
        className="h-6 gap-1 text-[11px]"
        onClick={onFaceFromText}
        disabled={faceFromTextDisabled}
        title={faceFromTextTitle}
      >
        {facePhase ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <ScanFace className="mr-1 h-3 w-3" />
        )}
        {facePhase ? facePhaseLabel : "人脸·文生图"}
      </Button>
    </>
  );

  /** 表情差分节头生成钮(10-21 既有功能迁居,守卫/相位文案零变)。 */
  const renderExpressionSectionButton = () => (
    <Button
      variant="default"
      size="sm"
      className="h-6 gap-1 text-[11px]"
      onClick={onExpression}
      disabled={expressionDisabled}
      title={expressionTitle}
    >
      {expressionPhase ? (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      ) : (
        <ScanFace className="mr-1 h-3 w-3" />
      )}
      {expressionPhase ? expressionPhaseLabel : "表情差分"}
    </Button>
  );

  /** 批3 按型出图节头生成钮(型驱动通用件派发,型名单一参数):Loader2 相位复用
   *  (第五路在跑全族禁点+typeShotMessage 进 title);i2i 型零图禁用(title 提示,
   *  轨道名词随轨),t2i 型(设定卡/美宣/道具)描述锚身份,零图可点。 */
  const renderTypeShotSectionButton = (kind: AssetImageKind, route: "i2i" | "t2i") => {
    const needsReference = route === "i2i";
    const disabled = generationBusy || (needsReference && images.length === 0);
    const title = needsReference && images.length === 0
      ? `先有${trackNoun}图片才能图生图生成${kind}`
      : typeShotPhase
        ? (typeShotMessage || `正在生成${kind}，请稍候`)
        : generatePhase
          ? "图片生成中，请稍候"
          : i2iPhase
            ? "正在转换画风，请稍候"
            : facePhase
              ? "正在生成高清人脸，请稍候"
              : expressionPhase
                ? "正在生成表情差分，请稍候"
                : `生成${kind}(${route === "t2i" ? "文生图·型层" : "图生图·型层"})`;
    return (
      <Button
        variant="default"
        size="sm"
        className="h-6 gap-1 text-[11px]"
        onClick={() => onTypeShot?.(kind)}
        disabled={disabled}
        title={title}
      >
        {typeShotPhase ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="mr-1 h-3 w-3" />
        )}
        {typeShotPhase ? typeShotPhaseLabel : `生成${kind}`}
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
  // 批3 按型出图:型档案快查(节头钮/徽标装配用;高清人脸/表情差分既有路恒不收编)
  const typeShotProfileByKind = new Map(ASSET_TYPE_SHOT_PROFILES.map((profile) => [profile.kind as AssetImageKind, profile]));
  // Round 3 ⑤:下拉按当前资产轨取谱(role 七型回归零变化;scene 四型/tool 两型)
  const trackTypeShotProfiles = track ? getAssetTypeShotProfilesForTrack(track) : [];

  /** 完整度总览条(grill Round 1 裁定1 两行分级+Round 3 ⑤ 三轨同款):核心行逐型
   *  ✓/✗/n(role 五必备/scene 三核心/tool 一核心),缺失红色可点=直达该型生成(展示
   *  与生成两腿闭环);扩展行灰占不告警。批3 装配:「按型出图」下拉(按轨取谱,菜单项
   *  带画幅/透明徽标)+ 一键补缺顺序队列。
   *  复审 H/M 修:chips 计数与缺失判定按本行 completenessCount(Q1 不抵扣);任一
   *  生成相位在跑,缺失 chip 直达入口禁用+title(与节头钮/下拉/一键补缺同闸)。 */
  const renderCompletenessBar = () => {
    const coreKinds = spectrum?.core ?? [];
    const extendedKinds = spectrum?.extended ?? [];
    const missingCoreCount = coreKinds.filter((kind) => completenessCount(kind) === 0).length;
    const fillMissingDisabled = generationBusy || (onFillMissing != null && missingCoreCount === 0);
    const fillMissingTitle = onFillMissing == null
      ? "一键补缺队列候装配方接线"
      : missingCoreCount === 0
        ? "核心必备已齐，无需补缺"
        : typeShotPhase
          ? (typeShotMessage || "正在补缺，请稍候")
          : generationBusy
            ? "有生成任务正在进行，请稍候"
            : `按节序顺序补全缺失的 ${missingCoreCount} 类核心图`;
    return (
    <div className="studio-asset-completeness-bar sticky top-0 z-[1] space-y-1.5 rounded-md border border-border bg-background/95 px-3 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-foreground">图片规范完整度</span>
        {/* 批3「按型出图」下拉(Round 3 ⑤ 按轨取谱):菜单项带画幅/透明徽标,型名单一参数派发 */}
        {canTypeShot && onTypeShot && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="studio-asset-typeshot-trigger h-6 gap-1 px-2 text-[11px]"
                disabled={generationBusy}
                title={typeShotPhase ? (typeShotMessage || "按型出图进行中，请稍候") : `按型出图(${trackTypeShotProfiles.length} 型:画幅/透明徽标见菜单项)`}
              >
                {typeShotPhase ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Wand2 className="h-3 w-3" />
                )}
                按型出图
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="studio-asset-typeshot-menu">
              {trackTypeShotProfiles.map((profile) => (
                <DropdownMenuItem
                  key={profile.kind}
                  className="studio-asset-typeshot-item gap-2 text-xs"
                  disabled={generationBusy}
                  onClick={() => onTypeShot?.(profile.kind)}
                >
                  <span>{profile.kind}</span>
                  <Badge variant="outline" className="ml-auto px-1.5 py-0 text-[10px] font-medium">{profile.aspect}</Badge>
                  {profile.rgba && (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium text-primary">透明</Badge>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* 批3 一键补缺顺序队列:缺失核心型逐型顺序补全(聚合相位,逐型完成落图) */}
        <Button
          variant="outline"
          size="sm"
          className="studio-asset-fill-missing h-6 gap-1 px-2 text-[11px]"
          onClick={() => onFillMissing?.()}
          disabled={fillMissingDisabled || !onFillMissing}
          title={fillMissingTitle}
        >
          {typeShotPhase ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          一键补缺
        </Button>
        {typeShotPhase && typeShotMessage && (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={typeShotMessage}>
            {typeShotMessage}
          </span>
        )}
      </div>
      <div
        className="studio-asset-completeness-core-row flex flex-wrap items-center gap-1.5"
        aria-label={`核心${COUNT_ZH[coreKinds.length] ?? coreKinds.length}必备`}
      >
        {coreKinds.map((kind) => {
          const count = completenessCount(kind);
          const missing = count === 0;
          return onGenerateByKind && missing ? (
            <button
              key={kind}
              type="button"
              className="studio-asset-completeness-chip studio-asset-completeness-chip-missing rounded-full border border-destructive/50 bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive transition-colors hover:bg-destructive/20"
              onClick={() => onGenerateByKind?.(kind)}
              disabled={generationBusy}
              title={generationBusy ? "有生成任务正在进行，请稍候" : `缺失${kind}，点击生成`}
            >
              {kind} ✗
            </button>
          ) : (
            <span
              key={kind}
              className={`studio-asset-completeness-chip rounded-full border px-2 py-0.5 text-[11px] ${
                missing
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : "border-primary/30 bg-primary/5 text-foreground"
              }`}
            >
              {kind} {missing ? "✗" : `✓${count}`}
            </span>
          );
        })}
      </div>
      <div
        className="studio-asset-completeness-extended-row flex flex-wrap items-center gap-1.5"
        aria-label={`扩展${COUNT_ZH[extendedKinds.length] ?? extendedKinds.length}型`}
      >
        {extendedKinds.map((kind) => {
          const count = completenessCount(kind);
          return (
            <span
              key={kind}
              className="studio-asset-completeness-chip studio-asset-completeness-chip-extended rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {kind} {count > 0 ? count : "—"}
            </span>
          );
        })}
      </div>
    </div>
    );
  };

  return (
    <div className="studio-asset-image-spec-region space-y-4">
      {isTypedGallery && renderCompletenessBar()}

      {isTypedGallery ? (
        <>
          {TYPED_SECTION_DEFS.map(({ kind, aspect }) => {
            const group = kindGroups.get(kind) ?? [];
            const widthClass = sectionCardWidthClass(aspect);
            const typeShotProfile = typeShotProfileByKind.get(kind);
            const sectionButtons = kind === "高清人脸" && canFacePortrait
              ? renderFaceSectionButtons()
              : kind === "表情差分" && canFacePortrait
                ? renderExpressionSectionButton()
                : typeShotProfile && canTypeShot && onTypeShot
                  ? renderTypeShotSectionButton(kind, typeShotProfile.route)
                  : undefined;
            return renderSection(
              kind,
              kind,
              aspect,
              group.length > 0
                ? group.map(({ image, index }) => renderImageCard(image, index, widthClass))
                : renderPlaceholderCard(kind, widthClass, { kind }),
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
            ? images.map((image, index) => renderImageCard(image, index, squareWidth))
            : renderPlaceholderCard("图片", squareWidth),
          images.length,
        )
      )}

      {/* 工具行:作用于全局选中图(批1 守卫与原按钮区零变;i2i 三轨+有图门禁在装配方) */}
      <div className="studio-asset-gallery-toolbar flex flex-wrap items-center gap-2">
        <Button variant="default" size="sm" onClick={onRegenerate}>
          <Sparkles className="mr-2 h-3.5 w-3.5" />
          重新出图
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={onImageToImage}
          disabled={imageToImageDisabled}
          title={imageToImageTitle}
        >
          {i2iPhase ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="mr-2 h-3.5 w-3.5" />
          )}
          {i2iPhase ? i2iPhaseLabel : "图生图"}
        </Button>
        <Button variant="outline" size="sm" onClick={onCopyPrompt}>
          <Clipboard className="mr-2 h-3.5 w-3.5" />
          复制出图提示词
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenSource}>
          <ExternalLink className="mr-2 h-3.5 w-3.5" />
          查看图片
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenFolder}>
          <FolderOpen className="mr-2 h-3.5 w-3.5" />
          打开本地文件夹
        </Button>
        <Button variant="outline" size="sm" onClick={onAddImage}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          添加图片
        </Button>
        {/* #10 更换图片恒居工具行单钮(复审 M1:回调恒换当前行主图,不随卡点名防误导;
         *  零图空壳换主图链路同钮直达) */}
        <Button variant="outline" size="sm" onClick={onReplaceImage}>
          <ImageIcon className="mr-2 h-3.5 w-3.5" />
          更换图片
        </Button>
        {selectedImage ? (
          <span className="ml-auto min-w-0 max-w-56 truncate text-[11px] text-muted-foreground" title={selectedImage.name}>
            当前选中:{selectedImage.name}
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-muted-foreground/70">未选中图片</span>
        )}
      </div>
    </div>
  );
}
