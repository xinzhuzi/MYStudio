import {
  ChevronRight,
  ImageOff,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
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
  workbench: "max-h-[220px]",
} satisfies Record<ProductionFlowNodeId, string>;

export function TextPreview({ node }: { node: ProductionFlowNodeModel }) {
  return (
    <div
      className={cn(
        "nodrag nopan nowheel space-y-1.5 overflow-y-auto overscroll-contain pr-1 text-[11px] leading-5 text-zinc-400",
        node.id === "scriptPlan" &&
          "rounded border border-white/5 bg-black/15 px-2 py-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5",
        NODE_PREVIEW_CLASS[node.id],
      )}
    >
      {node.previewLines.map((line, index) => (
        <p key={`${node.id}-${index}`} className="whitespace-pre-wrap break-words">
          {line}
        </p>
      ))}
    </div>
  );
}

export function AssetDerivationPreview({
  node,
}: {
  node: ProductionFlowNodeModel;
}) {
  const groups = node.assetGroups ?? [];
  if (!groups.length) return <TextPreview node={node} />;
  return (
    <div className="nodrag nopan nowheel max-h-[560px] space-y-4 overflow-y-auto overscroll-contain pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
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
        ) : card.state === "生成中" ? (
          <RefreshCw className="h-8 w-8 animate-spin text-sky-300/70" />
        ) : (
          <PackageOpen className="h-9 w-9 text-zinc-600" />
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] text-zinc-500">
          {card.typeLabel}
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
      <p className="mt-1 line-clamp-1 text-[11px] font-medium text-zinc-300">
        {card.name}
      </p>
      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">
        {card.reason || card.note || "等待补充资产描述。"}
      </p>
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

export function toPreviewSrc(path: string) {
  if (/^(https?:|data:|blob:|file:|local-image:\/\/)/.test(path)) return path;
  if (path.startsWith("/")) return `file://${encodeURI(path)}`;
  return path;
}
