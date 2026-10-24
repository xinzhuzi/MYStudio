import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";
import {
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
import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";

const waveformBars = [42, 68, 50, 84, 46, 72, 58, 92, 54, 76, 48, 66, 40, 60, 36, 70];

/**
 * 10-24 布局重造(批1骨架):角色轨按型分节,节序=grill Round 1 裁定2
 * (身份链根→常规产物→重版式→工具型→兜底)。批2 classifyAssetImage 上线前,
 * 存量图全部落「早期未分类」节,其余型节以占位卡示位(槽位恒在,NPC 用不全)。
 */
const ROLE_IMAGE_SECTION_DEFS = [
  { kind: "全身定妆", aspect: "3:4" },
  { kind: "人物海报", aspect: "3:4" },
  { kind: "人物多视图", aspect: "16:9" },
  { kind: "高清人脸", aspect: "1:1" },
  { kind: "表情差分", aspect: "1:1" },
  { kind: "设定卡", aspect: "16:9" },
  { kind: "美宣", aspect: "16:9" },
  { kind: "人脸基准", aspect: "1:1" },
  { kind: "自由", aspect: "1:1" },
] as const;

const UNCATEGORIZED_SECTION_KIND = "早期未分类";
/** scene/tool/clip 轨无型谱=单节「图片」横向行(10-24 裁定 D)。 */
const SINGLE_SECTION_TITLE = "图片";

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
  /** 10-21 高清人脸(用户令:图生图/文生图两路都要);仅角色轨由装配方置真。 */
  onFaceFromImage?: () => void | Promise<void>;
  onFaceFromText?: () => void | Promise<void>;
  /** 人脸生成相位(两路共用一套状态机;在跑时 Loader2+文案并禁点)。 */
  facePhase?: string | null;
  /** 人脸生成相位文案(运行态按钮 title 全文)。 */
  faceMessage?: string;
  /** 角色轨才显示人脸按钮;缺省 false(非角色零侵入)。 */
  canFacePortrait?: boolean;
  /** 10-21 表情差分(用户令:图生图逻辑);仅角色轨由装配方置真。 */
  onExpression?: () => void | Promise<void>;
  /** 表情差分生成相位(在跑时 Loader2+文案并禁点)。 */
  expressionPhase?: string | null;
  /** 表情差分相位文案(运行态按钮 title 全文)。 */
  expressionMessage?: string;
  onCopyPrompt: () => void | Promise<void>;
  onOpenSource: () => void | Promise<void>;
  onOpenFolder: () => void | Promise<void>;
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
  isImageRemovable,
}: StudioAssetDetailPreviewPaneProps) {
  const hasImagePreview = asset.type !== "audio" && images.length > 0;
  // 10-21 高清人脸/表情差分:与一键生成/画风转换互斥(任一生成相位在跑全禁)
  const generationBusy = !!i2iPhase || !!generatePhase || !!facePhase || !!expressionPhase;
  const imageToImageDisabled = generationBusy || !canImageToImage;
  const imageToImageTitle = !canImageToImage
    ? "仅角色/场景/道具三轨且有图资产可转画风"
    : generatePhase
      ? "图片生成中，请稍候"
      : i2iPhase
        ? (i2iMessage || "正在转换画风，请稍候")
        : facePhase
          ? (faceMessage || "正在生成高清人脸，请稍候")
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
          : undefined;
  const faceFromTextDisabled = generationBusy;
  const faceFromTextTitle = generatePhase
    ? "图片生成中，请稍候"
    : i2iPhase
      ? "正在转换画风，请稍候"
      : facePhase
        ? (faceMessage || "正在生成高清人脸，请稍候")
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
            : undefined;
  const expressionPhaseLabel = expressionPhase === "done"
    ? "表情差分完成"
    : expressionPhase === "failed"
      ? "表情差分失败"
      : "表情差分生成中…";

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
  const isRoleGallery = asset.type === "role";

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

  /** 占位卡:虚线边框,型画幅比照图卡;空型槽位恒在(10-24 布局令)。 */
  const renderPlaceholderCard = (label: string, widthClass: string) => (
    <div
      className={`studio-asset-image-placeholder flex ${widthClass} shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-2 text-center text-muted-foreground transition-colors hover:border-primary/40`}
    >
      <Icon className="h-6 w-6 opacity-50" />
      <span className="text-xs">尚无{label}</span>
    </div>
  );

  /** 类型节:节头(型名+画幅徽标+计数+该型生成钮)+横向卡片行(overflow-x 自由横滑)。 */
  const renderSection = (
    sectionKey: string,
    title: string,
    aspect: string | null,
    cards: ReactNode,
    count: number,
    headerButtons?: ReactNode,
  ) => (
    <section key={sectionKey} className="studio-asset-image-section space-y-2" aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {aspect && <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium">{aspect}</Badge>}
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

  const squareWidth = sectionCardWidthClass(null);

  return (
    <div className="studio-asset-image-spec-region space-y-4">
      {/* 完整度总览条占位(批1骨架):按型统计+一键补缺待批2 图片分类上线后启用 */}
      {isRoleGallery && (
        <div className="studio-asset-completeness-bar sticky top-0 z-[1] flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-2 backdrop-blur">
          <span className="text-xs font-medium text-foreground">图片规范完整度</span>
          <span className="text-[11px] text-muted-foreground">按型统计与一键补缺待图片分类上线后启用</span>
        </div>
      )}

      {isRoleGallery ? (
        <>
          {ROLE_IMAGE_SECTION_DEFS.map(({ kind, aspect }) =>
            renderSection(
              kind,
              kind,
              aspect,
              renderPlaceholderCard(kind, sectionCardWidthClass(aspect)),
              0,
              kind === "高清人脸" && canFacePortrait
                ? renderFaceSectionButtons()
                : kind === "表情差分" && canFacePortrait
                  ? renderExpressionSectionButton()
                  : undefined,
            ),
          )}
          {renderSection(
            UNCATEGORIZED_SECTION_KIND,
            UNCATEGORIZED_SECTION_KIND,
            null,
            hasImagePreview
              ? images.map((image, index) => renderImageCard(image, index, squareWidth))
              : renderPlaceholderCard("图片", squareWidth),
            images.length,
          )}
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
