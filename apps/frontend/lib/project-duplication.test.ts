import { describe, expect, it } from "vitest";
import {
  buildProjectStoreKeys as facadeBuildProjectStoreKeys,
  copyProjectScopedStoreFiles as facadeCopyProjectScopedStoreFiles,
  rewriteProjectScopedPayload as facadeRewriteProjectScopedPayload,
} from "./project-duplication";
import {
  buildProjectStoreKeys,
  copyProjectScopedStoreFiles,
  rewriteProjectScopedPayload,
} from "./project/project-duplication";

describe("project duplication storage boundary", () => {
  it("keeps the root facade identical to canonical exports", () => {
    expect(facadeBuildProjectStoreKeys).toBe(buildProjectStoreKeys);
    expect(facadeCopyProjectScopedStoreFiles).toBe(copyProjectScopedStoreFiles);
    expect(facadeRewriteProjectScopedPayload).toBe(rewriteProjectScopedPayload);
  });

  it("unions partial listKeys output with all known project stores", () => {
    const keys = buildProjectStoreKeys("source", [
      "_p/source/script",
      "_p/source/custom-store",
      "_p/other/ignored",
    ]);

    expect(keys).toContain("_p/source/custom-store");
    expect(keys).toContain("_p/source/tts");
    expect(keys).toContain("_p/source/studio-workflow-store");
    expect(keys).toContain("_p/source/props");
    // 回归:store 布局 v1 后根目录列举兜底失效,editing/self-media 必须显式在场
    expect(keys).toContain("_p/source/剧本");
    expect(keys).toContain("_p/source/editing");
    expect(keys).toContain("_p/source/self-media");
    expect(keys).not.toContain("_p/other/ignored");
  });

  it("rewrites a TTS project id without changing fixed profile evidence", () => {
    const source = JSON.stringify({
      state: {
        activeProjectId: "source",
        projects: {
          source: {
            voiceLines: {},
            bindings: {
              narrator: { speakerId: "narrator", profileId: "profile-narrator" },
            },
          },
        },
        voiceProfiles: {
          "profile-narrator": {
            id: "profile-narrator",
            referenceAudioPath: "/voices/narrator.wav",
            referenceText: "这一夜，雨没有停。",
            createdAt: 100,
            updatedAt: 100,
          },
        },
      },
      version: 0,
    });

    const rewritten = JSON.parse(
      rewriteProjectScopedPayload(source, "source", "target"),
    );

    expect(rewritten.state.activeProjectId).toBe("target");
    expect(Object.keys(rewritten.state.projects)).toEqual(["target"]);
    expect(rewritten.state.voiceProfiles["profile-narrator"]).toEqual({
      id: "profile-narrator",
      referenceAudioPath: "/voices/narrator.wav",
      referenceText: "这一夜，雨没有停。",
      createdAt: 100,
      updatedAt: 100,
    });
  });

  it("copies sharded studio-workflow: manifest + root shards + chapter shards verbatim", async () => {
    // 分片时代(58508aa)复制走 manifest 驱动的 copyStudioWorkflowShards——
    // 本用例补齐守卫:章节子目录分片必须随副本,内容按原文搬运
    const manifest = {
      shards: ["core-a1b2.json", "chapters/chapter-001/agent-001-x9y8.json"],
      version: 6,
    };
    const data = new Map<string, string>([
      ["_p/source/studio-workflow/manifest", JSON.stringify(manifest)],
      ["_p/source/studio-workflow/core-a1b2", JSON.stringify({ state: { novelChapters: [{ id: "chapter-001" }] } })],
      ["_p/source/studio-workflow/chapters/chapter-001/agent-001-x9y8", JSON.stringify({ state: { agentWorkData: [1] } })],
      ["_p/source/tts", JSON.stringify({ state: { activeProjectId: "source" } })],
    ]);
    const writes = new Map<string, string>();

    const copied = await copyProjectScopedStoreFiles(
      {
        listKeys: async () => [],
        getItem: async (key) => data.get(key) ?? null,
        setItem: async (key, value) => {
          writes.set(key, value);
          return true;
        },
      },
      "source",
      "target",
    );

    expect(copied).toBe(4);
    expect(writes.get("_p/target/studio-workflow/manifest")).toContain('"version":6');
    expect(writes.get("_p/target/studio-workflow/core-a1b2")).toContain("novelChapters");
    expect(writes.get("_p/target/studio-workflow/chapters/chapter-001/agent-001-x9y8")).toContain("agentWorkData");
  });

  it("falls back to the legacy monolith copy when no shard manifest exists", async () => {
    const data = new Map<string, string>([
      ["_p/source/studio-workflow-store", JSON.stringify({ state: { storyboards: [] } })],
    ]);
    const writes = new Map<string, string>();

    const copied = await copyProjectScopedStoreFiles(
      {
        listKeys: async () => [],
        getItem: async (key) => data.get(key) ?? null,
        setItem: async (key, value) => {
          writes.set(key, value);
          return true;
        },
      },
      "source",
      "target",
    );

    expect(copied).toBe(1);
    expect(writes.has("_p/target/studio-workflow-store")).toBe(true);
    expect(writes.has("_p/target/studio-workflow/manifest")).toBe(false);
  });

  it("copies tts even when listKeys omits it and fails on a rejected write", async () => {
    const sourceTts = JSON.stringify({
      state: {
        activeProjectId: "source",
        projects: { source: { voiceLines: {}, bindings: {} } },
        voiceProfiles: {},
      },
    });
    const data = new Map<string, string>([
      ["_p/source/script", JSON.stringify({ state: { activeProjectId: "source" } })],
      ["_p/source/tts", sourceTts],
    ]);
    const writes = new Map<string, string>();

    const copied = await copyProjectScopedStoreFiles(
      {
        listKeys: async () => ["_p/source/script"],
        getItem: async (key) => data.get(key) ?? null,
        setItem: async (key, value) => {
          writes.set(key, value);
          return true;
        },
      },
      "source",
      "target",
    );

    expect(copied).toBe(2);
    expect(writes.has("_p/target/tts")).toBe(true);
    expect(JSON.parse(writes.get("_p/target/tts")!).state.activeProjectId).toBe(
      "target",
    );

    await expect(
      copyProjectScopedStoreFiles(
        {
          listKeys: async () => ["_p/source/tts"],
          getItem: async (key) => data.get(key) ?? null,
          setItem: async () => false,
        },
        "source",
        "target",
      ),
    ).rejects.toThrow("项目数据写入失败: _p/target/tts");
  });
});
