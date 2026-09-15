// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// 内存 fileStorage mock:可断言持久化写入发生
const storage = new Map<string, string>();
vi.mock("@/lib/storage/indexed-db-storage", () => ({
  fileStorage: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
      return true;
    },
    removeItem: async (key: string) => {
      storage.delete(key);
      return true;
    },
  },
}));

import {
  sanitizeStoryboardBatchSession,
  useStoryboardBatchSessionStore,
  type StoryboardBatchSessionRecord,
} from "./storyboard-batch-session-store";

function record(partial: Partial<StoryboardBatchSessionRecord> = {}): StoryboardBatchSessionRecord {
  return {
    sessionId: "sb-batch-1",
    projectId: "proj",
    episodeId: "chapter-001",
    cursorShotIndex: 3,
    totalFrames: 10,
    doneFrames: 2,
    failedFrames: 0,
    status: "running",
    updatedAt: 1,
    ...partial,
  };
}

beforeEach(() => {
  storage.clear();
  useStoryboardBatchSessionStore.setState({ session: null });
});

describe("useStoryboardBatchSessionStore(断点续跑会话持久化)", () => {
  it("begin 覆写旧会话并落盘(镜像号游标);advance 仅会话存在时生效", async () => {
    const store = useStoryboardBatchSessionStore.getState();
    store.beginStoryboardBatchSession({ ...record(), sessionId: "a", cursorShotIndex: 5 });
    store.beginStoryboardBatchSession({ ...record(), sessionId: "b", cursorShotIndex: 7 });
    expect(useStoryboardBatchSessionStore.getState().session).toMatchObject({ sessionId: "b", cursorShotIndex: 7 });

    useStoryboardBatchSessionStore.getState().advanceStoryboardBatchSession({
      cursorShotIndex: 9,
      doneFrames: 4,
      failedFrames: 1,
    });
    expect(useStoryboardBatchSessionStore.getState().session).toMatchObject({
      cursorShotIndex: 9,
      doneFrames: 4,
      failedFrames: 1,
      status: "running",
    });

    // 持久化写入发生(zustand persist 异步 setItem)
    await new Promise((resolve) => setTimeout(resolve, 0));
    const persisted = JSON.parse(storage.get("mystudio-storyboard-batch-session") ?? "{}");
    expect(persisted.state.session).toMatchObject({ sessionId: "b", cursorShotIndex: 9 });

    // 清空后 advance 不再复活会话
    useStoryboardBatchSessionStore.getState().clearStoryboardBatchSession();
    expect(useStoryboardBatchSessionStore.getState().session).toBeNull();
    useStoryboardBatchSessionStore.getState().advanceStoryboardBatchSession({
      cursorShotIndex: 10,
      doneFrames: 5,
      failedFrames: 0,
    });
    expect(useStoryboardBatchSessionStore.getState().session).toBeNull();
  });

  it("interrupt 只置 interrupted 一次幂等;clear 置空", () => {
    useStoryboardBatchSessionStore.getState().beginStoryboardBatchSession(record());
    useStoryboardBatchSessionStore.getState().interruptStoryboardBatchSession();
    const interrupted = useStoryboardBatchSessionStore.getState().session!;
    expect(interrupted.status).toBe("interrupted");
    useStoryboardBatchSessionStore.getState().interruptStoryboardBatchSession();
    expect(useStoryboardBatchSessionStore.getState().session).toBe(interrupted);
    useStoryboardBatchSessionStore.getState().clearStoryboardBatchSession();
    expect(useStoryboardBatchSessionStore.getState().session).toBeNull();
  });
});

describe("sanitizeStoryboardBatchSession(持久化水合校验)", () => {
  it("合法记录通过并钳位非法游标", () => {
    expect(sanitizeStoryboardBatchSession(record())).toEqual(record());
    expect(sanitizeStoryboardBatchSession(record({ cursorShotIndex: 0 }))?.cursorShotIndex).toBe(1);
    expect(sanitizeStoryboardBatchSession(record({ doneFrames: -5 }))?.doneFrames).toBe(0);
  });

  it("坏形状(缺字段/坏状态/非对象)一律回落 null 不炸水合", () => {
    for (const bad of [null, undefined, "x", 42, {}, { ...record(), status: "finished" }, { ...record(), cursorShotIndex: "3" }]) {
      expect(sanitizeStoryboardBatchSession(bad)).toBeNull();
    }
  });
});
