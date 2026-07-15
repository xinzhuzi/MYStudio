import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createProjectScopedStorage } from "@/lib/project-storage";
import {
  createEditingHistory,
  executeEditingHistory,
  redoEditingHistory,
  undoEditingHistory,
  type EditingCommand,
  type EditingCommandHistory,
  type EditingCommandResult,
} from "@/lib/studio/editing/command-core";
import {
  validateAutoEditingRun,
  validateEditingProject,
  validateTimelineRenderRecord,
} from "@/lib/studio/editing/validation";
import { useProjectStore } from "@/stores/project-store";
import type {
  AutoEditingResult,
  AutoEditingRun,
  EditingProjectV1,
  TimelineRenderRecord,
  EditingValidationIssue,
} from "@/types/editing";

export interface PersistedEditingStoreState {
  activeProjectId: string | null;
  editingProjects: Record<string, EditingProjectV1>;
  currentEditingProjectIdByEpisode: Record<string, string>;
  autoEditingRuns: Record<string, AutoEditingRun>;
  autoEditingRunIdsByEpisode: Record<string, string[]>;
  timelineRenderRecordsByEditingProjectId: Record<string, TimelineRenderRecord>;
}

export type SaveEditingProjectResult =
  | { success: true; editingProjectId: string }
  | { success: false; issue: EditingValidationIssue };

export type SaveAutoEditingRunResult =
  | { success: true; runId: string }
  | { success: false; issue: EditingValidationIssue };

export type CommitAutoEditingResult =
  | { success: true; editingProjectId: string; runId: string }
  | { success: false; issue: EditingValidationIssue };

export type SaveTimelineRenderRecordResult =
  | { success: true; editingProjectId: string; jobId: string }
  | { success: false; issue: EditingValidationIssue };

export interface EditingStore extends PersistedEditingStoreState {
  historyByEditingProjectId: Record<string, EditingCommandHistory>;
  persistenceWarnings: EditingValidationIssue[];
  setActiveProjectId: (projectId: string | null) => void;
  saveEditingProject: (project: unknown) => SaveEditingProjectResult;
  saveAutoEditingRun: (run: unknown) => SaveAutoEditingRunResult;
  saveTimelineRenderRecord: (
    record: unknown,
  ) => SaveTimelineRenderRecordResult;
  commitAutoEditingResult: (
    result: AutoEditingResult,
    staleEditingProjectIds: string[],
    committedAt: number,
  ) => CommitAutoEditingResult;
  activateEditingProject: (
    editingProjectId: string,
  ) => SaveEditingProjectResult;
  getCurrentEditingProject: (
    episodeId: string,
  ) => EditingProjectV1 | undefined;
  executeCommand: (
    editingProjectId: string,
    command: EditingCommand,
  ) => EditingCommandResult;
  undo: (editingProjectId: string, issuedAt: number) => EditingCommandResult;
  redo: (editingProjectId: string, issuedAt: number) => EditingCommandResult;
}

const createEditingStoreState: StateCreator<EditingStore> = (set, get) => ({
  activeProjectId: null,
  editingProjects: {},
  currentEditingProjectIdByEpisode: {},
  autoEditingRuns: {},
  autoEditingRunIdsByEpisode: {},
  timelineRenderRecordsByEditingProjectId: {},
  historyByEditingProjectId: {},
  persistenceWarnings: [],

  setActiveProjectId: (projectId) => {
    set((state) => scopeEditingStateToProject(state, projectId));
  },

  saveEditingProject: (project) => {
    const validation = validateEditingProject(project);
    if (!validation.success) {
      return failure(
        validation.issues[0] ??
          issue(
            "editing.project.invalid",
            "$",
            "剪辑项目未通过持久化校验",
          ),
      );
    }

    const nextProject = validation.value;
    const state = get();
    if (!state.activeProjectId) {
      return failure(
        issue(
          "editing.project.no_active_project",
          "$.projectId",
          "保存剪辑项目前必须激活应用项目",
        ),
      );
    }
    if (nextProject.projectId !== state.activeProjectId) {
      return failure(
        issue(
          "editing.persistence.project_scope",
          "$.projectId",
          "剪辑项目不属于当前应用项目",
        ),
      );
    }

    const existing = state.editingProjects[nextProject.id];
    if (
      existing?.manuallyEdited &&
      nextProject.createdBy === "auto" &&
      !nextProject.manuallyEdited
    ) {
      return failure(
        issue(
          "editing.project.manual_protected",
          "$.id",
          "自动草案不能原位覆盖已人工编辑的版本",
        ),
      );
    }

    set((current) => ({
      editingProjects: {
        ...current.editingProjects,
        [nextProject.id]: nextProject,
      },
      currentEditingProjectIdByEpisode: {
        ...current.currentEditingProjectIdByEpisode,
        [nextProject.episodeId]: nextProject.id,
      },
      historyByEditingProjectId: {
        ...current.historyByEditingProjectId,
        [nextProject.id]: createEditingHistory(nextProject),
      },
    }));
    return { success: true, editingProjectId: nextProject.id };
  },

  saveAutoEditingRun: (run) => {
    const validation = validateAutoEditingRun(run);
    if (!validation.success) {
      return failure(
        validation.issues[0] ??
          issue(
            "editing.auto_run.invalid",
            "$",
            "自动剪辑运行未通过持久化校验",
          ),
      );
    }
    const nextRun = validation.value;
    const activeProjectId = get().activeProjectId;
    if (!activeProjectId || nextRun.projectId !== activeProjectId) {
      return failure(
        issue(
          "editing.persistence.auto_run_scope",
          "$.projectId",
          "自动剪辑运行不属于当前应用项目",
        ),
      );
    }
    set((state) => ({
      autoEditingRuns: {
        ...state.autoEditingRuns,
        [nextRun.id]: nextRun,
      },
      autoEditingRunIdsByEpisode: appendEpisodeRecordId(
        state.autoEditingRunIdsByEpisode,
        nextRun.episodeId,
        nextRun.id,
      ),
    }));
    return { success: true, runId: nextRun.id };
  },

  saveTimelineRenderRecord: (record) => {
    const validation = validateTimelineRenderRecord(record);
    if (!validation.success) {
      return failure(
        validation.issues[0] ??
          issue(
            "editing.render_record.invalid",
            "$",
            "时间线渲染记录未通过持久化校验",
          ),
      );
    }
    const nextRecord = validation.value;
    const state = get();
    const project = state.editingProjects[nextRecord.editingProjectId];
    const mismatch = validateTimelineRecordProjectMatch(
      state.activeProjectId,
      project,
      nextRecord,
      true,
    );
    if (mismatch) return failure(mismatch);
    set((current) => ({
      timelineRenderRecordsByEditingProjectId: {
        ...current.timelineRenderRecordsByEditingProjectId,
        [nextRecord.editingProjectId]: nextRecord,
      },
    }));
    return {
      success: true,
      editingProjectId: nextRecord.editingProjectId,
      jobId: nextRecord.evidence.jobId,
    };
  },

  commitAutoEditingResult: (
    result,
    staleEditingProjectIds,
    committedAt,
  ) => {
    const state = get();
    const commit = validateAutoEditingCommit(
      state,
      result,
      staleEditingProjectIds,
      committedAt,
    );
    if (!commit.success) return commit;

    set((current) => {
      const editingProjects = { ...current.editingProjects };
      for (const staleProject of commit.staleProjects) {
        editingProjects[staleProject.id] = staleProject;
      }
      editingProjects[commit.project.id] = commit.project;
      return {
        editingProjects,
        currentEditingProjectIdByEpisode: {
          ...current.currentEditingProjectIdByEpisode,
          [commit.project.episodeId]: commit.project.id,
        },
        autoEditingRuns: {
          ...current.autoEditingRuns,
          [commit.run.id]: commit.run,
        },
        autoEditingRunIdsByEpisode: appendEpisodeRecordId(
          current.autoEditingRunIdsByEpisode,
          commit.run.episodeId,
          commit.run.id,
        ),
        historyByEditingProjectId: {
          ...current.historyByEditingProjectId,
          [commit.project.id]:
            current.historyByEditingProjectId[commit.project.id] ??
            createEditingHistory(commit.project),
        },
      };
    });
    return {
      success: true,
      editingProjectId: commit.project.id,
      runId: commit.run.id,
    };
  },

  activateEditingProject: (editingProjectId) => {
    const state = get();
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
    set((current) => ({
      currentEditingProjectIdByEpisode: {
        ...current.currentEditingProjectIdByEpisode,
        [project.episodeId]: project.id,
      },
    }));
    return { success: true, editingProjectId: project.id };
  },

  getCurrentEditingProject: (episodeId) => {
    const state = get();
    const editingProjectId =
      state.currentEditingProjectIdByEpisode[episodeId];
    if (!editingProjectId) return undefined;
    const project = state.editingProjects[editingProjectId];
    return project?.projectId === state.activeProjectId ? project : undefined;
  },

  executeCommand: (editingProjectId, command) => {
    const resolved = resolveProjectHistory(get(), editingProjectId);
    if (!resolved.success) return resolved;
    const result = executeEditingHistory(resolved.history, command);
    if (!result.success) return result;
    persistHistoryResult(set, editingProjectId, result.history);
    return { success: true, project: result.history.present };
  },

  undo: (editingProjectId, issuedAt) => {
    const resolved = resolveProjectHistory(get(), editingProjectId);
    if (!resolved.success) return resolved;
    const result = undoEditingHistory(resolved.history, issuedAt);
    if (!result.success) return result;
    persistHistoryResult(set, editingProjectId, result.history);
    return { success: true, project: result.history.present };
  },

  redo: (editingProjectId, issuedAt) => {
    const resolved = resolveProjectHistory(get(), editingProjectId);
    if (!resolved.success) return resolved;
    const result = redoEditingHistory(resolved.history, issuedAt);
    if (!result.success) return result;
    persistHistoryResult(set, editingProjectId, result.history);
    return { success: true, project: result.history.present };
  },
});

export function createEditingStore() {
  return create<EditingStore>()(createEditingStoreState);
}

export function partializeEditingStoreState(
  state: EditingStore,
): PersistedEditingStoreState {
  const scoped = scopePersistedEditingState(state, state.activeProjectId);
  return {
    activeProjectId: scoped.activeProjectId,
    editingProjects: scoped.editingProjects,
    currentEditingProjectIdByEpisode:
      scoped.currentEditingProjectIdByEpisode,
    autoEditingRuns: scoped.autoEditingRuns,
    autoEditingRunIdsByEpisode: scoped.autoEditingRunIdsByEpisode,
    timelineRenderRecordsByEditingProjectId:
      scoped.timelineRenderRecordsByEditingProjectId,
  };
}

export function mergeEditingStoreState(
  persistedState: unknown,
  currentState: EditingStore,
): EditingStore {
  if (!isRecord(persistedState)) {
    return {
      ...currentState,
      persistenceWarnings: appendUniqueIssues(
        currentState.persistenceWarnings,
        [
          issue(
            "editing.persistence.state",
            "$",
            "持久化剪辑状态必须是对象",
          ),
        ],
      ),
    };
  }

  const routerProjectId = useProjectStore.getState().activeProjectId;
  const activeProjectId =
    routerProjectId ?? readOptionalString(persistedState.activeProjectId);
  const editingProjects: Record<string, EditingProjectV1> = {};
  const autoEditingRuns: Record<string, AutoEditingRun> = {};
  const timelineRenderRecordsByEditingProjectId: Record<
    string,
    TimelineRenderRecord
  > = {};
  const warnings: EditingValidationIssue[] = [];
  const persistedProjects = isRecord(persistedState.editingProjects)
    ? persistedState.editingProjects
    : {};

  for (const [editingProjectId, value] of Object.entries(persistedProjects)) {
    const validation = validateEditingProject(value);
    if (!validation.success) {
      warnings.push(...validation.issues);
      continue;
    }
    if (!activeProjectId || validation.value.projectId !== activeProjectId) {
      warnings.push(
        issue(
          "editing.persistence.project_scope",
          `$.editingProjects.${editingProjectId}.projectId`,
          "已拒绝不属于当前应用项目的剪辑版本",
        ),
      );
      continue;
    }
    if (validation.value.id !== editingProjectId) {
      warnings.push(
        issue(
          "editing.persistence.project_key",
          `$.editingProjects.${editingProjectId}.id`,
          "剪辑项目 ID 与持久化键不一致",
        ),
      );
      continue;
    }
    editingProjects[editingProjectId] = validation.value;
  }

  const persistedRuns = isRecord(persistedState.autoEditingRuns)
    ? persistedState.autoEditingRuns
    : {};
  for (const [runId, value] of Object.entries(persistedRuns)) {
    const validation = validateAutoEditingRun(value);
    if (!validation.success) {
      warnings.push(...validation.issues);
      continue;
    }
    if (!activeProjectId || validation.value.projectId !== activeProjectId) {
      warnings.push(
        issue(
          "editing.persistence.auto_run_scope",
          `$.autoEditingRuns.${runId}.projectId`,
          "已拒绝不属于当前应用项目的自动剪辑运行",
        ),
      );
      continue;
    }
    if (validation.value.id !== runId) {
      warnings.push(
        issue(
          "editing.persistence.auto_run_key",
          `$.autoEditingRuns.${runId}.id`,
          "自动剪辑运行 ID 与持久化键不一致",
        ),
      );
      continue;
    }
    autoEditingRuns[runId] = validation.value;
  }

  const persistedRenderRecords = isRecord(
    persistedState.timelineRenderRecordsByEditingProjectId,
  )
    ? persistedState.timelineRenderRecordsByEditingProjectId
    : {};
  for (const [editingProjectId, value] of Object.entries(
    persistedRenderRecords,
  )) {
    const validation = validateTimelineRenderRecord(value);
    if (!validation.success) {
      warnings.push(...validation.issues);
      continue;
    }
    const record = validation.value;
    if (record.editingProjectId !== editingProjectId) {
      warnings.push(
        issue(
          "editing.persistence.render_record_key",
          `$.timelineRenderRecordsByEditingProjectId.${editingProjectId}.editingProjectId`,
          "时间线渲染记录 ID 与持久化键不一致",
        ),
      );
      continue;
    }
    const mismatch = validateTimelineRecordProjectMatch(
      activeProjectId,
      editingProjects[editingProjectId],
      record,
      false,
    );
    if (mismatch) {
      warnings.push(mismatch);
      continue;
    }
    timelineRenderRecordsByEditingProjectId[editingProjectId] = record;
  }

  const currentEditingProjectIdByEpisode =
    filterCurrentEditingProjectIds(
      persistedState.currentEditingProjectIdByEpisode,
      editingProjects,
    );
  const autoEditingRunIdsByEpisode = filterAutoEditingRunIds(
    persistedState.autoEditingRunIdsByEpisode,
    autoEditingRuns,
  );

  return {
    ...currentState,
    activeProjectId,
    editingProjects,
    currentEditingProjectIdByEpisode,
    autoEditingRuns,
    autoEditingRunIdsByEpisode,
    timelineRenderRecordsByEditingProjectId,
    historyByEditingProjectId: {},
    persistenceWarnings: appendUniqueIssues(
      currentState.persistenceWarnings,
      warnings,
    ),
  };
}

export const useEditingStore = create<EditingStore>()(
  persist(createEditingStoreState, {
    name: "mystudio-editing-store",
    storage: createJSONStorage(() => createProjectScopedStorage("editing")),
    partialize: partializeEditingStoreState,
    merge: mergeEditingStoreState,
  }),
);

function resolveProjectHistory(
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

function validateAutoEditingCommit(
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

function persistHistoryResult(
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

function scopeEditingStateToProject(
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

function scopePersistedEditingState(
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

function validateTimelineRecordProjectMatch(
  activeProjectId: string | null,
  project: EditingProjectV1 | undefined,
  record: TimelineRenderRecord,
  requireCurrentRevision: boolean,
): EditingValidationIssue | undefined {
  if (!activeProjectId || record.projectId !== activeProjectId) {
    return issue(
      "editing.persistence.render_record_scope",
      "$.projectId",
      "时间线渲染记录不属于当前应用项目",
    );
  }
  if (!project) {
    return issue(
      "editing.persistence.render_record_project",
      "$.editingProjectId",
      "时间线渲染记录引用的剪辑项目不存在",
    );
  }
  if (
    project.projectId !== record.projectId ||
    project.episodeId !== record.episodeId ||
    project.sourceSnapshotHash !== record.sourceSnapshotHash ||
    record.editingRevision > project.revision ||
    (requireCurrentRevision && record.editingRevision !== project.revision)
  ) {
    return issue(
      "editing.persistence.render_record_mismatch",
      "$",
      "时间线渲染记录与剪辑项目、剧集、快照或版本不一致",
    );
  }
  return undefined;
}

function filterCurrentEditingProjectIds(
  value: unknown,
  editingProjects: Record<string, EditingProjectV1>,
): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([episodeId, editingProjectId]) => {
      if (typeof editingProjectId !== "string") return false;
      const project = editingProjects[editingProjectId];
      return project?.episodeId === episodeId;
    }),
  ) as Record<string, string>;
}

function filterAutoEditingRunIds(
  value: unknown,
  autoEditingRuns: Record<string, AutoEditingRun>,
): Record<string, string[]> {
  const indexed = new Set<string>();
  const result: Record<string, string[]> = {};
  if (isRecord(value)) {
    for (const [episodeId, runIds] of Object.entries(value)) {
      if (!Array.isArray(runIds)) continue;
      for (const runId of runIds) {
        if (typeof runId !== "string" || indexed.has(runId)) continue;
        const run = autoEditingRuns[runId];
        if (!run || run.episodeId !== episodeId) continue;
        (result[episodeId] ??= []).push(runId);
        indexed.add(runId);
      }
    }
  }
  for (const run of Object.values(autoEditingRuns).sort(
    (left, right) =>
      left.startedAt - right.startedAt || left.id.localeCompare(right.id),
  )) {
    if (indexed.has(run.id)) continue;
    (result[run.episodeId] ??= []).push(run.id);
    indexed.add(run.id);
  }
  return result;
}

function appendEpisodeRecordId(
  records: Record<string, string[]>,
  episodeId: string,
  recordId: string,
) {
  const existing = records[episodeId] ?? [];
  if (existing.includes(recordId)) return records;
  return { ...records, [episodeId]: [...existing, recordId] };
}

function appendUniqueIssues(
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

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  code: string,
  path: string,
  message: string,
): EditingValidationIssue {
  return { code, path, message };
}

function failure(issueValue: EditingValidationIssue) {
  return { success: false as const, issue: issueValue };
}
