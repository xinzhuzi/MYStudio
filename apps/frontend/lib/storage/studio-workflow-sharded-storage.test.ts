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
    expect(JSON.parse(restored!)).toEqual(JSON.parse(value));
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
    expect(JSON.parse(restored!)).toEqual(JSON.parse(changedValue));
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

  it("reads an empty-state manifest (zero shards) as an empty envelope", async () => {
    hoisted.files.set(
      "_p/proj-1/studio-workflow/manifest",
      JSON.stringify({ layout: "studio-workflow-shards-v1", version: 10, shards: [] }),
    );
    const restored = await storage.getItem("studio-workflow-store");
    expect(JSON.parse(restored!)).toEqual({ state: {}, version: 10 });
  });
});
