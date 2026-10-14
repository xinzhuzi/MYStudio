/**
 * 章验收卡·分镜面板顶部横幅(10-11 pipeline-human-node-automation 批5,
 * design §2.6/G10「双落位」之一;另一落位=任务中心 orb 终态收据):
 * - 有未绑/stale/失败项 → **常驻**横幅(状态可见处动作可达):资产失败→
 *   直达剧本资产管理页处理;stale/未绑 → 一键重跑章流水线(幂等续跑);
 * - 全绿(资产/衍生零失败+分镜全绑+零 stale+零分镜源过期) → 横幅消失;
 * - stale 口径取实况(批6 派生)与卡内快照的较大者——横幅是行动入口,
 *   禁止因快照时序漏报过期。
 * - 分镜源过期(staleSourceScriptCount,批6 D5 实况派生)只**阻止全绿消失**、
 *   不产生数据闸:琥珀软提示+同位重跑,软提示不硬拦(裁定④)。
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
  /** 分镜条目 sourceScript 落后现势剧本草稿的镜数(批6 D5 实况派生;缺省 0)。 */
  staleSourceScriptCount?: number;
  onRunPipeline: () => void;
  onGoToAssets?: () => void;
  /**
   * 分镜表再生成入口(D-5 修复回路,blocking 复审修):sourceScript 只在分镜表
   * 生成流盖章(useProductionPlanningActions 写侧),章流水线三步零 sourceScript
   * 写点——分镜源过期的修复动作必须指向能清此计数的入口,禁再发章流水线。
   */
  onRegenerateStoryboardTable?: () => void;
}

export function ChapterAcceptanceBanner({
  run,
  staleCount = 0,
  staleSourceScriptCount = 0,
  onRunPipeline,
  onGoToAssets,
  onRegenerateStoryboardTable,
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
    // 全绿消失闸扩一档(D-5):分镜源过期也阻止横幅消失,否则刚改完剧本的
    // 「全绿」假象会吞掉唯一行动入口。
    if (chapterAcceptanceAllGreen(card) && stale === 0 && staleSourceScriptCount === 0) {
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
      staleSourceScriptCount ? `分镜源过期 ${staleSourceScriptCount} 镜` : null,
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
            {staleSourceScriptCount ? (
              <span className="mt-0.5 block text-warning">{`${staleSourceScriptCount} 镜基于旧剧本（剧本已改写），重新生成分镜表可刷新`}</span>
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
          {staleSourceScriptCount > 0 && onRegenerateStoryboardTable ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-acceptance-regenerate-storyboard-table
              onClick={onRegenerateStoryboardTable}
              title="用现势剧本重生成导演分镜表(分镜源过期只有这一步能清账;章流水线不含分镜表生成)"
            >
              重新生成分镜表
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

  // 无卡且下游任务零 stale,但分镜条目本身基于旧剧本(D-5 source-stale 新态):
  // 琥珀软横幅,修复动作与标记同位,不硬拦。动作=分镜表再生成(sourceScript
  // 只在分镜表生成流盖章,章流水线清不了此计数,禁发章流水线=修复回路闭合)。
  if (staleSourceScriptCount > 0) {
    return (
      <div
        className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
        data-chapter-acceptance-banner="source-stale"
        role="status"
      >
        <span className="inline-flex items-center gap-1.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          <span className="text-foreground">{`${staleSourceScriptCount} 镜基于旧剧本（剧本已改写，重跑分镜表可刷新）`}</span>
        </span>
        {onRegenerateStoryboardTable ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-acceptance-regenerate-storyboard-table
            onClick={onRegenerateStoryboardTable}
            title="用现势剧本重生成导演分镜表(章流水线不含分镜表生成,清不了此标记)"
          >
            重新生成分镜表
          </Button>
        ) : null}
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
