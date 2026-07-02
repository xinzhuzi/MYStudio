import {
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Film,
  ImageOff,
  Layers3,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { cn } from "@/lib/utils";
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
  workbench: "max-h-[320px]",
} satisfies Record<ProductionFlowNodeId, string>;

export function TextPreview({ node }: { node: ProductionFlowNodeModel }) {
  return (
    <div
      className={cn(
        "workflow-node-markdown-preview nodrag nopan nowheel overflow-y-auto overscroll-contain pr-1 text-[11px] leading-5 text-zinc-400",
        node.id === "scriptPlan" &&
          "rounded border border-white/5 bg-black/15 px-2 py-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5",
        NODE_PREVIEW_CLASS[node.id],
      )}
    >
      <MdPreview
        className={cn(
          "md-editor-preview-transparent !bg-transparent text-zinc-300",
          "[&_.md-editor]:!bg-transparent [&_.md-editor-preview]:!bg-transparent [&_.md-editor-preview-wrapper]:!bg-transparent",
          "[&_.md-editor-preview]:!p-0 [&_.md-editor-preview]:text-[11px] [&_.md-editor-preview]:leading-5",
          "[&_.md-editor-preview_h1]:mb-2 [&_.md-editor-preview_h1]:text-base [&_.md-editor-preview_h1]:leading-6",
          "[&_.md-editor-preview_h2]:mb-1.5 [&_.md-editor-preview_h2]:text-sm [&_.md-editor-preview_h2]:leading-5",
          "[&_.md-editor-preview_h3]:mb-1 [&_.md-editor-preview_h3]:text-xs [&_.md-editor-preview_h3]:leading-5",
          "[&_.md-editor-preview_p]:my-1 [&_.md-editor-preview_li]:my-0.5",
          "[&_.md-editor-preview_table]:my-2 [&_.md-editor-preview_table]:text-[10px]",
          "[&_.md-editor-preview_pre]:my-2 [&_.md-editor-preview_pre]:max-w-full [&_.md-editor-preview_pre]:overflow-auto",
        )}
        modelValue={buildPreviewMarkdown(node)}
        theme="dark"
        language="zh-CN"
      />
    </div>
  );
}

function buildPreviewMarkdown(node: ProductionFlowNodeModel) {
  return node.previewLines.join("\n").trim() || "暂无内容";
}

export function AssetDerivationPreview({
  node,
}: {
  node: ProductionFlowNodeModel;
}) {
  const groups = node.assetGroups ?? [];
  if (!groups.length) return <TextPreview node={node} />;
  const summary = node.assetSummary;
  return (
    <div className="nodrag nopan nowheel max-h-[560px] space-y-4 overflow-y-auto overscroll-contain pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
      {summary ? (
        <div className="asset-derive-summary grid grid-cols-4 gap-2 rounded-md border border-white/10 bg-[#202120] p-2">
          <AssetSummaryCell label="预划" value={summary.planned} />
          <AssetSummaryCell label="已关联父资产" value={summary.linked} />
          <AssetSummaryCell label="已完成图片" value={summary.completed} />
          <AssetSummaryCell
            label="缺父资产"
            value={summary.missingParent}
            warn={summary.missingParent > 0}
          />
        </div>
      ) : null}
      {groups.map((group) => (
        <div
          key={group.source.id}
          className="grid grid-cols-[188px_34px_minmax(188px,1fr)] items-stretch gap-3"
        >
          <AssetFlowCard card={group.source} />
          <div className="flex items-center justify-center text-zinc-300">
            <ChevronRight className="h-6 w-6" />
          </div>
          {group.derived.length ? (
            <div className="grid grid-cols-2 gap-3">
              {group.derived.slice(0, 4).map((item) => (
                <AssetFlowCard key={item.id} card={item} />
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

export function AssetFlowCard({ card }: { card: ProductionFlowAssetCard }) {
  const status = card.generationState ?? (card.mediaPath ? "已完成" : "未生成");
  return (
    <div className="min-h-[214px] rounded-md border border-white/14 bg-[#202120] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex h-[112px] items-center justify-center overflow-hidden rounded bg-black/22">
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
          <PackageOpen className="h-9 w-9 text-zinc-600" />
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] text-zinc-500">
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
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 text-[9px] font-semibold",
            status === "已完成" &&
              "border-emerald-300/30 bg-emerald-300/12 text-emerald-200",
            status === "生成中" &&
              "border-sky-300/30 bg-sky-300/12 text-sky-200",
            status === "生成失败" &&
              "border-red-300/30 bg-red-300/12 text-red-200",
            status === "未生成" &&
              "border-white/10 bg-black/20 text-zinc-400",
          )}
        >
          {status}
        </span>
        {card.parentAssetId ? (
          <span className="max-w-full truncate rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[9px] text-zinc-500">
            parentAssetId: {card.parentAssetId}
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-1 text-[11px] font-medium text-zinc-300">
        {card.name}
      </p>
      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">
        {card.reason || card.note || "等待补充资产描述。"}
      </p>
      {card.prompt ? (
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">
          生成提示：{card.prompt}
        </p>
      ) : null}
    </div>
  );
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
        "min-w-0 rounded border border-white/10 bg-black/20 px-2 py-1.5",
        warn && "border-amber-300/35 bg-amber-300/10",
      )}
    >
      <div className="truncate text-[9px] text-zinc-500">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-[13px] font-semibold text-zinc-200",
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
    <div className="flex min-h-[214px] flex-col items-center justify-center rounded-md border border-white/14 bg-[#202120]/82 p-3 text-center">
      <ImageOff className="h-10 w-10 text-zinc-600" />
      <p className="mt-3 text-[11px] text-zinc-500">无衍生资产</p>
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
    <div className="nodrag nowheel max-h-[430px] overflow-auto overscroll-contain rounded border border-white/10">
      <div className="sticky top-0 z-10 grid min-w-[1920px] grid-cols-[44px_0.82fr_0.72fr_1.5fr_0.72fr_1.05fr_54px_0.62fr_0.72fr_1.35fr_0.82fr_0.95fr_0.72fr_1.2fr_0.82fr_0.9fr] bg-[#242624] text-[10px] font-medium text-zinc-300">
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
      <div className="divide-y divide-white/8">
        {rows.map((row) => (
          <div
            key={`${node.id}-row-${row.index}`}
            className="grid min-w-[1920px] grid-cols-[44px_0.82fr_0.72fr_1.5fr_0.72fr_1.05fr_54px_0.62fr_0.72fr_1.35fr_0.82fr_0.95fr_0.72fr_1.2fr_0.82fr_0.9fr] text-[10px] leading-4 text-zinc-400 odd:bg-white/[0.025]"
          >
            <span className="px-2 py-2 text-zinc-300">{row.index}</span>
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
}: {
  node: ProductionFlowNodeModel;
}) {
  const tiles = node.storyboardTiles ?? [];
  if (!tiles.length) return <TextPreview node={node} />;
  return (
    <div className="nodrag nowheel max-h-[320px] overflow-y-auto overscroll-contain pr-1">
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((tile) => (
          <div key={tile.id} className="min-w-0">
            <div className="relative aspect-video overflow-hidden rounded border border-white/10 bg-zinc-900">
              {tile.mediaPath ? (
                <img
                  src={toPreviewSrc(tile.mediaPath)}
                  alt={tile.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">
                  未生成
                </div>
              )}
              <span className="absolute left-1 top-1 rounded bg-emerald-400 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-950">
                S{String(tile.index).padStart(2, "0")}
              </span>
              <span className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-zinc-200">
                {tile.state}
              </span>
            </div>
            <p className="mt-1 line-clamp-1 text-[10px] text-zinc-400">
              {tile.title}
            </p>
            {tile.lines ? (
              <p className="line-clamp-1 text-[10px] text-zinc-500">
                {tile.lines}
              </p>
            ) : null}
          </div>
        ))}
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
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-white/10 bg-[#202120] px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            最终导出
          </div>
          <div className="mt-1 truncate text-[11px] text-zinc-300">
            {node.finalExportPath || "等待候选片段全部选中后导出"}
          </div>
        </div>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-black/25 px-2 text-[10px] font-medium text-zinc-300">
          {node.finalExportPath ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
          ) : (
            <CircleDot className="h-3.5 w-3.5 text-zinc-500" />
          )}
          {node.finalExportPath ? "READY" : "PENDING"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tracks.map((track, index) => (
          <div
            key={track.id}
            className="min-w-0 rounded-md border border-white/10 bg-[#1f201f] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-sky-300 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-950">
                    T{String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate text-[11px] font-medium text-zinc-200">
                    {track.id}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">
                  {track.prompt || track.reason || "等待生成视频提示词"}
                </p>
              </div>
              <span className="shrink-0 rounded border border-white/10 bg-black/25 px-1.5 py-0.5 text-[9px] uppercase text-zinc-400">
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
            <div className="mt-2 truncate rounded border border-white/10 bg-black/20 px-2 py-1.5 text-[10px] text-zinc-500">
              selectedVideoPath:{" "}
              <span className="text-zinc-300">
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
    <div className="min-w-0 rounded border border-white/10 bg-black/18 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] text-zinc-500">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 text-[12px] font-semibold text-zinc-200">
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
