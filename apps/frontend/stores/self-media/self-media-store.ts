import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createProjectScopedStorage } from "@/lib/storage/project-storage";
import { validateSelfMediaDraft } from "@/lib/self-media/contracts";
import { decodeSelfMediaTaskRecord } from "@/lib/self-media/ipc-contract";
import type {
  SelfMediaAccount,
  SelfMediaDraft,
  SelfMediaHistoryRecord,
  SelfMediaTask,
} from "@/types/self-media";

export interface SelfMediaStore {
  activeProjectId: string | null;
  drafts: SelfMediaDraft[];
  tasks: SelfMediaTask[];
  history: SelfMediaHistoryRecord[];
  accounts: SelfMediaAccount[];
  setActiveProjectId: (projectId: string | null) => void;
  ensureProject: (projectId: string) => void;
  setAccounts: (accounts: SelfMediaAccount[]) => void;
  saveDraft: (draft: SelfMediaDraft) => void;
  removeDraft: (draftId: string) => void;
  upsertTask: (task: SelfMediaTask) => void;
  replaceProjectTasks: (projectId: string, tasks: SelfMediaTask[]) => void;
  addHistoryRecord: (record: SelfMediaHistoryRecord) => void;
  getActiveTasks: () => SelfMediaTask[];
  getActiveHistory: () => SelfMediaHistoryRecord[];
}

type PersistedSelfMediaState = Pick<
  SelfMediaStore,
  "activeProjectId" | "drafts" | "tasks" | "history"
>;

function isTerminalTaskStatus(status: SelfMediaTask["status"]): boolean {
  return ["success", "failure", "partial", "audit", "canceled", "expired-login"].includes(status);
}

function normalizeDraft(value: unknown): SelfMediaDraft | null {
  const validation = validateSelfMediaDraft(value);
  return validation.success ? validation.value : null;
}

function normalizeTask(value: unknown): SelfMediaTask | null {
  try {
    return decodeSelfMediaTaskRecord(value);
  } catch {
    return null;
  }
}

function normalizeHistoryRecord(value: unknown): SelfMediaHistoryRecord | null {
  if (!value || typeof value !== "object") return null;
  const { finishedAt, ...task } = value as Record<string, unknown>;
  if (finishedAt !== undefined && (typeof finishedAt !== "string" || !Number.isFinite(Date.parse(finishedAt)))) return null;
  const normalized = normalizeTask(task);
  if (!normalized || !isTerminalTaskStatus(normalized.status)) return null;
  return { ...normalized, finishedAt: typeof finishedAt === "string" ? finishedAt : normalized.updatedAt };
}

function partializeSelfMediaState(state: SelfMediaStore): PersistedSelfMediaState {
  const projectId = state.activeProjectId;
  return {
    activeProjectId: projectId,
    drafts: projectId ? state.drafts.filter((draft) => draft.projectId === projectId).flatMap((draft) => normalizeDraft(draft) ?? []) : [],
    tasks: projectId ? state.tasks.filter((task) => task.projectId === projectId).flatMap((task) => normalizeTask(task) ?? []) : [],
    history: projectId ? state.history.filter((record) => record.projectId === projectId).flatMap((record) => normalizeHistoryRecord(record) ?? []) : [],
  };
}

function mergeSelfMediaState(
  persisted: unknown,
  current: SelfMediaStore,
): SelfMediaStore {
  if (!persisted || typeof persisted !== "object") return current;
  const data = persisted as Partial<PersistedSelfMediaState>;
  const activeProjectId = typeof data.activeProjectId === "string" ? data.activeProjectId : current.activeProjectId;
  const drafts = Array.isArray(data.drafts) ? data.drafts.flatMap((draft) => normalizeDraft(draft) ?? []) : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks.flatMap((task) => normalizeTask(task) ?? []) : [];
  const history = Array.isArray(data.history) ? data.history.flatMap((record) => normalizeHistoryRecord(record) ?? []) : [];
  return {
    ...current,
    activeProjectId,
    drafts: activeProjectId ? drafts.filter((draft) => draft.projectId === activeProjectId) : [],
    tasks: activeProjectId ? tasks.filter((task) => task.projectId === activeProjectId) : [],
    history: activeProjectId ? history.filter((record) => record.projectId === activeProjectId) : [],
  };
}

export const useSelfMediaStore = create<SelfMediaStore>()(
  persist(
    (set, get) => ({
      activeProjectId: null,
      drafts: [],
      tasks: [],
      history: [],
      accounts: [],

      setActiveProjectId: (projectId) => set((state) => ({
        activeProjectId: projectId,
        drafts: projectId ? state.drafts.filter((item) => item.projectId === projectId) : [],
        tasks: projectId ? state.tasks.filter((item) => item.projectId === projectId) : [],
        history: projectId ? state.history.filter((item) => item.projectId === projectId) : [],
      })),

      ensureProject: (projectId) => {
        if (get().activeProjectId !== projectId) get().setActiveProjectId(projectId);
      },

      setAccounts: (accounts) => set({ accounts: accounts.map(({ ...account }) => account) }),

      saveDraft: (draft) => {
        const normalized = normalizeDraft(draft);
        if (!normalized) throw new Error("Self-media draft is invalid");
        const projectId = get().activeProjectId;
        if (!projectId || normalized.projectId !== projectId) {
          throw new Error("Self-media draft must belong to the active project");
        }
        set((state) => ({
          drafts: [...state.drafts.filter((item) => item.id !== normalized.id), normalized],
        }));
      },

      removeDraft: (draftId) => set((state) => ({ drafts: state.drafts.filter((draft) => draft.id !== draftId) })),

      upsertTask: (task) => {
        const normalized = normalizeTask(task);
        if (!normalized) throw new Error("Self-media task is invalid");
        const projectId = get().activeProjectId;
        if (!projectId || normalized.projectId !== projectId) {
          throw new Error("Self-media task must belong to the active project");
        }
        set((state) => ({
          tasks: [...state.tasks.filter((item) => item.id !== normalized.id), normalized],
          history: isTerminalTaskStatus(normalized.status)
            ? [...state.history.filter((item) => item.id !== normalized.id), { ...normalized, finishedAt: normalized.updatedAt }]
            : state.history,
        }));
      },

      replaceProjectTasks: (projectId, tasks) => {
        const normalized = tasks.map(normalizeTask);
        if (normalized.some((task) => task === null)) throw new Error("Self-media task list is invalid");
        const nextTasks = normalized as SelfMediaTask[];
        if (get().activeProjectId !== projectId || nextTasks.some((task) => task.projectId !== projectId)) {
          throw new Error("Self-media task list must belong to the active project");
        }
        const terminal = new Set<SelfMediaTask["status"]>([
          "success",
          "failure",
          "partial",
          "audit",
          "canceled",
          "expired-login",
        ]);
        set((state) => ({
          tasks: [...state.tasks.filter((task) => task.projectId !== projectId), ...nextTasks],
          history: [
            ...state.history.filter((record) => record.projectId !== projectId),
            ...nextTasks
              .filter((task) => terminal.has(task.status))
              .map((task) => ({ ...task, finishedAt: task.updatedAt })),
          ],
        }));
      },

      addHistoryRecord: (record) => {
        const normalized = normalizeHistoryRecord(record);
        if (!normalized) throw new Error("Self-media history is invalid");
        const projectId = get().activeProjectId;
        if (!projectId || normalized.projectId !== projectId) {
          throw new Error("Self-media history must belong to the active project");
        }
        set((state) => ({
          history: [...state.history.filter((item) => item.id !== normalized.id), normalized],
        }));
      },

      getActiveTasks: () => {
        const projectId = get().activeProjectId;
        return projectId ? get().tasks.filter((task) => task.projectId === projectId) : [];
      },

      getActiveHistory: () => {
        const projectId = get().activeProjectId;
        return projectId ? get().history.filter((record) => record.projectId === projectId) : [];
      },
    }),
    {
      name: "mystudio-self-media-store",
      storage: createJSONStorage(() => createProjectScopedStorage("self-media")),
      partialize: partializeSelfMediaState,
      merge: mergeSelfMediaState,
    },
  ),
);

export { mergeSelfMediaState, partializeSelfMediaState };
