import { EditingCommand, EditingCommandHistory, EditingCommandResult } from "@/lib/studio/editing/command-core";
import type { AutoEditingResult, AutoEditingRun, EditingProjectV1, EditingValidationIssue, TimelineRenderRecord } from "@/types/editing";

/**
 * 剪辑域 store 契约——持久化形状/结果类型/EditingStore 接口。file-size-reduction zustand 专批拆出,体逐字保留。
 */
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

