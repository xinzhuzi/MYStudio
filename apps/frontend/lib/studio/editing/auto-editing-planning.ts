import type {
  AutoEditingRequest,
  AutoEditingWarning,
  EditingProjectV1,
} from "@/types/editing";
import type { BuildStoryboardEditingProjectInput } from "./storyboard-adapter";

type AutoEditingPlanningInput = {
  request: AutoEditingRequest;
  adapterInput: Pick<
    BuildStoryboardEditingProjectInput,
    "projectId" | "episodeId" | "sourceSnapshotHash"
  >;
  existingProjects: EditingProjectV1[];
  runId: string;
  editingProjectId: string;
};

export function validateInputScope(
  input: AutoEditingPlanningInput,
): AutoEditingWarning | null {
  if (
    input.request.projectId !== input.adapterInput.projectId ||
    input.request.episodeId !== input.adapterInput.episodeId
  ) {
    return warning("editing.auto.request_scope", "一键剪辑 request 与分镜输入的 project/episode 不一致", false);
  }
  if (!input.runId.trim() || !input.editingProjectId.trim()) {
    return warning("editing.auto.id_required", "一键剪辑 runId 和 editingProjectId 不能为空", false);
  }
  const preset = input.request.preset;
  if (
    preset.id !== "story-driven-v1" || preset.version !== 1 ||
    !positiveSafeInteger(preset.voiceTailPaddingUs) ||
    !positiveSafeInteger(preset.maxTransitionUs) ||
    !Number.isFinite(preset.maxTransitionRatio) || preset.maxTransitionRatio <= 0 || preset.maxTransitionRatio > 1 ||
    !Number.isFinite(preset.imageScaleFrom) || !Number.isFinite(preset.imageScaleTo) ||
    preset.imageScaleFrom <= 0 || preset.imageScaleTo <= 0
  ) return warning("editing.auto.preset_invalid", "story-driven-v1 preset 参数无效", false);
  return null;
}

export function findReusableDraft(input: AutoEditingPlanningInput): EditingProjectV1 | undefined {
  return [...input.existingProjects].filter((project) =>
    project.projectId === input.request.projectId && project.episodeId === input.request.episodeId &&
    project.createdBy === "auto" && !project.manuallyEdited && !project.stale &&
    project.sourceSnapshotHash === input.adapterInput.sourceSnapshotHash,
  ).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)).at(-1);
}

export function staleProjectIds(input: AutoEditingPlanningInput): string[] {
  return input.existingProjects.filter((project) =>
    project.projectId === input.request.projectId && project.episodeId === input.request.episodeId &&
    project.createdBy === "auto" && !project.stale &&
    project.sourceSnapshotHash !== input.adapterInput.sourceSnapshotHash,
  ).map((project) => project.id).sort();
}

function warning(code: string, message: string, recoverable: boolean): AutoEditingWarning {
  return { code, message, recoverable };
}
function positiveSafeInteger(value: number) { return Number.isSafeInteger(value) && value > 0; }
