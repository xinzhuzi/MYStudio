import type { EditingProjectV1 } from "@/types/editing";
import { validateEditingProject } from "./validation";
import type {
  EditingCommand,
  EditingCommandHistory,
  EditingCommandResult,
  EditingHistoryEntry,
  EditingHistoryResult,
} from "./command-core";

export type ApplyEditingCommand = (
  project: EditingProjectV1,
  command: EditingCommand,
) => EditingCommandResult;

export function createEditingHistory(
  project: EditingProjectV1,
  limit = 100,
): EditingCommandHistory {
  return {
    present: project,
    past: [],
    future: [],
    limit: isPositiveSafeInteger(limit) ? limit : 100,
  };
}

export function executeEditingHistory(
  history: EditingCommandHistory,
  command: EditingCommand,
  applyCommand: ApplyEditingCommand,
): EditingHistoryResult {
  const result = applyCommand(history.present, command);
  if (!result.success) return result;
  const entry: EditingHistoryEntry = {
    command,
    before: history.present,
    after: result.project,
  };
  return {
    success: true,
    history: {
      ...history,
      present: result.project,
      past: [...history.past, entry].slice(-history.limit),
      future: [],
    },
  };
}

export function undoEditingHistory(
  history: EditingCommandHistory,
  issuedAt: number,
): EditingHistoryResult {
  const entry = history.past[history.past.length - 1];
  if (!entry) {
    return {
      success: false,
      issue: { code: "editing.history.undo_empty", path: "$", message: "没有可撤销命令" },
    };
  }
  const present = restoreHistorySnapshot(entry.before, history.present, issuedAt);
  if (!present.success) return present;
  return {
    success: true,
    history: {
      ...history,
      present: present.project,
      past: history.past.slice(0, -1),
      future: [entry, ...history.future],
    },
  };
}

export function redoEditingHistory(
  history: EditingCommandHistory,
  issuedAt: number,
): EditingHistoryResult {
  const entry = history.future[0];
  if (!entry) {
    return {
      success: false,
      issue: { code: "editing.history.redo_empty", path: "$", message: "没有可重做命令" },
    };
  }
  const present = restoreHistorySnapshot(entry.after, history.present, issuedAt);
  if (!present.success) return present;
  return {
    success: true,
    history: {
      ...history,
      present: present.project,
      past: [...history.past, entry].slice(-history.limit),
      future: history.future.slice(1),
    },
  };
}

function restoreHistorySnapshot(
  snapshot: EditingProjectV1,
  current: EditingProjectV1,
  issuedAt: number,
): EditingCommandResult {
  if (!isNonNegativeSafeInteger(issuedAt)) {
    return failure("editing.command.issued_at", "$.issuedAt", "命令时间必须是非负安全整数");
  }
  const project: EditingProjectV1 = {
    ...snapshot,
    revision: current.revision + 1,
    manuallyEdited: true,
    updatedAt: issuedAt,
  };
  const validation = validateEditingProject(project);
  if (!validation.success) {
    return {
      success: false,
      issue: validation.issues[0] ?? {
        code: "editing.history.invalid_snapshot",
        path: "$",
        message: "历史快照无效",
      },
    };
  }
  return { success: true, project: validation.value };
}

function failure(
  code: string,
  path: string,
  message: string,
): EditingCommandResult {
  return { success: false, issue: { code, path, message } };
}

function isNonNegativeSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}
