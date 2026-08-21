import { describe, expect, it } from "vitest";
import {
  buildRemotionProductionProfile,
  ensureRemotionWorkspace,
  legacyRemotionWorkspaceStorageKey,
  remotionWorkspaceStorageKey,
  syncRemotionWorkspaceProductionProfile,
  type RemotionWorkspaceRuntimeInfo,
} from "./remotion-workspace-storage";

const runtime: RemotionWorkspaceRuntimeInfo = {
  templateVersion: "1.0.0",
  remotionVersion: "4.0.499",
  bundleContentHash: "a".repeat(64),
  defaultRenderSettings: {
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    subtitleMode: "burn-in",
    loudnessLufs: -14,
    truePeakDbtp: -1.5,
  },
};

function memoryStorage(initial = new Map<string, string>()) {
  const writes: Array<[string, string]> = [];
  return {
    writes,
    storage: {
      getItem: async (key: string) => initial.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        writes.push([key, value]);
        initial.set(key, value);
      },
    },
  };
}

describe("Remotion workspace storage", () => {
  it("creates one project-scoped manifest without installing or rendering", async () => {
    const { storage, writes } = memoryStorage();
    const result = await ensureRemotionWorkspace("project-a", runtime, {
      storage,
      now: () => 123,
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.created).toBe(true);
      expect(result.manifest.projectId).toBe("project-a");
      expect(result.manifest.createdAt).toBe(123);
      expect(result.manifest.compositionIds).toEqual(["StoryboardShot", "ChapterVideo"]);
    }
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe(remotionWorkspaceStorageKey("project-a"));
  });

  it("stores only the Remotion-relevant production profile", async () => {
    const { storage, writes } = memoryStorage();
    const profile = buildRemotionProductionProfile({
      episodeDurationMin: 3,
      platformSpec: "16:9",
      visualManualId: "ink",
      directorManualId: "narrative",
      stylePositioning: "冷色水墨、低饱和",
    });
    const result = await ensureRemotionWorkspace("project-a", runtime, {
      storage,
      productionProfile: profile,
      now: () => 123,
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.manifest.productionProfile).toEqual(profile);
    expect(writes).toHaveLength(1);
  });

  it("updates the production profile without duplicating novel prose", async () => {
    const { storage } = memoryStorage();
    await ensureRemotionWorkspace("project-a", runtime, { storage, now: () => 123 });
    const profile = buildRemotionProductionProfile({
      episodeDurationMin: 3,
      platformSpec: "9:16",
      visualManualId: "ink",
      directorManualId: "narrative",
    });

    await expect(syncRemotionWorkspaceProductionProfile("project-a", profile, storage)).resolves.toBe("updated");
    const raw = await storage.getItem(remotionWorkspaceStorageKey("project-a"));
    expect(raw).toContain('"productionProfile"');
    expect(raw).not.toContain("小说简介");
  });

  it("is idempotent and never overwrites an existing valid workspace", async () => {
    const first = memoryStorage();
    const created = await ensureRemotionWorkspace("project-a", runtime, { storage: first.storage, now: () => 123 });
    expect(created.status).toBe("ready");
    const second = await ensureRemotionWorkspace("project-a", {
      ...runtime,
      bundleContentHash: "b".repeat(64),
    }, { storage: first.storage, now: () => 456 });

    expect(second.status).toBe("ready");
    if (second.status === "ready") {
      expect(second.created).toBe(false);
      expect(second.manifest.bundleContentHash).toBe("a".repeat(64));
    }
    expect(first.writes).toHaveLength(1);
  });

  it("keeps an invalid existing manifest blocked and does not replace it", async () => {
    const existing = new Map([[remotionWorkspaceStorageKey("project-a"), "{\"projectId\":\"project-b\"}"]]);
    const { storage, writes } = memoryStorage(existing);
    const result = await ensureRemotionWorkspace("project-a", runtime, { storage });

    expect(result).toMatchObject({ status: "blocked", code: "invalid-existing", retryable: true });
    expect(writes).toHaveLength(0);
    expect(existing.get(remotionWorkspaceStorageKey("project-a"))).toBe("{\"projectId\":\"project-b\"}");
  });

  it("returns a structured retryable block when persistence fails", async () => {
    const result = await ensureRemotionWorkspace("project-a", runtime, {
      storage: {
        getItem: async () => null,
        setItem: async () => { throw new Error("disk full"); },
      },
    });
    expect(result).toMatchObject({ status: "blocked", code: "storage-failure", retryable: true });
  });

  it("rejects unsafe project IDs before touching storage", async () => {
    const { storage, writes } = memoryStorage();
    const result = await ensureRemotionWorkspace("../project-a", runtime, { storage });
    expect(result).toMatchObject({ status: "blocked", code: "invalid-project-id", retryable: false });
    expect(writes).toHaveLength(0);
  });

  it("storage key carries no extension: resolveDataFilePath appends .json once", () => {
    expect(remotionWorkspaceStorageKey("project-a")).toBe("_p/project-a/remotion/project");
    expect(legacyRemotionWorkspaceStorageKey("project-a")).toBe("_p/project-a/remotion/project.json");
  });

  it("migrates a legacy double-suffix manifest into the canonical key on ensure", async () => {
    const legacyManifest = `{"schemaVersion":1,"projectId":"project-a","workspaceId":"workspace-project-a","templateId":"mystudio-remotion-v1","templateVersion":"1.0.0","remotionVersion":"4.0.499","bundleContentHash":"${"a".repeat(64)}","compositionIds":["StoryboardShot","ChapterVideo"],"defaultRenderSettings":${JSON.stringify(runtime.defaultRenderSettings)},"createdAt":1,"updatedAt":1}\n`;
    const legacy = new Map([[legacyRemotionWorkspaceStorageKey("project-a"), legacyManifest]]);
    const removed: string[] = [];
    const { storage, writes } = memoryStorage(legacy);
    const storageWithRemove = {
      ...storage,
      removeItem: async (key: string) => { removed.push(key); },
    };

    const result = await ensureRemotionWorkspace("project-a", runtime, {
      storage: storageWithRemove,
      now: () => 123,
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      // 旧 manifest 被沿用（created=false），不重建
      expect(result.created).toBe(false);
      expect(result.manifest.projectId).toBe("project-a");
      expect(result.manifest.createdAt).toBe(1);
    }
    // 迁移写入目标必须是新键，且旧键被删除
    expect(writes.map(([key]) => key)).toEqual([remotionWorkspaceStorageKey("project-a")]);
    expect(removed).toEqual([legacyRemotionWorkspaceStorageKey("project-a")]);
  });

  it("syncRemotionWorkspaceProductionProfile migrates the legacy key before updating", async () => {
    const legacy = new Map([[
      legacyRemotionWorkspaceStorageKey("project-a"),
      `{"schemaVersion":1,"projectId":"project-a","workspaceId":"workspace-project-a","templateId":"mystudio-remotion-v1","templateVersion":"1.0.0","remotionVersion":"4.0.499","bundleContentHash":"${"a".repeat(64)}","compositionIds":["StoryboardShot","ChapterVideo"],"defaultRenderSettings":${JSON.stringify(runtime.defaultRenderSettings)},"createdAt":1,"updatedAt":1}\n`,
    ]]);
    const { storage, writes } = memoryStorage(legacy);
    const profile = buildRemotionProductionProfile({ platformSpec: "16:9" });

    await expect(syncRemotionWorkspaceProductionProfile("project-a", profile, storage)).resolves.toBe("updated");
    // 第一次写=迁移到新键，第二次写=profile 更新落在新键
    expect(writes.map(([key]) => key)).toEqual([
      remotionWorkspaceStorageKey("project-a"),
      remotionWorkspaceStorageKey("project-a"),
    ]);
  });
});
