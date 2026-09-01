/**
 * Run-task slice —— agent 运行与媒体任务的创建/完结/失败/取消/重试。
 * 08-31 file-size-reduction zustand 专批:自 studio-store 内联 action 族抽出,
 * 体逐字保留;沿用 material-slice 的 set/get 注入模式。
 */
import { createStudioWorkflowId } from "./studio-store-runtime";
import type {
  AgentWorkKey,
  MediaGenerationTask,
  MediaGenerationTaskKind,
  StudioAgentRun,
} from "@/types/studio";

type StartAgentRunInput = {
  key: AgentWorkKey;
  phase: string;
  inputSummary: string;
  inputFingerprint?: string;
  checkpointRef?: string;
  retryOf?: string;
};

type StartMediaTaskInput = {
  kind: MediaGenerationTaskKind;
  targetId: string;
  episodeId?: string;
  provider?: string;
  runId?: string;
  checkpointRef?: string;
  inputFingerprint?: string;
  retryOf?: string;
};

type TaskOutput = {
  outputRef?: string;
  outputRefs?: string[];
  checkpointRef?: string;
};

type RunTaskSliceStore = {
  agentRuns: StudioAgentRun[];
  mediaTasks: MediaGenerationTask[];
  startAgentRun: (input: StartAgentRunInput) => string;
  startMediaTask: (input: StartMediaTaskInput) => string;
  retryAgentRun: (id: string) => string | null;
  retryMediaTask: (id: string) => string | null;
};
type SetFn = (fn: (state: RunTaskSliceStore) => Partial<RunTaskSliceStore>) => void;
type GetFn = () => RunTaskSliceStore;

export function createRunTaskSliceActions(set: SetFn, get: GetFn) {
  return {
      startAgentRun: (input: StartAgentRunInput) => {
        const id = createStudioWorkflowId("run");
        const now = Date.now();
        const previous = input.retryOf ? get().agentRuns.find((run) => run.id === input.retryOf) : undefined;
        const run: StudioAgentRun = {
          id,
          key: input.key,
          phase: input.phase,
          status: "running",
          inputSummary: input.inputSummary,
          inputFingerprint: input.inputFingerprint,
          retryOf: input.retryOf,
          retryCount: previous ? (previous.retryCount ?? 0) + 1 : 0,
          checkpointRef: input.checkpointRef,
          startedAt: now,
        };
        set((state) => ({ agentRuns: [...state.agentRuns, run] }));
        return id;
      },

      finishAgentRun: (id: string, output: TaskOutput = {}) => {
        const now = Date.now();
        set((state) => ({
          agentRuns: state.agentRuns.map((run) =>
            run.id === id
              ? {
                  ...run,
                  ...output,
                  status: "success",
                  finishedAt: now,
                  errorReason: undefined,
                }
              : run,
          ),
        }));
      },

      failAgentRun: (id: string, errorReason: string, checkpointRef?: string) => {
        const now = Date.now();
        set((state) => ({
          agentRuns: state.agentRuns.map((run) =>
            run.id === id
              ? {
                  ...run,
                  status: "failed",
                  errorReason,
                  checkpointRef: checkpointRef ?? run.checkpointRef,
                  finishedAt: now,
                }
              : run,
          ),
        }));
      },

      cancelAgentRun: (id: string, errorReason = "Cancelled", checkpointRef?: string) => {
        const now = Date.now();
        set((state) => ({
          agentRuns: state.agentRuns.map((run) =>
            run.id === id
              ? {
                  ...run,
                  status: "canceled",
                  errorReason,
                  checkpointRef: checkpointRef ?? run.checkpointRef,
                  finishedAt: now,
                }
              : run,
          ),
        }));
      },

      retryAgentRun: (id: string) => {
        const previous = get().agentRuns.find((run) => run.id === id);
        if (!previous) return null;
        return get().startAgentRun({
          key: previous.key,
          phase: previous.phase,
          inputSummary: previous.inputSummary,
          inputFingerprint: previous.inputFingerprint,
          checkpointRef: previous.checkpointRef,
          retryOf: previous.id,
        });
      },

      startMediaTask: (input: StartMediaTaskInput) => {
        const id = createStudioWorkflowId("media-task");
        const now = Date.now();
        const previous = input.retryOf ? get().mediaTasks.find((task) => task.id === input.retryOf) : undefined;
        const task: MediaGenerationTask = {
          id,
          kind: input.kind,
          targetId: input.targetId,
          episodeId: input.episodeId,
          provider: input.provider,
          runId: input.runId,
          checkpointRef: input.checkpointRef,
          inputFingerprint: input.inputFingerprint,
          retryOf: input.retryOf,
          retryCount: previous ? (previous.retryCount ?? 0) + 1 : 0,
          status: "running",
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ mediaTasks: [...state.mediaTasks, task] }));
        return id;
      },

      finishMediaTask: (id: string, output: TaskOutput = {}) => {
        const now = Date.now();
        set((state) => ({
          mediaTasks: state.mediaTasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  ...output,
                  status: "success",
                  errorReason: undefined,
                  updatedAt: now,
                  finishedAt: now,
                }
              : task,
          ),
        }));
      },

      failMediaTask: (id: string, errorReason: string, checkpointRef?: string) => {
        const now = Date.now();
        set((state) => ({
          mediaTasks: state.mediaTasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  status: "failed",
                  errorReason,
                  checkpointRef: checkpointRef ?? task.checkpointRef,
                  updatedAt: now,
                  finishedAt: now,
                }
              : task,
          ),
        }));
      },

      cancelMediaTask: (id: string, errorReason = "Cancelled", checkpointRef?: string) => {
        const now = Date.now();
        set((state) => ({
          mediaTasks: state.mediaTasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  status: "canceled",
                  errorReason,
                  checkpointRef: checkpointRef ?? task.checkpointRef,
                  updatedAt: now,
                  finishedAt: now,
                }
              : task,
          ),
        }));
      },

      retryMediaTask: (id: string) => {
        const previous = get().mediaTasks.find((task) => task.id === id);
        if (!previous || previous.status !== "failed") return null;
        return get().startMediaTask({
          kind: previous.kind,
          targetId: previous.targetId,
          episodeId: previous.episodeId,
          provider: previous.provider,
          runId: previous.runId,
          checkpointRef: previous.checkpointRef,
          inputFingerprint: previous.inputFingerprint,
          retryOf: previous.id,
        });
      },

      retryFailedMediaTasks: (kind?: MediaGenerationTaskKind) =>
        get().mediaTasks
          .filter((task) => task.status === "failed" && (!kind || task.kind === kind))
          .map((task) => get().retryMediaTask(task.id))
          .filter((id): id is string => Boolean(id)),
  };
}
