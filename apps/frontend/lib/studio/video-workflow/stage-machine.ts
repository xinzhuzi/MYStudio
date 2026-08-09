import type { VideoWorkflowStage } from "@rendering/contracts/video-workflow";

export const VIDEO_WORKFLOW_STAGE_ORDER = [
  "preparing",
  "aligning",
  "editing",
  "previewing",
  "evaluating",
  "awaiting-review",
  "applying",
  "ready",
] as const satisfies readonly Exclude<VideoWorkflowStage, "blocked">[];

export type VideoWorkflowStageTransitionResult =
  | { success: true; stage: VideoWorkflowStage }
  | { success: false; stage: VideoWorkflowStage; code: "invalid-transition" | "already-blocked" | "invalid-resume"; message: string };

const nextStage = new Map<VideoWorkflowStage, VideoWorkflowStage>(
  VIDEO_WORKFLOW_STAGE_ORDER.slice(0, -1).map((stage, index) => [stage, VIDEO_WORKFLOW_STAGE_ORDER[index + 1]]),
);

export function transitionVideoWorkflowStage(
  current: VideoWorkflowStage,
  requested: VideoWorkflowStage,
): VideoWorkflowStageTransitionResult {
  if (requested === "blocked") {
    if (current === "blocked") {
      return { success: false, stage: current, code: "already-blocked", message: "当前章节已经 blocked，不能重复进入 blocked" };
    }
    return { success: true, stage: "blocked" };
  }
  if (current === "blocked") {
    return { success: false, stage: current, code: "invalid-transition", message: "blocked 必须通过 resumeVideoWorkflowStage 恢复" };
  }
  if (nextStage.get(current) === requested) return { success: true, stage: requested };
  return {
    success: false,
    stage: current,
    code: "invalid-transition",
    message: `${current} 只能进入 ${nextStage.get(current) ?? "终态"}`,
  };
}

export function resumeVideoWorkflowStage(
  failedStage: Exclude<VideoWorkflowStage, "blocked">,
): VideoWorkflowStageTransitionResult {
  if (failedStage === "ready") {
    return { success: false, stage: "blocked", code: "invalid-resume", message: "ready 不能作为失败恢复阶段" };
  }
  return { success: true, stage: failedStage };
}

export function blockVideoWorkflowStage(current: VideoWorkflowStage): VideoWorkflowStageTransitionResult {
  return transitionVideoWorkflowStage(current, "blocked");
}

export function isVideoWorkflowStageBefore(
  left: VideoWorkflowStage,
  right: VideoWorkflowStage,
): boolean {
  if (left === "blocked" || right === "blocked") return false;
  return VIDEO_WORKFLOW_STAGE_ORDER.indexOf(left) < VIDEO_WORKFLOW_STAGE_ORDER.indexOf(right);
}
