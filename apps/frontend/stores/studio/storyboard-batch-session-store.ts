/**
 * 分镜批量生图·会话持久化 store(09-15 P3 断点续跑):
 * 批量进行中把「镜号游标 + 进度计数」落盘(应用重启/面板重挂不丢),
 * 中断后重入由 use-storyboard-batch-generation 从游标镜继续——已完成镜
 * 按既有 mediaRef 幂等口径跳过(指纹命中),本 store 只保存游标与进度,
 * 不保存队列快照(重入时按当前分镜表现势重建)。
 *
 * 单会话槽:同一时刻至多一条记录;projectId+episodeId 不匹配的旧会话
 * 视为过期(hook 走全新批量并覆写)。
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { fileStorage } from "@/lib/storage/indexed-db-storage";

export type StoryboardBatchSessionStatus = "running" | "interrupted";

export interface StoryboardBatchSessionRecord {
  sessionId: string;
  projectId: string;
  episodeId: string;
  /** 镜号游标:下一个待处理镜的分镜序号(index);续跑=只排队 index ≥ 游标的镜。 */
  cursorShotIndex: number;
  totalFrames: number;
  doneFrames: number;
  failedFrames: number;
  status: StoryboardBatchSessionStatus;
  updatedAt: number;
}

interface StoryboardBatchSessionState {
  session: StoryboardBatchSessionRecord | null;
}

interface StoryboardBatchSessionActions {
  /** 开始(全新或续跑)批量:覆写旧会话,状态置 running。 */
  beginStoryboardBatchSession: (record: Omit<StoryboardBatchSessionRecord, "updatedAt">) => void;
  /** 逐镜推进游标与计数(仅会话存在时生效)。 */
  advanceStoryboardBatchSession: (update: {
    cursorShotIndex: number;
    totalFrames?: number;
    doneFrames: number;
    failedFrames: number;
  }) => void;
  /** 中断(用户停止/进程终止前最后一次落盘)。 */
  interruptStoryboardBatchSession: () => void;
  /** 自然完成:清空会话(无续跑价值)。 */
  clearStoryboardBatchSession: () => void;
}

export function createStoryboardBatchSessionId(): string {
  return `sb-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 持久化记录形状校验(坏记录回落 null,不炸水合)。 */
export function sanitizeStoryboardBatchSession(raw: unknown): StoryboardBatchSessionRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<StoryboardBatchSessionRecord>;
  if (
    typeof record.sessionId !== "string"
    || typeof record.projectId !== "string"
    || typeof record.episodeId !== "string"
    || typeof record.cursorShotIndex !== "number"
    || typeof record.totalFrames !== "number"
    || typeof record.doneFrames !== "number"
    || typeof record.failedFrames !== "number"
    || (record.status !== "running" && record.status !== "interrupted")
  ) {
    return null;
  }
  return {
    sessionId: record.sessionId,
    projectId: record.projectId,
    episodeId: record.episodeId,
    cursorShotIndex: Math.max(1, Math.floor(record.cursorShotIndex)),
    totalFrames: Math.max(0, Math.floor(record.totalFrames)),
    doneFrames: Math.max(0, Math.floor(record.doneFrames)),
    failedFrames: Math.max(0, Math.floor(record.failedFrames)),
    status: record.status,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

export const useStoryboardBatchSessionStore = create<
  StoryboardBatchSessionState & StoryboardBatchSessionActions
>()(
  persist(
    (set) => ({
      session: null,
      beginStoryboardBatchSession: (record) =>
        set({ session: { ...record, updatedAt: Date.now() } }),
      advanceStoryboardBatchSession: (update) =>
        set((state) => {
          if (!state.session) return state;
          return {
            session: {
              ...state.session,
              cursorShotIndex: Math.max(1, Math.floor(update.cursorShotIndex)),
              totalFrames: update.totalFrames ?? state.session.totalFrames,
              doneFrames: Math.max(0, Math.floor(update.doneFrames)),
              failedFrames: Math.max(0, Math.floor(update.failedFrames)),
              updatedAt: Date.now(),
            },
          };
        }),
      interruptStoryboardBatchSession: () =>
        set((state) => {
          if (!state.session || state.session.status === "interrupted") return state;
          return { session: { ...state.session, status: "interrupted", updatedAt: Date.now() } };
        }),
      clearStoryboardBatchSession: () => set({ session: null }),
    }),
    {
      name: "mystudio-storyboard-batch-session",
      storage: createJSONStorage(() => fileStorage),
      merge: (persisted, current) => ({
        ...current,
        session: sanitizeStoryboardBatchSession(
          (persisted as Partial<StoryboardBatchSessionState> | undefined)?.session,
        ),
      }),
    },
  ),
);
