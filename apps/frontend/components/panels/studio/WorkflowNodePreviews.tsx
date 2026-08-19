import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Film,
  Gauge,
  Image as ImageIcon,
  ImageOff,
  Layers3,
  Loader2,
  PackageOpen,
  RefreshCw,
  TriangleAlert,
  ZoomIn,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/app/theme-store";
import { useDirectImageUpscale } from "./use-direct-image-upscale";
import { UPSCALE_INPUT_MAX_LONG_SIDE } from "@/lib/upscale/client";
import type {
  AssetImageWorkflowContext,
  ImageWorkflowOpenContext,
  ImageWorkflowTarget,
} from "@/types/studio";
import type {
  ProductionFlowAssetCard,
  ProductionFlowNodeId,
  ProductionFlowNodeModel,
  ProductionFlowRemotionShot,
} from "./workflow-node-model";
import {
  formatRendererLabel,
  normalizeRemotionRendererSummary,
} from "./workflow-node-model";

const NODE_PREVIEW_CLASS = {
  script: "max-h-[560px]",
  scriptPlan: "h-[520px]",
  assets: "max-h-[560px]",
  storyboardTable: "max-h-[430px]",
  storyboard: "max-h-[320px]",
  remotionProduction: "max-h-[520px]",
  workbench: "max-h-[420px]",
} satisfies Record<ProductionFlowNodeId, string>;

export function TextPreview({ node }: { node: ProductionFlowNodeModel }) {
  const theme = useThemeStore((state) => state.theme);
  return (
    <div
      className={cn(
        "workflow-node-markdown-preview nodrag nopan nowheel overflow-y-auto overscroll-contain rounded-md px-3 py-2 text-[13px] leading-6 text-muted-foreground",
        node.id === "scriptPlan" &&
          "py-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/25 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5",
        NODE_PREVIEW_CLASS[node.id],
      )}
    >
      <MdPreview
        className={cn(
          "md-editor-preview-transparent !bg-transparent text-foreground",
          "[&_.md-editor]:!bg-transparent [&_.md-editor-preview]:!bg-transparent [&_.md-editor-preview-wrapper]:!bg-transparent",
          "[&_.md-editor-preview]:!p-0 [&_.md-editor-preview]:text-[13px] [&_.md-editor-preview]:leading-6",
          "[&_.md-editor-preview_h1]:mb-3 [&_.md-editor-preview_h1]:text-lg [&_.md-editor-preview_h1]:leading-7",
          "[&_.md-editor-preview_h2]:mb-2 [&_.md-editor-preview_h2]:mt-3 [&_.md-editor-preview_h2]:text-base [&_.md-editor-preview_h2]:leading-6",
          "[&_.md-editor-preview_h3]:mb-1.5 [&_.md-editor-preview_h3]:mt-2.5 [&_.md-editor-preview_h3]:text-sm [&_.md-editor-preview_h3]:leading-6",
          "[&_.md-editor-preview_p]:my-2 [&_.md-editor-preview_li]:my-1",
          "[&_.md-editor-preview_ul]:my-2 [&_.md-editor-preview_ol]:my-2",
          "[&_.md-editor-preview_table]:my-3 [&_.md-editor-preview_table]:text-[12px]",
          "[&_.md-editor-preview_pre]:my-3 [&_.md-editor-preview_pre]:max-w-full [&_.md-editor-preview_pre]:overflow-auto",
        )}
        modelValue={buildPreviewMarkdown(node)}
        theme={theme}
        language="zh-CN"
      />
    </div>
  );
}

export function buildPreviewMarkdown(node: ProductionFlowNodeModel) {
  const markdown = node.previewLines.join("\n").trim() || "暂无内容";
  return node.id === "scriptPlan"
    ? unwrapTaggedMarkdown(markdown, "scriptPlan")
    : markdown;
}

function unwrapTaggedMarkdown(markdown: string, tagName: string) {
  const taggedSegments = [...markdown.matchAll(new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`, "g"))]
    .map((match) => match[1]?.trim())
    .filter((segment): segment is string => Boolean(segment));
  if (taggedSegments.length) return taggedSegments.join("\n\n");

  const withoutLooseTags = markdown
    .replace(new RegExp(`</?${tagName}>`, "g"), "")
    .trim();
  return withoutLooseTags || "暂无内容";
}

export function AssetDerivationPreview({
  node,
  onOpenAssetImageWorkflow,
}: {
  node: ProductionFlowNodeModel;
  onOpenAssetImageWorkflow?: (context: AssetImageWorkflowContext) => void;
}) {
  const groups = node.assetGroups ?? [];
  const [activeType, setActiveType] = useState<AssetDerivationFilter>("all");
  if (!groups.length) return <TextPreview node={node} />;
  const summary = node.assetSummary;
  const visibleGroups =
    activeType === "all"
      ? groups
      : groups.filter((group) => group.source.runtimeType === activeType);
  const filterCounts = countAssetGroupsByType(groups);
  const filters: Array<{ id: AssetDerivationFilter; label: string; count: number }> = [
    { id: "all", label: "全部", count: groups.length },
    { id: "role", label: "人物", count: filterCounts.role },
    { id: "scene", label: "场景", count: filterCounts.scene },
    { id: "tool", label: "道具", count: filterCounts.tool },
  ];
  return (
    <div className="nodrag nopan nowheel max-h-[560px] space-y-4 overflow-y-auto overscroll-contain pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/25 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
      {summary ? (
        <div className="asset-derive-summary grid grid-cols-4 gap-2 rounded-md border border-border bg-card p-2 text-card-foreground">
          <AssetSummaryCell label="导演预划" value={summary.planned} />
          <AssetSummaryCell label="已有衍生" value={summary.existing} />
          <AssetSummaryCell label="已完成图片" value={summary.completed} />
          <AssetSummaryCell
            label="缺父资产"
            value={summary.missingParent}
            warn={summary.missingParent > 0}
          />
        </div>
      ) : null}
      <div className="asset-derive-type-switch grid grid-cols-4 gap-1 rounded-md border border-border bg-muted/20 p-1">
        {filters.map((filter) => {
          const selected = activeType === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              className={cn(
                "nodrag nopan nowheel h-8 rounded-lg px-2 text-[11px] font-medium transition-colors",
                selected
                  ? "bg-info/20 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={(event) => {
                event.stopPropagation();
                setActiveType(filter.id);
              }}
            >
              {filter.label} {filter.count}
            </button>
          );
        })}
      </div>
      {visibleGroups.map((group) => (
        <div
          key={group.source.id}
          className="grid grid-cols-[188px_34px_minmax(188px,1fr)] items-stretch gap-3"
        >
          <AssetFlowCard card={group.source} />
          <div className="flex items-center justify-center text-muted-foreground">
            <ChevronRight className="h-6 w-6" />
          </div>
          {group.derived.length ? (
            <div className="grid grid-cols-2 gap-3">
              {group.derived.slice(0, 4).map((item) => (
                <AssetFlowCard
                  key={item.id}
                  card={item}
                  onOpenAssetImageWorkflow={onOpenAssetImageWorkflow}
                />
              ))}
            </div>
          ) : (
            <EmptyDerivedAssetCard />
          )}
        </div>
      ))}
    </div>
  );
}

type AssetDerivationFilter = "all" | ProductionFlowAssetCard["runtimeType"];

function countAssetGroupsByType(groups: ProductionFlowNodeModel["assetGroups"]) {
  return (groups ?? []).reduce(
    (counts, group) => {
      counts[group.source.runtimeType] += 1;
      return counts;
    },
    { role: 0, scene: 0, tool: 0 },
  );
}

export function AssetFlowCard({
  card,
  onOpenAssetImageWorkflow,
}: {
  card: ProductionFlowAssetCard;
  onOpenAssetImageWorkflow?: (context: AssetImageWorkflowContext) => void;
}) {
  const status = card.generationState ?? (card.mediaPath ? "已完成" : "未生成");
  const directUpscale = useDirectImageUpscale();
  const assetUpscaleTarget = isAssetWorkflowTarget(card.imageWorkflowTarget) && card.imageWorkflowTarget.id
    ? {
        assetType: card.imageWorkflowTarget.assetType as "character" | "scene" | "prop",
        id: card.imageWorkflowTarget.id,
        parentId: card.imageWorkflowTarget.parentId,
      }
    : null;
  const assetUpscaling = assetUpscaleTarget != null
    && directUpscale.busyKey === `asset:${assetUpscaleTarget.id}`;
  const [assetImageLongSide, setAssetImageLongSide] = useState(0);
  const assetAlreadyUpscaled = (card.mediaPath || "").includes("up4x-")
    || assetImageLongSide > UPSCALE_INPUT_MAX_LONG_SIDE;
  const canOpenImageWorkflow =
    card.isDerived &&
    Boolean(card.sourceImagePath || card.imageWorkflowId || card.mediaPath) &&
    isAssetWorkflowTarget(card.imageWorkflowTarget);
  const openImageWorkflow = () => {
    if (!isAssetWorkflowTarget(card.imageWorkflowTarget)) return;
    onOpenAssetImageWorkflow?.({
      target: card.imageWorkflowTarget,
      title: card.name,
      prompt: card.prompt,
      sourceImagePath: card.sourceImagePath,
      resultImagePath: card.mediaPath,
      imageWorkflowId: card.imageWorkflowId,
      sourceStage: "storyboard",
      sourceStageLabel: "分镜视频生成",
      sourceLabel: `衍生资产 · ${card.name}`,
    });
  };
  const showStatusChip = status !== "已完成";
  const previewFrame = (
    <>
      {card.mediaPath ? (
        <img
          src={toPreviewSrc(card.mediaPath)}
          alt={card.name}
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
          onLoad={(event) => {
            const image = event.currentTarget;
            setAssetImageLongSide(Math.max(image.naturalWidth, image.naturalHeight));
          }}
        />
      ) : status === "生成中" ? (
        <RefreshCw className="h-8 w-8 animate-spin text-primary/70" />
      ) : (
        <PackageOpen className="h-9 w-9 text-muted-foreground/55" />
      )}
    </>
  );
  return (
    <div
      className="min-h-[214px] rounded-md border border-border bg-card p-3 text-card-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
      data-parent-asset-id={card.parentAssetId ?? ""}
      data-asset-generation-state={status}
    >
      {canOpenImageWorkflow ? (
        <button
          type="button"
          aria-label={`打开${card.name}图片工作流`}
          data-asset-workflow-image-id={card.imageWorkflowId ?? ""}
          data-asset-workflow-id={card.imageWorkflowId ?? ""}
          data-asset-workflow-type={card.imageWorkflowTarget?.assetType ?? ""}
          data-asset-workflow-name={card.name}
          className="nodrag nopan nowheel flex h-[112px] w-full items-center justify-center overflow-hidden rounded-md border border-info/35 bg-muted/30 ring-offset-background hover:border-info/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40 focus-visible:ring-offset-2"
          onClick={(event) => {
            event.stopPropagation();
            openImageWorkflow();
          }}
        >
          {previewFrame}
        </button>
      ) : (
        <div className="flex h-[112px] items-center justify-center overflow-hidden rounded border border-border/60 bg-muted/30">
          {previewFrame}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] text-muted-foreground">
          {card.typeLabel} / {card.runtimeType}
        </span>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
            card.isDerived
              ? "bg-warning/20 text-foreground"
              : "bg-success/20 text-foreground",
          )}
        >
          {card.isDerived ? "衍生" : "原资产"}
        </span>
      </div>
      {showStatusChip || (card.isDerived && !card.sourceImagePath) ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {showStatusChip ? (
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[9px] font-semibold",
                status === "生成中" &&
                  "border-primary/30 bg-primary/12 text-primary/80",
                status === "生成失败" &&
                  "border-destructive/30 bg-destructive/12 text-destructive/80",
                status === "未生成" &&
                  "border-border bg-muted/30 text-muted-foreground",
              )}
            >
              {status}
            </span>
          ) : null}
          {card.isDerived && !card.sourceImagePath ? (
            <span className="max-w-full truncate rounded border border-viz-glow/30 bg-viz-glow/10 px-1.5 py-0.5 text-[9px] text-warning/80">
              缺父资产图
            </span>
          ) : null}
        </div>
      ) : null}
      <p className="mt-1 line-clamp-1 text-[11px] font-medium text-card-foreground">
        {card.name}
      </p>
      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
        {card.reason || card.note || "等待补充资产描述。"}
      </p>
      {card.prompt ? (
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
          生成提示：{card.prompt}
        </p>
      ) : null}
      {canOpenImageWorkflow ? (
        <button
          type="button"
          data-asset-workflow-id={card.imageWorkflowId ?? ""}
          data-asset-workflow-type={card.imageWorkflowTarget?.assetType ?? ""}
          data-asset-workflow-name={card.name}
          className="nodrag nopan nowheel mt-2 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-info/35 bg-info/10 px-2 text-[10px] font-medium text-info/80 hover:bg-info/16"
          onClick={(event) => {
            event.stopPropagation();
            openImageWorkflow();
          }}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          进入图片工作流
        </button>
      ) : null}
      {assetUpscaleTarget && card.mediaPath ? (
        <button
          type="button"
          data-asset-upscale-id={assetUpscaleTarget.id}
          disabled={assetUpscaling || assetAlreadyUpscaled}
          title={assetAlreadyUpscaled ? `已达 4K(${assetImageLongSide}px 长边)，无需再超分` : "本地 Real-ESRGAN 原生 ×4 放大(1K→4K)"}
          className="nodrag nopan nowheel mt-1.5 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 text-[10px] font-medium text-foreground hover:border-viz-glow/45 disabled:opacity-60"
          onClick={(event) => {
            event.stopPropagation();
            void directUpscale.upscaleAssetImage(assetUpscaleTarget, card.mediaPath as string);
          }}
        >
          {assetUpscaling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ZoomIn className="h-3.5 w-3.5" />}
          超分 4K
        </button>
      ) : null}
    </div>
  );
}

function isAssetWorkflowTarget(
  target: ImageWorkflowTarget | undefined,
): target is AssetImageWorkflowContext["target"] {
  return target?.kind === "asset" && Boolean(target.assetType);
}

function AssetSummaryCell({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded border border-border bg-muted/30 px-2 py-1.5",
        warn && "border-viz-glow/35 bg-viz-glow/10",
      )}
    >
      <div className="truncate text-[9px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-[13px] font-semibold text-foreground",
          warn && "text-warning/80",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyDerivedAssetCard() {
  return (
    <div className="flex min-h-[214px] flex-col items-center justify-center rounded-md border border-border bg-card/85 p-3 text-center">
      <ImageOff className="h-10 w-10 text-muted-foreground/55" />
      <p className="mt-3 text-[11px] text-muted-foreground">无衍生资产</p>
    </div>
  );
}

export function StoryboardTablePreview({
  node,
}: {
  node: ProductionFlowNodeModel;
}) {
  const rows = node.tableRows ?? [];
  if (!rows.length) return <TextPreview node={node} />;
  return (
    <div className="nodrag nowheel max-h-[430px] overflow-auto overscroll-contain rounded-md bg-muted/10">
      <div className="sticky top-0 z-10 grid min-w-[1920px] grid-cols-[44px_0.82fr_0.72fr_1.5fr_0.72fr_1.05fr_54px_0.62fr_0.72fr_1.35fr_0.82fr_0.95fr_0.72fr_1.2fr_0.82fr_0.9fr] bg-muted text-[10px] font-medium text-foreground">
        <span className="px-2 py-2">序号</span>
        <span className="px-2 py-2">标题</span>
        <span className="px-2 py-2">title</span>
        <span className="px-2 py-2">画面描述</span>
        <span className="px-2 py-2">场景</span>
        <span className="px-2 py-2">关联资产名称</span>
        <span className="px-2 py-2">时长</span>
        <span className="px-2 py-2">景别</span>
        <span className="px-2 py-2">运镜</span>
        <span className="px-2 py-2">角色动作</span>
        <span className="px-2 py-2">朝向</span>
        <span className="px-2 py-2">空间关系</span>
        <span className="px-2 py-2">情绪</span>
        <span className="px-2 py-2">台词</span>
        <span className="px-2 py-2">音效</span>
        <span className="px-2 py-2">关联资产ID</span>
      </div>
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div
            key={`${node.id}-row-${row.index}`}
            className="grid min-w-[1920px] grid-cols-[44px_0.82fr_0.72fr_1.5fr_0.72fr_1.05fr_54px_0.62fr_0.72fr_1.35fr_0.82fr_0.95fr_0.72fr_1.2fr_0.82fr_0.9fr] text-[10px] leading-4 text-muted-foreground odd:bg-muted/35"
          >
            <span className="px-2 py-2 text-foreground">{row.index}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.title || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.titleEn || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.description || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.scene || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.associateAssetsNames.join("、") || "—"}</span>
            <span className="px-2 py-2">{row.duration || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.shotSize || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.cameraMove || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.action || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.orientation || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.spatialRelation || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.emotion || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.lines || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.sound || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.associateAssetsIds.join("、") || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 4K 预判：up4x- 输出路径必然 ≥4K(同步可靠)；其余依赖 <img> naturalWidth
 * (onLoad 尽力而为，懒加载/缓存场景可能缺席——后端守卫兜底)。
 */
function tileAlready4k(mediaPath: string | undefined, longSide: number | undefined): boolean {
  if (typeof mediaPath === "string" && mediaPath.includes("up4x-")) return true;
  return (longSide ?? 0) > UPSCALE_INPUT_MAX_LONG_SIDE;
}

export function StoryboardGridPreview({
  node,
  onOpenImageWorkflow,
}: {
  node: ProductionFlowNodeModel;
  onOpenImageWorkflow?: (context: ImageWorkflowOpenContext) => void;
}) {
  const tiles = node.storyboardTiles ?? [];
  const directUpscale = useDirectImageUpscale();
  const [tileLongSides, setTileLongSides] = useState<Record<string, number>>({});
  if (!tiles.length) return <TextPreview node={node} />;
  return (
    <div className="nodrag nowheel max-h-[360px] overflow-y-auto overscroll-contain pr-1">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2">
        {tiles.map((tile) => {
          const canOpenWorkflow = Boolean(tile.imageWorkflowId || tile.mediaPath);
          const openStoryboardImageWorkflow = () => {
            onOpenImageWorkflow?.({
              target: { kind: "storyboard", id: tile.id },
              title: `分镜 ${tile.index}`,
              prompt: tile.title,
              sourceImagePath: tile.mediaPath,
              resultImagePath: tile.mediaPath,
              imageWorkflowId: tile.imageWorkflowId,
              sourceStage: "storyboard",
              sourceStageLabel: "分镜视频生成",
              sourceLabel: `分镜成图 · 分镜 ${tile.index}`,
            });
          };
          const previewTile = (
            <>
              {tile.mediaPath ? (
                <img
                  src={toPreviewSrc(tile.mediaPath)}
                  alt={tile.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    const longSide = Math.max(image.naturalWidth, image.naturalHeight);
                    setTileLongSides((previous) => (previous[tile.id] === longSide ? previous : { ...previous, [tile.id]: longSide }));
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                  未生成
                </div>
              )}
              <span className="absolute left-1 top-1 rounded bg-success/20 px-1.5 py-0.5 text-[9px] font-semibold text-foreground">
                S{String(tile.index).padStart(2, "0")}
              </span>
              <span className="absolute right-1 top-1 rounded bg-background/80 px-1.5 py-0.5 text-[9px] text-foreground">
                {tile.state}
              </span>
            </>
          );
          return (
          <div key={tile.id} className="min-w-0">
            {canOpenWorkflow ? (
              <button
                type="button"
                aria-label={`打开分镜 ${tile.index} 图片工作流`}
                data-storyboard-id={tile.id}
                data-storyboard-workflow-image-id={tile.imageWorkflowId ?? ""}
                data-storyboard-workflow-id={tile.imageWorkflowId}
                className="nodrag nopan nowheel relative block aspect-video w-full overflow-hidden rounded-md border border-info/35 bg-muted/30 text-left ring-offset-background hover:border-info/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40 focus-visible:ring-offset-2"
                onClick={openStoryboardImageWorkflow}
              >
                {previewTile}
              </button>
            ) : (
              <div className="relative aspect-video overflow-hidden rounded border border-border bg-muted/30">
                {previewTile}
              </div>
            )}
            {canOpenWorkflow ? (
              <button
                type="button"
                data-storyboard-id={tile.id}
                data-storyboard-workflow-id={tile.imageWorkflowId}
                className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-muted/30 px-1.5 py-1 text-[10px] text-muted-foreground hover:border-primary/45 hover:text-foreground"
                onClick={openStoryboardImageWorkflow}
              >
                <ImageIcon className="h-3 w-3" />
                进入分镜图片工作流
              </button>
            ) : null}
            {tile.mediaPath ? (
              <button
                type="button"
                data-storyboard-upscale-id={tile.id}
                disabled={directUpscale.busyKey === `storyboard:${tile.id}` || tileAlready4k(tile.mediaPath, tileLongSides[tile.id])}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-muted/30 px-1.5 py-1 text-[10px] text-muted-foreground hover:border-viz-glow/45 hover:text-foreground disabled:opacity-60"
                title={tileAlready4k(tile.mediaPath, tileLongSides[tile.id])
                  ? "已是 4K 超分结果，无需再放大"
                  : "本地 Real-ESRGAN 原生 ×4 放大(超分后视觉审核重置)"}
                onClick={(event) => {
                  event.stopPropagation();
                  void directUpscale.upscaleStoryboardImage(tile.id);
                }}
              >
                {directUpscale.busyKey === `storyboard:${tile.id}` ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ZoomIn className="h-3 w-3" />
                )}
                超分 4K
              </button>
            ) : null}
            <p className="mt-1 line-clamp-1 text-[10px] text-foreground">
              {tile.title}
            </p>
            {tile.lines ? (
              <p className="line-clamp-1 text-[10px] text-muted-foreground">
                {tile.lines}
              </p>
            ) : null}
          </div>
        );
        })}
      </div>
    </div>
  );
}

export function WorkbenchLanePreview({
  node,
}: {
  node: ProductionFlowNodeModel;
}) {
  const tracks = node.workbenchTracks ?? [];
  const rendererSummary = node.remotionSummary
    ? normalizeRemotionRendererSummary(node.rendererSummary)
    : node.rendererSummary ?? { requested: "ffmpeg" as const };
  const exportReady = node.remotionSummary
    ? rendererSummary.actual === "remotion" && Boolean(rendererSummary.outputPath)
    : Boolean(node.finalExportPath);
  return (
    <div className="workbench-lane-preview nodrag nowheel max-h-[320px] space-y-3 overflow-y-auto overscroll-contain pr-1">
      {node.remotionSummary ? (
        <div className="flex items-center gap-2 rounded-md border border-success/20 bg-success/20/[0.06] px-3 py-2 text-[10px] text-success/80">
          <span>StoryboardShot MP4</span>
          <span className="text-success/80/70">voice/SFX 已烘入</span>
          <ArrowRight className="h-3.5 w-3.5 text-success/70" />
          <span>原生 Remotion Studio</span>
          <ArrowRight className="h-3.5 w-3.5 text-success/70" />
          <span>ChapterVideo</span>
          <span className="text-success/80/70">仅混入 BGM/环境</span>
          <ArrowRight className="h-3.5 w-3.5 text-success/70" />
          <span>章节 MP4</span>
        </div>
      ) : null}
      <div className="rounded-md border border-border bg-card px-3 py-2 text-[10px] text-card-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">请求渲染器 {formatRendererLabel(rendererSummary.requested)}</span>
          <span className="text-muted-foreground">
            {rendererSummary.actual
              ? `${formatRendererLabel(rendererSummary.lastRequested ?? rendererSummary.requested)} → ${formatRendererLabel(rendererSummary.actual)}`
              : "尚未验证成片"}
          </span>
        </div>
        {!node.remotionSummary && rendererSummary.fallbackEffectIds?.length ? (
          <div className="mt-1 text-warning/80">回退效果：{rendererSummary.fallbackEffectIds.join("、")}</div>
        ) : null}
        {rendererSummary.lastJobId || rendererSummary.outputPath ? (
          <div className="mt-1 grid gap-1 text-muted-foreground">
            {rendererSummary.lastJobId ? <span>{rendererSummary.lastJobId}</span> : null}
            {rendererSummary.outputPath ? <span className="truncate" title={rendererSummary.outputPath}>{rendererSummary.outputPath}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-card-foreground">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {node.remotionSummary ? "章节 Remotion 导出" : "最终导出"}
          </div>
          <div className="mt-1 truncate text-[11px] text-card-foreground">
            {node.remotionSummary
              ? rendererSummary.outputPath || "等待 ChapterVideo 通过原生 Studio 导出"
              : node.finalExportPath || "等待候选片段全部选中后导出"}
          </div>
        </div>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 text-[10px] font-medium text-foreground">
          {exportReady ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          ) : (
            <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {exportReady ? "READY" : "PENDING"}
        </span>
      </div>
      {tracks.length && !node.remotionSummary ? <div className="grid grid-cols-2 gap-2">
        {tracks.map((track, index) => (
          <div
            key={track.id}
            className="min-w-0 rounded-md border border-border bg-card p-2.5 text-card-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-foreground">
                    T{String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate text-[11px] font-medium text-card-foreground">
                    {track.id}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                  {track.prompt || track.reason || "等待生成视频提示词"}
                </p>
              </div>
              <span className="shrink-0 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
                {track.state}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              <WorkbenchStat
                icon={<Layers3 className="h-3 w-3" />}
                label="分镜"
                value={track.storyboardCount}
              />
              <WorkbenchStat
                icon={<ImageOff className="h-3 w-3" />}
                label="素材"
                value={track.mediaCount}
              />
              <WorkbenchStat
                icon={<Clock3 className="h-3 w-3" />}
                label="时长"
                value={`${track.duration}s`}
              />
              <WorkbenchStat
                icon={<Film className="h-3 w-3" />}
                label="候选"
                value={track.videoCount}
              />
            </div>
            <div className="mt-2 truncate rounded border border-border bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground">
              selectedVideoPath:{" "}
              <span className="text-foreground">
                {track.selectedVideoPath || "未选择候选片段"}
              </span>
            </div>
          </div>
        ))}
      </div> : null}
    </div>
  );
}

export function RemotionShotPreview({
  node,
}: {
  node: ProductionFlowNodeModel;
}) {
  const shots = node.remotionShots ?? [];
  const summary = node.remotionSummary;
  return (
    <div className="remotion-shot-preview nodrag nowheel max-h-[480px] space-y-3 overflow-y-auto overscroll-contain pr-1">
      <div className="flex items-center justify-between gap-2 rounded-md border border-info/25 bg-info/20/[0.06] px-3 py-2 text-[10px] text-info/80">
        <span className="font-semibold">当前章节 · {summary?.total ?? shots.length} 个分镜</span>
        <span className="text-info/80/70">每个分镜独立生成一个 StoryboardShot MP4</span>
      </div>
      <div
        aria-label="Remotion 分镜生产链路"
        className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1 rounded-md border border-info/25 bg-info/20/[0.06] px-2 py-2 text-[10px] text-info/80"
      >
        <RemotionFlowStep label="分镜物料" detail="图像 · 音频 · 字幕" />
        <ArrowRight className="h-3.5 w-3.5 text-info/70" />
        <RemotionFlowStep label="StoryboardShot" detail="逐镜 renderMedia" />
        <ArrowRight className="h-3.5 w-3.5 text-info/70" />
        <RemotionFlowStep label="单镜 MP4" detail="每镜独立输出" />
      </div>
      <div className="grid grid-cols-4 gap-2 rounded-md border border-info/25 bg-info/20/[0.06] p-2 text-card-foreground">
        <RemotionSummaryCell label="分镜" value={`${summary?.total ?? shots.length}`} />
        <RemotionSummaryCell label="已完成" value={`${summary?.succeeded ?? 0}`} tone="success" />
        <RemotionSummaryCell label="进行中" value={`${(summary?.running ?? 0) + (summary?.queued ?? 0)}`} tone="active" />
        <RemotionSummaryCell label="阻塞/失败" value={`${(summary?.blocked ?? 0) + (summary?.failed ?? 0)}`} tone="warning" />
      </div>
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-info/80">
          <Gauge className="h-3.5 w-3.5" />
          Remotion · StoryboardShot · 并发 1
        </span>
        <span>{summary?.chapterReady ? "全部单镜 MP4 已就绪，可进入原生 Studio" : "全部单镜成功后才可进入原生 Studio"}</span>
      </div>
      {shots.length ? (
        <div className="grid grid-cols-2 gap-2">
          {shots.map((shot) => (
          <div
            key={shot.shotId}
            className={cn(
              "min-w-0 rounded-md border border-border bg-card p-2.5 text-card-foreground",
              shot.status === "running" && "border-primary/45",
              shot.status === "succeeded" && "border-success/35",
              (shot.status === "failed" || shot.status === "blocked" || shot.status === "canceled") && "border-viz-glow/45",
            )}
            data-remotion-shot-id={shot.shotId}
            data-remotion-shot-status={shot.status}
          >
            <div className="flex gap-2">
              <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded border border-border/70 bg-muted/30">
                {shot.mediaPath ? (
                  <img src={toPreviewSrc(shot.mediaPath)} alt={shot.title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[9px] text-muted-foreground">无首帧</div>
                )}
                <span className="absolute left-1 top-1 rounded bg-background/85 px-1 text-[9px] font-semibold text-foreground">
                  S{String(shot.index).padStart(2, "0")}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-[10px] font-medium">{shot.title}</span>
                  <RemotionStatusIcon status={shot.status} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                  <span>{remotionStatusLabel(shot.status)}</span>
                  <span className="tabular-nums">{Math.round(shot.progress * 100)}%</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width]",
                      shot.status === "failed" || shot.status === "blocked" ? "bg-viz-glow" : "bg-info/20",
                    )}
                    style={{ width: `${Math.max(0, Math.min(1, shot.progress)) * 100}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="mt-2 truncate text-[9px] text-muted-foreground" title={shot.outputPath ?? shot.error}>
              {shot.error ? `失败：${shot.error}` : shot.outputPath ? `MP4 · ${basename(shot.outputPath)}` : shot.jobId ? `Job · ${shot.jobId}` : "等待提交 Remotion job"}
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
              <span className="rounded border border-border px-1.5 py-0.5">修订 {shot.revision ?? 1}</span>
              <span className={cn("rounded border px-1.5 py-0.5", shot.ttsStatus === "ready" ? "border-success/35 text-success/80" : "border-viz-glow/35 text-warning/80")}>
                TTS {shot.ttsStatus === "ready" ? "已就绪" : shot.ttsStatus === "pending" ? "待生成" : shot.ttsStatus === "failed" ? "失败" : "缺失"}
              </span>
              <span className="rounded border border-border px-1.5 py-0.5">音频绑定 {shot.shotAudioBindingCount ?? 0}</span>
              <span className="rounded border border-border px-1.5 py-0.5" title={shot.ttsInputFingerprint ?? "未生成 TTS 指纹"}>
                TTS 指纹 {shortFingerprint(shot.ttsInputFingerprint)}
              </span>
              <span className="rounded border border-border px-1.5 py-0.5" title={shot.bindingFingerprints?.join("\n") ?? "未生成音频绑定指纹"}>
                绑定指纹 {shortFingerprint(shot.bindingFingerprints?.[0])}
              </span>
              <span className={cn("rounded border px-1.5 py-0.5", shot.sfxStatus === "ready" ? "border-success/35 text-success/80" : "border-border text-muted-foreground")}>
                SFX {shot.sfxStatus === "ready" ? "已就绪" : "未引用"}
              </span>
              <span className={cn("rounded border px-1.5 py-0.5", shot.chapterSharedAudioReferenced ? "border-primary/35 text-primary/80" : "border-border text-muted-foreground")}>
                章级 BGM/环境 {shot.chapterSharedAudioReferenced ? "仅引用" : "未配置"}
              </span>
              {shot.duplicateMixRisk ? <span className="rounded border border-destructive/45 px-1.5 py-0.5 text-destructive/80">重复混音风险</span> : null}
            </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-card/70 px-3 py-6 text-center text-[10px] text-muted-foreground">
          分镜面板尚未提供当前章节的分镜物料；生成分镜后，这里会按顺序显示每个 Remotion shot job、进度和 MP4。
        </div>
      )}
      {summary?.error ? (
        <div className="rounded-md border border-viz-glow/35 bg-viz-glow/10 px-3 py-2 text-[10px] text-warning/80">
          队列读取失败：{summary.error}
        </div>
      ) : null}
    </div>
  );
}

function shortFingerprint(value: string | undefined) {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function RemotionFlowStep({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="min-w-0 rounded border border-info/15 bg-background/20 px-2 py-1.5">
      <div className="truncate font-semibold">{label}</div>
      <div className="mt-0.5 truncate text-[9px] text-info/80/65">{detail}</div>
    </div>
  );
}

function RemotionSummaryCell({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "active" | "warning";
}) {
  return (
    <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-0.5 text-[13px] font-semibold tabular-nums",
        tone === "success" && "text-success/80",
        tone === "active" && "text-info/80",
        tone === "warning" && "text-warning/80",
      )}>{value}</div>
    </div>
  );
}

function RemotionStatusIcon({ status }: { status: ProductionFlowRemotionShot["status"] }) {
  if (status === "succeeded") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />;
  if (status === "running" || status === "queued") return <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-info" />;
  if (status === "failed" || status === "blocked" || status === "canceled") return <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-viz-glow" />;
  return <CircleDot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function remotionStatusLabel(status: ProductionFlowRemotionShot["status"]) {
  return {
    pending: "待提交",
    ready: "待排队",
    queued: "排队中",
    running: "渲染中",
    succeeded: "已完成",
    failed: "失败",
    blocked: "阻塞",
    canceled: "已取消",
    stale: "需重渲",
  }[status];
}

function basename(value: string) {
  const normalized = value.split("\\").join("/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

function WorkbenchStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="min-w-0 rounded border border-border bg-muted/30 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 text-[12px] font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

export function toPreviewSrc(path: string) {
  if (/^(https?:|data:|blob:|file:|local-image:\/\/|project-file:\/\/)/.test(path)) return path;
  if (path.startsWith("/")) return `file://${encodeURI(path)}`;
  return path;
}
