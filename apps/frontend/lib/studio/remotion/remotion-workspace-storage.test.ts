import { describe, expect, it } from "vitest";
import {
  ensureRemotionWorkspace,
  remotionWorkspaceStorageKey,
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
});
