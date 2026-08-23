// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    getItem: vi.fn(async (key: string) => files.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      files.set(key, value);
      return true;
    }),
    removeItem: vi.fn(async (key: string) => {
      files.delete(key);
      return true;
    }),
  };
});

vi.mock("./indexed-db-storage", () => ({
  fileStorage: {
    getItem: hoisted.getItem,
    setItem: hoisted.setItem,
    removeItem: hoisted.removeItem,
  },
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: {
    getState: () => ({ activeProjectId: "proj-1", projects: [{ id: "proj-1" }] }),
    persist: { hasHydrated: () => true, onFinishHydration: () => () => undefined },
  },
}));

vi.mock("@/stores/app/app-settings-store", () => ({
  useAppSettingsStore: {
    getState: () => ({ resourceSharing: { shareCharacters: true, shareScenes: true, shareMedia: true } }),
  },
}));

import { createStudioWorkflowShardedStorage } from "./project-storage";

interface FileStorageBridgeForTest {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<boolean>;
  removeItem: (key: string) => Promise<boolean>;
  exists: (key: string) => Promise<boolean>;
  renameItem: (fromKey: string, toKey: string) => Promise<boolean>;
  listKeys: (prefix: string) => Promise<string[]>;
  listDirs: (prefix: string) => Promise<string[]>;
  removeDir: (prefix: string) => Promise<boolean>;
}

type ProjectFilesBridgeForTest = {
  writeText: (key: string, value: string) => Promise<unknown>;
  readText: (payload: { projectId: string; relativePath: string }) =>
    Promise<{ success?: boolean; text?: string } | null>;
};
type WindowWithBridge = {
  window?: { fileStorage?: FileStorageBridgeForTest; projectFiles?: ProjectFilesBridgeForTest };
};

function installWindowBridge() {
  (globalThis as unknown as WindowWithBridge).window = {
    projectFiles: {
      writeText: async (key: string, value: string) => {
        hoisted.files.set(key, value);
        return { success: true };
      },
      readText: async ({ projectId, relativePath }: { projectId: string; relativePath: string }) => {
        const text = hoisted.files.get(`_p/${projectId}/${relativePath}`) ?? null;
        return text === null ? null : { success: true, text };
      },
    },
    fileStorage: {
      getItem: hoisted.getItem,
      setItem: hoisted.setItem,
      removeItem: hoisted.removeItem,
      exists: async (key) => hoisted.files.has(key),
      renameItem: async (fromKey, toKey) => {
        if (!hoisted.files.has(fromKey) || hoisted.files.has(toKey)) return false;
        hoisted.files.set(toKey, hoisted.files.get(fromKey)!);
        hoisted.files.delete(fromKey);
        return true;
      },
      listKeys: async (prefix) =>
        [...hoisted.files.keys()]
          .filter((key) => key.startsWith(`${prefix}/`))
          .map((key) => key),
      listDirs: async () => [],
      removeDir: async () => true,
    },
  };
}

function buildPersistedValue() {
  return JSON.stringify({
    state: {
      novelChapters: [
        { id: "chapter-001", title: "第一章", sourceText: "正文".repeat(50) },
        { id: "chapter-002", title: "第二章", sourceText: "正文".repeat(50) },
      ],
      storyboards: [
        { id: "sb-1", episodeId: "chapter-001", index: 1, prompt: "镜头一" },
        { id: "sb-2", episodeId: "chapter-002", index: 2, prompt: "镜头二" },
      ],
      sourceBible: "# 原著圣经",
      workflowConfig: { autoAnalyzeEventsOnImport: false, episodeDurationMin: 3 },
      mediaTasks: [],
    },
    version: 10,
  });
}


/** 窗口化 v1 契约：读回=激活章全文 + 非激活章轻索引（无 sourceText）+ state.activeChapterId */
function windowedExpectation(envelope: { state: Record<string, unknown> }): Record<string, unknown> {
  const state = envelope.state as Record<string, unknown> & { novelChapters?: Array<Record<string, unknown>> };
  const chapters = (state.novelChapters ?? []).map((chapter) => {
    if (chapter.id === "chapter-001") return chapter;
    const { sourceText: _dropped, ...rest } = chapter;
    return rest;
  });
  // 章级域：只留激活章条目（chapter-002 的分镜/任务等不在窗口）
  const nextState: Record<string, unknown> = { ...state, novelChapters: chapters, activeChapterId: "chapter-001" };
  for (const [key, value] of Object.entries(state)) {
    if (key === "novelChapters" || !Array.isArray(value)) continue;
    const hasForeign = value.some((item) => (
      item && typeof item === "object"
      && ((item as Record<string, unknown>).episodeId === "chapter-002"
        || (item as Record<string, unknown>).chapterId === "chapter-002")
    ));
    if (hasForeign) {
      nextState[key] = value.filter((item) => !(
        item && typeof item === "object"
        && ((item as Record<string, unknown>).episodeId === "chapter-002"
          || (item as Record<string, unknown>).chapterId === "chapter-002")
      ));
    }
  }
  return { ...envelope, state: nextState };
}

describe("createStudioWorkflowShardedStorage", () => {
  let storage: ReturnType<typeof createStudioWorkflowShardedStorage>;

  beforeEach(() => {
    hoisted.files.clear();
    vi.clearAllMocks();
    installWindowBridge();
    storage = createStudioWorkflowShardedStorage("studio-workflow-store");
  });

  afterEach(() => {
    (globalThis as unknown as WindowWithBridge).window = undefined;
  });

  it("setItem shards the envelope, writes manifest last, and getItem merges back losslessly", async () => {
    const value = buildPersistedValue();
    await storage.setItem("studio-workflow-store", value);

    const manifestRaw = hoisted.files.get("_p/proj-1/studio-workflow/manifest");
    expect(manifestRaw).toBeTruthy();
    const manifest = JSON.parse(manifestRaw!) as { shards: string[]; version: number };
    expect(manifest.version).toBe(10);
    expect(manifest.shards.some((name) => name.startsWith("chapters/chapter-001/novel-chapters-001-"))).toBe(true);
    expect(manifest.shards.some((name) => name.startsWith("chapters/chapter-002/novel-chapters-001-"))).toBe(true);
    expect(manifest.shards.some((name) => name.startsWith("chapters/chapter-001/storyboards-001-"))).toBe(true);
    expect(manifest.shards.some((name) => name.startsWith("chapters/chapter-002/storyboards-001-"))).toBe(true);
    expect(manifest.shards.some((name) => name.startsWith("core-"))).toBe(true);
    for (const shardName of manifest.shards) {
      expect(hoisted.files.get(`_p/proj-1/studio-workflow/${shardName.replace(/\.json$/, "")}`)).toBeTruthy();
    }

    const restored = await storage.getItem("studio-workflow-store");
    expect(restored).toBeTruthy();
    expect(JSON.parse(restored!)).toEqual(windowedExpectation(JSON.parse(value)));
  });

  it("renames the legacy single file to .bak-sharded-* after a successful shard write (保留不删)", async () => {
    const legacyKey = "_p/proj-1/studio-workflow-store";
    hoisted.files.set(legacyKey, buildPersistedValue());

    await storage.setItem("studio-workflow-store", buildPersistedValue());

    expect(hoisted.files.has(legacyKey)).toBe(false);
    // 08-18 起：分片化改名备份落 backups/store/（IPC 侧自动补 .json 后缀）
    const bakKeys = [...hoisted.files.keys()].filter(
      (key) => key.startsWith(`_p/proj-1/backups/store/studio-workflow-store.bak-sharded-`),
    );
    expect(bakKeys).toHaveLength(1);
    // bak 内容未被删除
    expect(hoisted.files.get(bakKeys[0]!)).toBeTruthy();
  });

  it("falls back to the legacy project file when no manifest exists (MA 无损升级)", async () => {
    const value = buildPersistedValue();
    hoisted.files.set("_p/proj-1/studio-workflow-store", value);

    const restored = await storage.getItem("studio-workflow-store");
    expect(restored).toBe(value);
  });

  it("falls back to the root-level legacy key when the project has no store", async () => {
    hoisted.files.set("studio-workflow-store", buildPersistedValue());
    const restored = await storage.getItem("studio-workflow-store");
    expect(restored).toBe(hoisted.files.get("studio-workflow-store"));
  });

  it("falls back to the legacy single file when a manifested shard goes missing (不半合并)", async () => {
    const legacyValue = buildPersistedValue();
    hoisted.files.set("_p/proj-1/studio-workflow-store", legacyValue);

    await storage.setItem("studio-workflow-store", buildPersistedValue());
    // 模拟分片损坏：删掉一片（保留 manifest 与 legacy 兜底不存在 → 再造一个 legacy）
    hoisted.files.set("_p/proj-1/studio-workflow-store", legacyValue);
    const manifest = JSON.parse(hoisted.files.get("_p/proj-1/studio-workflow/manifest")!) as { shards: string[] };
    hoisted.files.delete(`_p/proj-1/studio-workflow/${manifest.shards[0]!.replace(/\.json$/, "")}`);

    const restored = await storage.getItem("studio-workflow-store");
    expect(restored).toBe(legacyValue);
  });

  it("cleans up orphan shards from a previous generation after the manifest swap", async () => {
    await storage.setItem("studio-workflow-store", buildPersistedValue());
    // 模拟上一代残留
    hoisted.files.set("_p/proj-1/studio-workflow/chapters/chapter-001/storyboards-0000dead", "{}");

    await storage.setItem("studio-workflow-store", buildPersistedValue());

    expect(hoisted.files.has("_p/proj-1/studio-workflow/chapters/chapter-001/storyboards-0000dead")).toBe(false);
    const manifest = JSON.parse(hoisted.files.get("_p/proj-1/studio-workflow/manifest")!) as { shards: string[] };
    const lingering = [...hoisted.files.keys()].filter(
      (key) => key.startsWith("_p/proj-1/studio-workflow/")
        && key !== "_p/proj-1/studio-workflow/manifest"
        && key !== "_p/proj-1/studio-workflow/README.md"
        && !manifest.shards.some((name) => key.endsWith(name.replace(/\.json$/, ""))),
    );
    expect(lingering).toEqual([]);
  });

  it("removeItem deletes shards, manifest, legacy project file, and the root key", async () => {
    await storage.setItem("studio-workflow-store", buildPersistedValue());
    hoisted.files.set("_p/proj-1/studio-workflow-store", buildPersistedValue());
    hoisted.files.set("studio-workflow-store", buildPersistedValue());

    await storage.removeItem("studio-workflow-store");

    const remaining = [...hoisted.files.keys()].filter(
      (key) => key.includes("studio-workflow") && !key.endsWith("/README.md") && key !== "_p/proj-1/README.md",
    );
    // 分片、manifest、项目级/根级旧键全清；.bak-sharded-* 备份与 README 模板守护件按铁律保留
    expect(remaining.every((key) => key.includes(".bak-sharded-"))).toBe(true);
    expect(hoisted.files.has("_p/proj-1/studio-workflow-store")).toBe(false);
    expect(hoisted.files.has("studio-workflow-store")).toBe(false);
    expect(hoisted.files.has("_p/proj-1/studio-workflow/manifest")).toBe(false);
  });

  it("falls back to the legacy single-file write when the payload cannot be planned", async () => {
    await storage.setItem("studio-workflow-store", "not-json");
    expect(hoisted.files.get("_p/proj-1/studio-workflow-store")).toBe("not-json");
    expect(hoisted.files.has("_p/proj-1/studio-workflow/manifest")).toBe(false);
  });

  it("skips rewriting unchanged shards on subsequent saves (增量写)", async () => {
    const value = buildPersistedValue();
    await storage.setItem("studio-workflow-store", value);
    const writesAfterFirst = hoisted.setItem.mock.calls.length;

    // 完全相同的值再保存 → 零分片/manifest 写入（逐片名+内容比对全部命中）
    await storage.setItem("studio-workflow-store", value);
    expect(hoisted.setItem.mock.calls.length).toBe(writesAfterFirst);

    // 只改第 1 章正文 → 仅该章新分片 + manifest；其他分片零重写
    const changed = JSON.parse(value) as {
      state: { novelChapters: Array<{ id: string; sourceText: string }> };
    };
    changed.state.novelChapters[0]!.sourceText = "正文被编辑";
    const changedValue = JSON.stringify(changed);
    await storage.setItem("studio-workflow-store", changedValue);
    const newWrites = hoisted.setItem.mock.calls
      .slice(writesAfterFirst)
      .map(([key]) => key as string);
    expect(newWrites.some((key) => key.includes("chapters/chapter-001/novel-chapters-"))).toBe(true);
    expect(newWrites).toContain("_p/proj-1/studio-workflow/manifest");
    // 未变化域零写入
    expect(newWrites.some((key) => key.includes("storyboards-"))).toBe(false);
    expect(newWrites.some((key) => key.includes("chapters/chapter-002/novel-chapters-"))).toBe(false);
    expect(newWrites.some((key) => key.includes("core-"))).toBe(false);
    // 数据无损：读回等于本次保存值
    const restored = await storage.getItem("studio-workflow-store");
    expect(JSON.parse(restored!)).toEqual(windowedExpectation(JSON.parse(changedValue)));
  });

  it("writes and repairs both READMEs via the text channel (项目根全目录 + 分片目录)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const rootTemplate = readFileSync(
      resolve(__dirname, "../../assets/docs/project/README.md"),
      "utf-8",
    );
    const shardTemplate = readFileSync(
      resolve(__dirname, "../../assets/docs/studio-workflow/README.md"),
      "utf-8",
    );

    const backupsTemplate = readFileSync(
      resolve(__dirname, "../../assets/docs/backups/README.md"),
      "utf-8",
    );
    await storage.setItem("studio-workflow-store", buildPersistedValue());
    expect(hoisted.files.get("_p/proj-1/README.md")).toBe(rootTemplate);
    expect(hoisted.files.get("_p/proj-1/studio-workflow/README.md")).toBe(shardTemplate);
    expect(hoisted.files.get("_p/proj-1/backups/README.md")).toBe(backupsTemplate);

    // 篡改两者 → 下次保存自动修复
    hoisted.files.set("_p/proj-1/README.md", "被手改");
    hoisted.files.set("_p/proj-1/studio-workflow/README.md", "被手改");
    await storage.setItem("studio-workflow-store", buildPersistedValue());
    expect(hoisted.files.get("_p/proj-1/README.md")).toBe(rootTemplate);
    expect(hoisted.files.get("_p/proj-1/studio-workflow/README.md")).toBe(shardTemplate);
    expect(hoisted.files.get("_p/proj-1/backups/README.md")).toBe(backupsTemplate);
  });

  it("CPU 增量：域复用生效 + 原地突变由周期全量自愈（fullSaveEvery）", async () => {
    const live: Record<string, unknown> = {
      novelChapters: [
        { id: "chapter-001", title: "第一章", sourceText: "正".repeat(100) },
        { id: "chapter-002", title: "第二章", sourceText: "文".repeat(100) },
      ],
      storyboards: [{ id: "sb-1", episodeId: "chapter-001", index: 1 }],
    };
    const incrementalStorage = createStudioWorkflowShardedStorage("studio-workflow-store", {
      getLiveState: () => live,
      fullSaveEvery: 3,
    });
    const value = () => JSON.stringify({ state: live, version: 10 });

    await incrementalStorage.setItem("studio-workflow-store", value());
    const chapterShard = [...hoisted.files.keys()].find((k) => k.includes("chapters/chapter-001/novel-chapters"))!;
    expect(hoisted.files.get(chapterShard)).toContain("第一章");

    // 原地突变（违反不可变约定）：引用没变 → 第 2 次保存仍复用旧分片（已知窗口）
    (live.novelChapters as Array<{ title: string }>)[0]!.title = "第一章被原地改";
    await incrementalStorage.setItem("studio-workflow-store", value());
    expect(hoisted.files.get([...hoisted.files.keys()].find((k) => k.includes("chapters/chapter-001/novel-chapters"))!)).not.toContain("第一章被原地改");

    // 第 3 次保存 = 周期全量自愈 → 内容纠正
    await incrementalStorage.setItem("studio-workflow-store", value());
    expect(hoisted.files.get([...hoisted.files.keys()].find((k) => k.includes("chapters/chapter-001/novel-chapters"))!)).toContain("第一章被原地改");
    // 读回无损
    const restored = await incrementalStorage.getItem("studio-workflow-store");
    expect(JSON.parse(restored!)).toEqual(windowedExpectation(JSON.parse(value())));
  });

  it("窗口化写：只含激活章的窗口保存保留归档章分片（归档抄录，不误删）", async () => {
    // 第一代：两章全量落盘
    const both = buildPersistedValue();
    await storage.setItem("studio-workflow-store", both);
    const manifest1 = JSON.parse(hoisted.files.get("_p/proj-1/studio-workflow/manifest")!) as { shards: string[]; chapterIndex?: unknown[] };
    expect(manifest1.shards.some((n) => n.startsWith("chapters/chapter-002/"))).toBe(true);

    // 第二代：窗口 state（只有 chapter-001 条目 + 两章轻索引，模拟切章后保存）
    const windowed = JSON.parse(both) as {
      state: {
        novelChapters: Array<Record<string, unknown>>;
        storyboards: Array<Record<string, unknown>>;
        activeChapterId?: string;
      };
    };
    windowed.state.activeChapterId = "chapter-001";
    windowed.state.novelChapters = windowed.state.novelChapters.map((c) => (
      c.id === "chapter-001" ? c : { id: c.id, title: c.title }
    ));
    windowed.state.storyboards = windowed.state.storyboards.filter((sb) => sb.episodeId === "chapter-001");
    await storage.setItem("studio-workflow-store", JSON.stringify(windowed));

    const manifest2 = JSON.parse(hoisted.files.get("_p/proj-1/studio-workflow/manifest")!) as {
      shards: string[]; chapterIndex?: Array<{ id: string }>; activeChapterId?: string;
    };
    // 归档章分片名保留
    expect(manifest2.shards.some((n) => n.startsWith("chapters/chapter-002/"))).toBe(true);
    // 文件仍在磁盘（孤儿清理未删）
    const kept = [...hoisted.files.keys()].some((k) => k.startsWith("_p/proj-1/studio-workflow/chapters/chapter-002/"));
    expect(kept).toBe(true);
    // 索引=两章全量视图 + 激活章
    expect(manifest2.chapterIndex?.map((e) => e.id).sort()).toEqual(["chapter-001", "chapter-002"]);
    expect(manifest2.activeChapterId).toBe("chapter-001");
    // 窗口读回：章 2 为轻索引（无正文）、章 1 全文在
    const restored = await storage.getItem("studio-workflow-store");
    const parsed = JSON.parse(restored!) as { state: { novelChapters: Array<Record<string, unknown>>; activeChapterId: string } };
    expect(parsed.state.activeChapterId).toBe("chapter-001");
    const ch1 = parsed.state.novelChapters.find((c) => c.id === "chapter-001")!;
    const ch2 = parsed.state.novelChapters.find((c) => c.id === "chapter-002")!;
    expect(typeof ch1.sourceText).toBe("string");
    expect("sourceText" in ch2).toBe(false);
  });

  it("空态覆写守卫：读链损坏（分片缺失）后的空工作区保存被拒；健康重置放行", async () => {
    const emptyValue = JSON.stringify({ state: { novelChapters: [], storyboards: [], mediaTasks: [] }, version: 10 });
    // 健康读链上的合法重置：空工作区保存放行（resetStudioWorkflow 流程）
    await storage.setItem("studio-workflow-store", buildPersistedValue());
    await storage.setItem("studio-workflow-store", emptyValue);

    // 损坏场景：重新铺数据 → 删除一片 → getItem 回退（hydrationDamaged 置位）→ 空保存被拒
    await storage.setItem("studio-workflow-store", buildPersistedValue());
    const manifest = JSON.parse(hoisted.files.get("_p/proj-1/studio-workflow/manifest")!) as { shards: string[] };
    hoisted.files.delete(`_p/proj-1/studio-workflow/${manifest.shards[0]!.replace(/\.json$/, "")}`);
    await storage.getItem("studio-workflow-store");
    await storage.setItem("studio-workflow-store", emptyValue);
    expect(hoisted.files.has("_p/proj-1/studio-workflow/manifest")).toBe(true);
  });

  it("reads an empty-state manifest (zero shards) as an empty envelope", async () => {
    hoisted.files.set(
      "_p/proj-1/studio-workflow/manifest",
      JSON.stringify({ layout: "studio-workflow-shards-v1", version: 10, shards: [] }),
    );
    const restored = await storage.getItem("studio-workflow-store");
    expect(JSON.parse(restored!)).toEqual({ state: {}, version: 10 });
  });

  it("isHydrated 守卫：水合未完成(isHydrated=false)时对非空磁盘分片库的保存被拒（T4 启动/切项目竞态）", async () => {
    // 铺非空分片库（正常实例，视为已水合）
    await storage.setItem("studio-workflow-store", buildPersistedValue());
    const manifestBefore = hoisted.files.get("_p/proj-1/studio-workflow/manifest");

    // 水合窗口内的盲保存（空态+误建 free 图形态）→ 拒写
    const racing = createStudioWorkflowShardedStorage("studio-workflow-store", {
      isHydrated: () => false,
    });
    const racingValue = JSON.stringify({
      state: {
        novelChapters: [],
        storyboards: [],
        mediaTasks: [],
        imageWorkflows: [{ id: "wf-free-1", target: { kind: "free" }, nodes: [], edges: [] }],
      },
      version: 10,
    });
    await racing.setItem("studio-workflow-store", racingValue);
    expect(hoisted.files.get("_p/proj-1/studio-workflow/manifest")).toBe(manifestBefore);

    // 水合完成后同一保存放行（守卫只拦窗口期）
    const settled = createStudioWorkflowShardedStorage("studio-workflow-store", {
      isHydrated: () => true,
    });
    await settled.setItem("studio-workflow-store", racingValue);
    const manifestAfter = JSON.parse(hoisted.files.get("_p/proj-1/studio-workflow/manifest")!) as {
      shards: string[];
    };
    expect(manifestAfter.shards.some((name) => name.startsWith("image-workflows"))).toBe(true);
  });

  it("isHydrated 守卫：磁盘为空（无 manifest）时未水合保存不拦——首装/新项目正常落盘", async () => {
    const fresh = createStudioWorkflowShardedStorage("studio-workflow-store", {
      isHydrated: () => false,
    });
    await fresh.setItem("studio-workflow-store", buildPersistedValue());
    expect(hoisted.files.has("_p/proj-1/studio-workflow/manifest")).toBe(true);
  });

  it("空态守卫扩展：保存值含分镜目标 imageWorkflow 不算空工作区（T4）——读链损坏后含分镜工作流的保存不被误拒", async () => {
    await storage.setItem("studio-workflow-store", buildPersistedValue());
    // 制造读链损坏（分片缺失 → hydrationDamaged 置位）
    const manifest = JSON.parse(hoisted.files.get("_p/proj-1/studio-workflow/manifest")!) as { shards: string[] };
    hoisted.files.delete(`_p/proj-1/studio-workflow/${manifest.shards[0]!.replace(/\.json$/, "")}`);
    await storage.getItem("studio-workflow-store");

    // 章节/分镜/任务为空但带分镜目标工作流 → 非空态，空态拒写守卫不触发（走正常分片写）
    const valueWithStoryboardWorkflow = JSON.stringify({
      state: {
        novelChapters: [],
        storyboards: [],
        mediaTasks: [],
        imageWorkflows: [
          { id: "wf-sb-1", target: { kind: "storyboard", id: "sb-1" }, nodes: [], edges: [] },
        ],
      },
      version: 10,
    });
    await storage.setItem("studio-workflow-store", valueWithStoryboardWorkflow);
    const manifestAfter = JSON.parse(hoisted.files.get("_p/proj-1/studio-workflow/manifest")!) as {
      shards: string[];
    };
    expect(manifestAfter.shards.some((name) => name.startsWith("image-workflows"))).toBe(true);
  });
});
