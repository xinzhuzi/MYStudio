import { describe, expect, it } from "vitest";
import {
  buildProjectStoreKeys,
  copyProjectScopedStoreFiles,
  rewriteProjectScopedPayload,
} from "./project-duplication";

describe("project duplication storage boundary", () => {
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
