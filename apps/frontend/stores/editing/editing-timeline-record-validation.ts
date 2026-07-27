import type {
  EditingProjectV1,
  EditingValidationIssue,
  TimelineRenderRecord,
} from "@/types/editing";

export function validateTimelineRecordProjectMatch(
  activeProjectId: string | null,
  project: EditingProjectV1 | undefined,
  record: TimelineRenderRecord,
  requireCurrentRevision: boolean,
): EditingValidationIssue | undefined {
  if (!activeProjectId || record.projectId !== activeProjectId) {
    return {
      code: "editing.persistence.render_record_scope",
      path: "$.projectId",
      message: "时间线渲染记录不属于当前应用项目",
    };
  }
  if (!project) {
    return {
      code: "editing.persistence.render_record_project",
      path: "$.editingProjectId",
      message: "时间线渲染记录引用的剪辑项目不存在",
    };
  }
  if (
    project.projectId !== record.projectId
    || project.episodeId !== record.episodeId
    || project.sourceSnapshotHash !== record.sourceSnapshotHash
    || record.editingRevision > project.revision
    || (requireCurrentRevision && record.editingRevision !== project.revision)
  ) {
    return {
      code: "editing.persistence.render_record_mismatch",
      path: "$",
      message: "时间线渲染记录与剪辑项目、剧集、快照或版本不一致",
    };
  }
  return undefined;
}
