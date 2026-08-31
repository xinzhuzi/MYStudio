import { create } from "zustand";

import {
  createEditingHistory,
  executeEditingHistory,
  redoEditingHistory,
  undoEditingHistory,
} from "@/lib/studio/editing/command-core";import { createJSONStorage, persist } from "zustand/middleware";
import { createProjectScopedStorage } from "@/lib/storage/project-storage";
import { validateAutoEditingRun, validateEditingProject, validateTimelineRenderRecord } from "@/lib/studio/editing/validation";
import { useProjectStore } from "@/stores/project/project-store";
import type { AutoEditingRun, EditingProjectV1, EditingValidationIssue, TimelineRenderRecord } from "@/types/editing";
import { appendEpisodeRecordId, filterAutoEditingRunIds, filterCurrentEditingProjectIds } from "./editing-state-indexes";
import { validateTimelineRecordProjectMatch } from "./editing-timeline-record-validation";
import { resolveProjectHistory, persistHistoryResult, scopeEditingStateToProject, scopePersistedEditingState, appendUniqueIssues, readOptionalString, isRecord, issue, failure, validateAutoEditingCommit } from "./editing-store-helpers";
import { EditingStore, PersistedEditingStoreState } from "./editing-store-types";

const createEditingStoreState: import("zustand").StateCreator<EditingStore> = (set, get) => ({
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

  const currentEditingProjectIdByEpisode = filterCurrentEditingProjectIds(
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



export type { CommitAutoEditingResult, EditingStore, PersistedEditingStoreState, SaveAutoEditingRunResult, SaveEditingProjectResult, SaveTimelineRenderRecordResult } from "./editing-store-types";
export { appendUniqueIssues, failure, isRecord, issue, persistHistoryResult, readOptionalString, resolveProjectHistory, scopeEditingStateToProject, scopePersistedEditingState, validateAutoEditingCommit } from "./editing-store-helpers";
