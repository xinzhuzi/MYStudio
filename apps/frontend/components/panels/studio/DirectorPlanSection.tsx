// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { useStudioStore } from "@/stores/studio/studio-store";
import { buildStudioFlowData } from "@/lib/studio/studio-flow-data";

/**
 * 导演规划 markdown 展示(指针卡裁定后从画布移入阶段面板)。
 * 复用 studio-flow-data 的 formatScriptPlan 构建全量 markdown。
 */
export function DirectorPlanSection() {
  const state = useStudioStore();
  const flowData = buildStudioFlowData({
    agentWorkData: state.agentWorkData,
    entityExtractions: state.entityExtractions,
    scriptPlans: state.scriptPlans,
    storyboards: state.storyboards ?? [],
    productionTracks: state.productionTracks ?? [],
    videoCandidates: state.videoCandidates ?? [],
  });
  const markdown = flowData.scriptPlan?.trim();
  if (!markdown) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-border/70">
      <div className="border-b border-border/70 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">导演规划</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          场次、节奏、镜头策略和声音方向(从画布指针卡移入此面板)。
        </p>
      </div>
      <div className="max-h-[600px] overflow-y-auto p-4">
        <MdPreview
          modelValue={markdown}
          theme="dark"
          previewTheme="github"
          codeTheme="github"
          className="md-editor-preview-transparent !bg-transparent text-foreground"
          style={{ background: "transparent" }}
        />
      </div>
    </section>
  );
}
