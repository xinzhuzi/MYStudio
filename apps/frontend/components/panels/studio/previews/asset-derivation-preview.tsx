import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetImageWorkflowContext } from "@/types/studio";
import type {
  ProductionFlowAssetCard,
  ProductionFlowNodeModel,
} from "../workflow-node-model";
import { AssetFlowCard, EmptyDerivedAssetCard } from "./asset-flow-card";
import { TextPreview } from "./text-preview";

export function AssetDerivationPreview({
  node,
  onOpenAssetImageWorkflow,
  sourceStage = "storyboard",
  sourceStageLabel = "分镜视频生成",
}: {
  node: ProductionFlowNodeModel;
  onOpenAssetImageWorkflow?: (context: AssetImageWorkflowContext) => void;
  sourceStage?: string;
  sourceStageLabel?: string;
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
          <AssetFlowCard card={group.source} sourceStage={sourceStage} sourceStageLabel={sourceStageLabel} />
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
                  sourceStage={sourceStage}
                  sourceStageLabel={sourceStageLabel}
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
