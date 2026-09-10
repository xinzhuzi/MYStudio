import { useState } from "react";
import type { WorkflowReadiness } from "@/lib/studio/workflow-readiness";
import { OrbGotoSection, OrbStagesSection } from "@/components/features/orb-nav";

/** 悬浮球面板:待推进头(恒显)+「切换阶段」「前往」两个折叠分区
 * (09-10 终裁:两球功能一致、都展示全面——分区抽成 features/orb-nav 共享)。
 * 待推进头=工作流球专属摘要(进度环与阶段号的本体);分区默认收起,面板重开回默认。
 * 分镜面板入口刻意不在此列(2026-08-23 唯一入口裁定)。 */
export function StageReadinessPanel({
  readiness,
  activeStage,
  onStageChange,
  onClose,
}: {
  readiness: WorkflowReadiness;
  activeStage: string;
  onStageChange: (stageId: string) => void;
  onClose: () => void;
}) {
  const [stagesOpen, setStagesOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const currentStage =
    readiness.stages.find((stage) => stage.id === readiness.nextStageId) ??
    readiness.stages[0];

  return (
    <div className="flex max-h-[60vh] flex-col">
      <div className="px-1 pb-2">
        <p className="text-sm font-semibold text-foreground">
          待推进：{currentStage?.label ?? "工作流"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {readiness.nextActionLabel}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <OrbStagesSection
          readiness={readiness}
          activeStage={activeStage}
          onStageChange={onStageChange}
          onClose={onClose}
          open={stagesOpen}
          onToggle={() => setStagesOpen((open) => !open)}
        />
        <div className="mt-1" />
        <OrbGotoSection
          open={gotoOpen}
          onToggle={() => setGotoOpen((open) => !open)}
        />
      </div>
    </div>
  );
}
