// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// 内存 fileStorage mock:可断言持久化写入发生(范式照 storyboard-batch-session-store.test)
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
  sanitizeStoryboardH3VideoSession,
  useStoryboardH3VideoSessionStore,
  type StoryboardH3VideoSessionRecord,
} from "./storyboard-h3-video-session-store";

function record(partial: Partial<StoryboardH3VideoSessionRecord> = {}): StoryboardH3VideoSessionRecord {
  return {
    sessionId: "sb-h3-1",
    projectId: "proj",
    episodeId: "chapter-001",
    cursorShotIndex: 2,
    totalShots: 5,
    doneShotIds: ["shot-a"],
    failedShotIds: [],
    recipeId: "my-h3-i2v-31",
    tier: "480p",
    status: "running",
    updatedAt: 1,
    ...partial,
  };
}

beforeEach(() => {
  storage.clear();
  useStoryboardH3VideoSessionStore.setState({ session: null });
});

describe("sanitizeStoryboardH3VideoSession(持久化水合校验)", () => {
  it("合法记录通过并钳位非法游标;坏 id 清单滤除", () => {
    expect(sanitizeStoryboardH3VideoSession(record())).toEqual(record());
    expect(sanitizeStoryboardH3VideoSession(record({ cursorShotIndex: 0 }))?.cursorShotIndex).toBe(1);
    expect(sanitizeStoryboardH3VideoSession(record({ doneShotIds: ["a", 42, null] as unknown as string[] }))?.doneShotIds)
      .toEqual(["a"]);
  });

  it("坏形状(缺字段/坏档位/坏状态/非对象)一律回落 null 不炸水合", () => {
    for (const bad of [null, undefined, "x", 42, {}, { ...record(), tier: "720p" }, { ...record(), status: "finished" }]) {
      expect(sanitizeStoryboardH3VideoSession(bad)).toBeNull();
    }
  });
});

describe("reload 水合(1121 分镜锚修 B腿:legacy 键信封 + running→interrupted 归一)", () => {
  it("旧格式(裸 record 顶层键,无 session 包裹)load 后水合为现行 {session} 结构,种子字段逐字保留", async () => {
    storage.set("storyboard-h3-video-session", JSON.stringify({
      state: { ...record({ status: "interrupted" }) },
      version: 0,
    }));
    await useStoryboardH3VideoSessionStore.persist.rehydrate();
    expect(useStoryboardH3VideoSessionStore.getState().session).toEqual(
      record({ status: "interrupted" }),
    );
  });

  it("现行格式 status=running 水合归一 interrupted(既有范式钉住,续跑入口 status 门恒可达)", async () => {
    storage.set("storyboard-h3-video-session", JSON.stringify({
      state: { session: record({ status: "running" }) },
      version: 0,
    }));
    await useStoryboardH3VideoSessionStore.persist.rehydrate();
    expect(useStoryboardH3VideoSessionStore.getState().session).toEqual(
      record({ status: "interrupted" }),
    );
  });

  it("裸信封水合后下一次写盘即为现行格式({session} 包裹)", async () => {
    storage.set("storyboard-h3-video-session", JSON.stringify({
      state: { ...record({ status: "running" }) },
      version: 0,
    }));
    await useStoryboardH3VideoSessionStore.persist.rehydrate();
    useStoryboardH3VideoSessionStore.getState().advanceStoryboardH3VideoSession({
      cursorShotIndex: 3,
      doneShotIds: ["shot-a", "shot-b"],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const persisted = JSON.parse(storage.get("storyboard-h3-video-session") ?? "{}");
    // 写盘真源格式:state.session 包裹(partialize 投影);状态已归一 interrupted
    expect(persisted.state.session).toMatchObject({
      sessionId: "sb-h3-1",
      cursorShotIndex: 3,
      recipeId: "my-h3-i2v-31",
      status: "interrupted",
    });
  });

  it("现行格式 session:null 保持 null(不因 legacy 回退误造会话)", async () => {
    storage.set("storyboard-h3-video-session", JSON.stringify({
      state: { session: null },
      version: 0,
    }));
    await useStoryboardH3VideoSessionStore.persist.rehydrate();
    expect(useStoryboardH3VideoSessionStore.getState().session).toBeNull();
  });
});
