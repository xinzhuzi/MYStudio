/**
 * 分镜 H3 视频批量·会话持久化 store(P2a 断点续跑;PRD §5.4):
 * 批量进行中把「镜号游标+完成/失败清单+recipe/档位」落盘(应用重启/面板重挂不丢),
 * 中断后重入只跑缺片镜——跳过上轮 failedShotIds(C4 裁定:失败镜修复后走镜级
 * force 重生成,续跑不自动重掷),已落 video 镜按 mediaRef 幂等口径跳过。
 *
 * 单会话槽:同一时刻至多一条记录;projectId+episodeId 不匹配的旧会话视为过期。
 * 范式照 storyboard-batch-session-store(09-15 P3),字段按 PRD §5.4 换视频口径。
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { fileStorage } from "@/lib/storage/indexed-db-storage";

export type StoryboardH3VideoSessionStatus = "running" | "interrupted";

export interface StoryboardH3VideoSessionRecord {
  sessionId: string;
  projectId: string;
  episodeId: string;
  /** 镜号游标:下一个待处理镜的分镜序号(index);续跑=只排队 index ≥ 游标的镜。 */
  cursorShotIndex: number;
  totalShots: number;
  doneShotIds: string[];
  failedShotIds: string[];
  recipeId: string;
  tier: "480p" | "960p";
  status: StoryboardH3VideoSessionStatus;
  updatedAt: number;
}

interface StoryboardH3VideoSessionState {
  session: StoryboardH3VideoSessionRecord | null;
}

interface StoryboardH3VideoSessionActions {
  beginStoryboardH3VideoSession: (record: Omit<StoryboardH3VideoSessionRecord, "updatedAt">) => void;
  advanceStoryboardH3VideoSession: (update: {
    cursorShotIndex: number;
    totalShots?: number;
    doneShotIds?: string[];
    failedShotIds?: string[];
  }) => void;
  interruptStoryboardH3VideoSession: () => void;
  clearStoryboardH3VideoSession: () => void;
}

export function createStoryboardH3VideoSessionId(): string {
  return `sb-h3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeShotIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

/** 持久化记录形状校验(坏记录回落 null,不炸水合)。 */
export function sanitizeStoryboardH3VideoSession(raw: unknown): StoryboardH3VideoSessionRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<StoryboardH3VideoSessionRecord>;
  if (
    typeof record.sessionId !== "string"
    || typeof record.projectId !== "string"
    || typeof record.episodeId !== "string"
    || typeof record.cursorShotIndex !== "number"
    || typeof record.totalShots !== "number"
    || typeof record.recipeId !== "string"
    || (record.tier !== "480p" && record.tier !== "960p")
    || (record.status !== "running" && record.status !== "interrupted")
  ) {
    return null;
  }
  return {
    sessionId: record.sessionId,
    projectId: record.projectId,
    episodeId: record.episodeId,
    cursorShotIndex: Math.max(1, Math.floor(record.cursorShotIndex)),
    totalShots: Math.max(0, Math.floor(record.totalShots)),
    doneShotIds: sanitizeShotIds(record.doneShotIds),
    failedShotIds: sanitizeShotIds(record.failedShotIds),
    recipeId: record.recipeId,
    tier: record.tier,
    status: record.status,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

export const useStoryboardH3VideoSessionStore = create<StoryboardH3VideoSessionState & StoryboardH3VideoSessionActions>()(
  persist(
    (set) => ({
      session: null,
      beginStoryboardH3VideoSession: (record) =>
        set({ session: { ...record, updatedAt: Date.now() } }),
      advanceStoryboardH3VideoSession: (update) =>
        set((state) => {
          if (!state.session) return state;
          return {
            session: {
              ...state.session,
              cursorShotIndex: update.cursorShotIndex,
              ...(update.totalShots !== undefined ? { totalShots: update.totalShots } : {}),
              ...(update.doneShotIds !== undefined ? { doneShotIds: update.doneShotIds } : {}),
              ...(update.failedShotIds !== undefined ? { failedShotIds: update.failedShotIds } : {}),
              updatedAt: Date.now(),
            },
          };
        }),
      interruptStoryboardH3VideoSession: () =>
        set((state) => (state.session ? { session: { ...state.session, status: "interrupted", updatedAt: Date.now() } } : state)),
      clearStoryboardH3VideoSession: () => set({ session: null }),
    }),
    {
      name: "storyboard-h3-video-session",
      storage: createJSONStorage(() => fileStorage),
      partialize: (state) => ({ session: state.session }),
      merge: (persisted, current) => {
        const raw = persisted as { session?: unknown } | undefined;
        const session = sanitizeStoryboardH3VideoSession(raw?.session);
        // 水合一律按可续跑处理(进程终止没机会落 interrupted;running 视同 interrupted)
        return { ...current, session: session ? { ...session, status: "interrupted" as const } : null };
      },
    },
  ),
);
