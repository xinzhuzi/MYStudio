import { filterAutoEditingRunIds, filterCurrentEditingProjectIds } from "./editing-state-indexes";
import { EditingCommandHistory, createEditingHistory } from "@/lib/studio/editing/command-core";
import { validateAutoEditingRun, validateEditingProject } from "@/lib/studio/editing/validation";
import type { AutoEditingResult, AutoEditingRun, EditingProjectV1, EditingValidationIssue } from "@/types/editing";
import { EditingStore, PersistedEditingStoreState } from "./editing-store-types";

/**
 * 剪辑域 store 助手族——历史解析/自动剪辑提交校验/结果持久化/项目作用域收窄/校验 issue 工具。file-size-reduction zustand 专批拆出,体逐字保留。
 */
export function resolveProjectHistory(
  state: EditingStore,
  editingProjectId: string,
):
  | { success: true; history: EditingCommandHistory }
  | { success: false; issue: EditingValidationIssue } {
  const project = state.editingProjects[editingProjectId];
  if (!project || project.projectId !== state.activeProjectId) {
    return failure(
      issue(
        "editing.project.not_found",
        "$.editingProjectId",
        "当前应用项目中不存在该剪辑版本",
      ),
    );
  }
  return {
    success: true,
    history:
      state.historyByEditingProjectId[editingProjectId] ??
      createEditingHistory(project),
  };
}

export function validateAutoEditingCommit(
  state: EditingStore,
  result: AutoEditingResult,
  staleEditingProjectIds: string[],
  committedAt: number,
):
  | {
      success: true;
      project: EditingProjectV1;
      run: AutoEditingRun;
      staleProjects: EditingProjectV1[];
    }
  | { success: false; issue: EditingValidationIssue } {
  if (!Number.isSafeInteger(committedAt) || committedAt < 0) {
    return failure(
      issue(
        "editing.auto_commit.committed_at",
        "$.committedAt",
        "自动剪辑提交时间必须是非负安全整数",
      ),
    );
  }
  const projectValidation = validateEditingProject(result.project);
  if (!projectValidation.success) {
    return failure(
      projectValidation.issues[0] ??
        issue("editing.project.invalid", "$.project", "剪辑项目无效"),
    );
  }
  const runValidation = validateAutoEditingRun(result.run);
  if (!runValidation.success) {
    return failure(
      runValidation.issues[0] ??
        issue("editing.auto_run.invalid", "$.run", "自动剪辑运行无效"),
    );
  }
  const project = projectValidation.value;
  const run = runValidation.value;
  if (!state.activeProjectId || project.projectId !== state.activeProjectId) {
    return failure(
      issue(
        "editing.persistence.project_scope",
        "$.project.projectId",
        "剪辑项目不属于当前应用项目",
      ),
    );
  }
  if (
    run.stage !== "completed" ||
    run.projectId !== project.projectId ||
    run.episodeId !== project.episodeId ||
    run.sourceSnapshotHash !== project.sourceSnapshotHash ||
    run.editingProjectId !== project.id
  ) {
    return failure(
      issue(
        "editing.auto_commit.mismatch",
        "$",
        "自动剪辑运行与草案的项目、剧集、快照或版本不一致",
      ),
    );
  }
  const existing = state.editingProjects[project.id];
  if (
    existing?.manuallyEdited &&
    project.createdBy === "auto" &&
    !project.manuallyEdited
  ) {
    return failure(
      issue(
        "editing.project.manual_protected",
        "$.project.id",
        "自动草案不能原位覆盖已人工编辑的版本",
      ),
    );
  }

  const staleProjects: EditingProjectV1[] = [];
  for (const editingProjectId of [...new Set(staleEditingProjectIds)]) {
    if (editingProjectId === project.id) continue;
    const staleProject = state.editingProjects[editingProjectId];
    if (
      !staleProject ||
      staleProject.projectId !== state.activeProjectId ||
      staleProject.episodeId !== project.episodeId ||
      staleProject.createdBy !== "auto"
    ) {
      return failure(
        issue(
          "editing.auto_commit.stale_target",
          "$.staleEditingProjectIds",
          `不能标记无效或越界的旧自动草案: ${editingProjectId}`,
        ),
      );
    }
    const nextStaleProject: EditingProjectV1 = {
      ...staleProject,
      stale: true,
      staleReason: "source snapshot changed",
      updatedAt: committedAt,
    };
    const staleValidation = validateEditingProject(nextStaleProject);
    if (!staleValidation.success) {
      return failure(
        staleValidation.issues[0] ??
          issue(
            "editing.auto_commit.stale_invalid",
            "$.staleEditingProjectIds",
            "旧自动草案 stale 更新无效",
          ),
      );
    }
    staleProjects.push(staleValidation.value);
  }
  return { success: true, project, run, staleProjects };
}

export function persistHistoryResult(
  set: (
    partial:
      | Partial<EditingStore>
      | ((state: EditingStore) => Partial<EditingStore>),
  ) => void,
  editingProjectId: string,
  history: EditingCommandHistory,
) {
  set((state) => ({
    editingProjects: {
      ...state.editingProjects,
      [editingProjectId]: history.present,
    },
    historyByEditingProjectId: {
      ...state.historyByEditingProjectId,
      [editingProjectId]: history,
    },
  }));
}

export function scopeEditingStateToProject(
  state: EditingStore,
  projectId: string | null,
): Partial<EditingStore> {
  const scoped = scopePersistedEditingState(state, projectId);
  const editingProjectIds = new Set(Object.keys(scoped.editingProjects));
  return {
    ...scoped,
    historyByEditingProjectId: Object.fromEntries(
      Object.entries(state.historyByEditingProjectId).filter(([id]) =>
        editingProjectIds.has(id),
      ),
    ),
    autoEditingRuns: scoped.autoEditingRuns,
    autoEditingRunIdsByEpisode: scoped.autoEditingRunIdsByEpisode,
    timelineRenderRecordsByEditingProjectId:
      scoped.timelineRenderRecordsByEditingProjectId,
    persistenceWarnings:
      state.activeProjectId === projectId ? state.persistenceWarnings : [],
  };
}

export function scopePersistedEditingState(
  state: Pick<
    PersistedEditingStoreState,
    | "activeProjectId"
    | "editingProjects"
    | "currentEditingProjectIdByEpisode"
    | "autoEditingRuns"
    | "autoEditingRunIdsByEpisode"
    | "timelineRenderRecordsByEditingProjectId"
  >,
  projectId: string | null,
): PersistedEditingStoreState {
  const editingProjects = projectId
    ? Object.fromEntries(
        Object.entries(state.editingProjects).filter(
          ([, project]) => project.projectId === projectId,
        ),
      )
    : {};
  const autoEditingRuns = projectId
    ? Object.fromEntries(
        Object.entries(state.autoEditingRuns).filter(
          ([, run]) => run.projectId === projectId,
        ),
      )
    : {};
  const timelineRenderRecordsByEditingProjectId = projectId
    ? Object.fromEntries(
        Object.entries(
          state.timelineRenderRecordsByEditingProjectId,
        ).filter(([, record]) => record.projectId === projectId),
      )
    : {};
  return {
    activeProjectId: projectId,
    editingProjects,
    currentEditingProjectIdByEpisode: filterCurrentEditingProjectIds(
      state.currentEditingProjectIdByEpisode,
      editingProjects,
    ),
    autoEditingRuns,
    autoEditingRunIdsByEpisode: filterAutoEditingRunIds(
      state.autoEditingRunIdsByEpisode,
      autoEditingRuns,
    ),
    timelineRenderRecordsByEditingProjectId,
  };
}

export function appendUniqueIssues(
  existing: EditingValidationIssue[],
  additions: EditingValidationIssue[],
) {
  const issues = [...existing];
  const seen = new Set(
    issues.map((item) => `${item.code}\u0000${item.path}\u0000${item.message}`),
  );
  for (const item of additions) {
    const key = `${item.code}\u0000${item.path}\u0000${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(item);
  }
  return issues;
}

export function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function issue(
  code: string,
  path: string,
  message: string,
): EditingValidationIssue {
  return { code, path, message };
}

export function failure(issueValue: EditingValidationIssue) {
  return { success: false as const, issue: issueValue };
}
