import {
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Film,
  Image as ImageIcon,
  ImageOff,
  Layers3,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/theme-store";
import type {
  AssetImageWorkflowContext,
  ImageWorkflowOpenContext,
  ImageWorkflowTarget,
} from "@/types/studio";
import type {
  ProductionFlowAssetCard,
  ProductionFlowNodeId,
  ProductionFlowNodeModel,
} from "./workflow-node-model";

const NODE_PREVIEW_CLASS = {
  script: "max-h-[560px]",
  scriptPlan: "h-[520px]",
  assets: "max-h-[560px]",
  storyboardTable: "max-h-[430px]",
  storyboard: "max-h-[320px]",
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
                "nodrag nopan nowheel h-8 rounded px-2 text-[11px] font-medium transition-colors",
                selected
                  ? "bg-cyan-300 text-zinc-950"
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
        />
      ) : status === "生成中" ? (
        <RefreshCw className="h-8 w-8 animate-spin text-sky-300/70" />
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
          className="nodrag nopan nowheel flex h-[112px] w-full items-center justify-center overflow-hidden rounded border border-cyan-300/35 bg-muted/30 ring-offset-background hover:border-cyan-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2"
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
              ? "bg-orange-400 text-zinc-950"
              : "bg-emerald-400 text-zinc-950",
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
                  "border-sky-300/30 bg-sky-300/12 text-sky-200",
                status === "生成失败" &&
                  "border-red-300/30 bg-red-300/12 text-red-200",
                status === "未生成" &&
                  "border-border bg-muted/30 text-muted-foreground",
              )}
            >
              {status}
            </span>
          ) : null}
          {card.isDerived && !card.sourceImagePath ? (
            <span className="max-w-full truncate rounded border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 text-[9px] text-amber-200">
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
          className="nodrag nopan nowheel mt-2 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-cyan-300/35 bg-cyan-300/10 px-2 text-[10px] font-medium text-cyan-100 hover:bg-cyan-300/16"
          onClick={(event) => {
            event.stopPropagation();
            openImageWorkflow();
          }}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          进入图片工作流
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
        warn && "border-amber-300/35 bg-amber-300/10",
      )}
    >
      <div className="truncate text-[9px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-[13px] font-semibold text-foreground",
          warn && "text-amber-200",
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

export function StoryboardGridPreview({
  node,
  onOpenImageWorkflow,
}: {
  node: ProductionFlowNodeModel;
  onOpenImageWorkflow?: (context: ImageWorkflowOpenContext) => void;
}) {
  const tiles = node.storyboardTiles ?? [];
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
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                  未生成
                </div>
              )}
              <span className="absolute left-1 top-1 rounded bg-emerald-400 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-950">
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
                className="nodrag nopan nowheel relative block aspect-video w-full overflow-hidden rounded border border-cyan-300/35 bg-muted/30 text-left ring-offset-background hover:border-cyan-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2"
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
                className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-1 text-[10px] text-muted-foreground hover:border-sky-300/45 hover:text-foreground"
                onClick={openStoryboardImageWorkflow}
              >
                <ImageIcon className="h-3 w-3" />
                进入分镜图片工作流
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
  if (!tracks.length) return <TextPreview node={node} />;
  return (
    <div className="workbench-lane-preview nodrag nowheel max-h-[320px] space-y-3 overflow-y-auto overscroll-contain pr-1">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-card-foreground">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            最终导出
          </div>
          <div className="mt-1 truncate text-[11px] text-card-foreground">
            {node.finalExportPath || "等待候选片段全部选中后导出"}
          </div>
        </div>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 text-[10px] font-medium text-foreground">
          {node.finalExportPath ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
          ) : (
            <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {node.finalExportPath ? "READY" : "PENDING"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tracks.map((track, index) => (
          <div
            key={track.id}
            className="min-w-0 rounded-md border border-border bg-card p-2.5 text-card-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-sky-300 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-950">
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
      </div>
    </div>
  );
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
