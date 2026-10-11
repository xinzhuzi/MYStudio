/**
 * 章验收卡·分镜面板顶部横幅(10-11 pipeline-human-node-automation 批5,
 * design §2.6/G10「双落位」之一;另一落位=任务中心 orb 终态收据):
 * - 有未绑/stale/失败项 → **常驻**横幅(状态可见处动作可达):资产失败→
 *   直达剧本资产管理页处理;stale/未绑 → 一键重跑章流水线(幂等续跑);
 * - 全绿(资产/衍生零失败+分镜全绑+零 stale) → 横幅消失;
 * - stale 口径取实况(批6 派生)与卡内快照的较大者——横幅是行动入口,
 *   禁止因快照时序漏报过期。
 */
import { CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  chapterAcceptanceAllGreen,
  type ChapterPipelineRunView,
} from "./chapter-pipeline";

export interface ChapterAcceptanceBannerProps {
  run?: ChapterPipelineRunView;
  /** 实况 stale 下游任务数(批6 派生;横幅禁用旧快照漏报)。 */
  staleCount?: number;
  onRunPipeline: () => void;
  onGoToAssets?: () => void;
}

export function ChapterAcceptanceBanner({
  run,
  staleCount = 0,
  onRunPipeline,
  onGoToAssets,
}: ChapterAcceptanceBannerProps) {
  if (run?.status === "running") {
    const doneSteps = run.steps.filter((step) => step.status !== "pending" && step.status !== "running").length;
    const current = run.steps.find((step) => step.status === "running");
    return (
      <div
        className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-panel/60 px-3 py-2 text-xs"
        data-chapter-acceptance-banner="running"
      >
        <span className="inline-flex items-center gap-1.5 text-info">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          章流水线进行中（{doneSteps}/3）
        </span>
        <span className="text-muted-foreground">
          {current ? `当前步骤：${current.label}` : "步骤间切换中"}
          {current?.note ? ` · ${current.note}` : ""}
        </span>
      </div>
    );
  }

  const card = run?.card;
  const stale = Math.max(card?.staleCount ?? 0, staleCount);
  if (card) {
    if (chapterAcceptanceAllGreen(card) && stale === 0) {
      // 全绿消失(G10);brief 收据由 orb 承担,面板不占位
      return null;
    }
    const assetFailed = card.assets.failed;
    const derivedFailed = card.derived.failed;
    const unbound = card.storyboard.unbound;
    const exceptions = card.storyboard.exceptions;
    const summaryParts = [
      `资产 ${card.assets.success}/${card.assets.total || 0}${assetFailed ? `（失 ${assetFailed}）` : ""}`,
      `衍生 ${card.derived.success}/${card.derived.total || 0}${derivedFailed ? `（失 ${derivedFailed}）` : ""}`,
      `分镜画面 ${card.storyboard.ready}/${card.storyboard.totalShots}${unbound ? `（未绑 ${unbound}）` : ""}`,
      exceptions ? `绑定例外 ${exceptions}` : null,
      stale ? `过期 ${stale}（剧本已变更）` : null,
    ].filter(Boolean);
    return (
      <div
        className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
        data-chapter-acceptance-banner="actionable"
        role="status"
      >
        <span className="inline-flex min-w-0 flex-1 items-start gap-1.5">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0">
            <span className="font-medium text-foreground">章验收未全绿：</span>
            <span className="text-muted-foreground">{summaryParts.join(" · ")}</span>
            {stale ? (
              <span className="mt-0.5 block text-warning">{`剧本已变更，${stale} 项产物基于旧剧本，请重跑后验收（禁静默沿用）`}</span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          {assetFailed > 0 && onGoToAssets ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-acceptance-go-assets
              onClick={onGoToAssets}
              title="直达剧本资产管理页的失败清单处理"
            >
              资产失败 {assetFailed}·去处理
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-acceptance-run-pipeline
            onClick={onRunPipeline}
            title="串 资产生成→衍生闭环→分镜绑定；已成产物幂等跳过，从断点续跑"
          >
            重跑章流水线
          </Button>
        </span>
      </div>
    );
  }

  if (stale > 0) {
    return (
      <div
        className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
        data-chapter-acceptance-banner="stale-only"
        role="status"
      >
        <span className="inline-flex items-center gap-1.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          <span className="text-foreground">{`剧本已变更：${stale} 项下游产物已过期，禁静默沿用`}</span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-acceptance-run-pipeline
          onClick={onRunPipeline}
        >
          重跑章流水线
        </Button>
      </div>
    );
  }

  return null;
}

/** 全绿时可选的轻收据行(挂载点可用可不用;全绿=横幅消失口径的对外只读判定)。 */
export function ChapterAcceptanceGreenNote({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-success"
      data-chapter-acceptance-green
    >
      <CircleCheck className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}
