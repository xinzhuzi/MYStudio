import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStudioWorkflowStore, writeStudioWorkflowStore } from "./studio-workflow-store-io";

let dataRoot: string;
const projectId = "proj-f4-test";

function writeFixture(state: Record<string, unknown>): void {
  writeStudioWorkflowStore(dataRoot, projectId, JSON.stringify({ state, version: 10 }));
}

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-workflow-io-"));
});

afterEach(() => {
  if (dataRoot) fs.rmSync(dataRoot, { recursive: true, force: true });
});

describe("readStudioWorkflowStore chapter-scoped read (1109 审计 F-4)", () => {
  const state = {
    workflowConfig: { chapterGrade: "warm", subtitleFont: "default" },
    storyboards: [
      { id: "s1", episodeId: "chA", prompt: "甲镜一" },
      { id: "s2", episodeId: "chB", prompt: "乙镜一" },
      { id: "s3", episodeId: "chA", prompt: "甲镜二" },
    ],
    agentWorkData: [
      { id: "w1", episodeId: "chA", draft: "甲章剧本" },
      { id: "w2", episodeId: "chB", draft: "乙章剧本" },
    ],
  };

  it("全量读（不传 chapterId）合并所有章分片", () => {
    writeFixture(state);
    const store = readStudioWorkflowStore(dataRoot, projectId);
    expect(store?.source).toBe("sharded");
    expect((store?.state.storyboards as unknown[]).map((s) => (s as { id: string }).id)).toEqual(["s1", "s2", "s3"]);
  });

  it("按章读只返回该章章归属域条目，项目级 workflowConfig 保留", () => {
    writeFixture(state);
    const store = readStudioWorkflowStore(dataRoot, projectId, "chA");
    expect((store?.state.storyboards as unknown[]).map((s) => (s as { id: string }).id)).toEqual(["s1", "s3"]);
    expect((store?.state.agentWorkData as unknown[]).map((s) => (s as { id: string }).id)).toEqual(["w1"]);
    expect(store?.state.workflowConfig).toEqual({ chapterGrade: "warm", subtitleFont: "default" });
  });

  it("按章读切换到另一章只返回该章条目", () => {
    writeFixture(state);
    const store = readStudioWorkflowStore(dataRoot, projectId, "chB");
    expect((store?.state.storyboards as unknown[]).map((s) => (s as { id: string }).id)).toEqual(["s2"]);
    expect((store?.state.agentWorkData as unknown[]).map((s) => (s as { id: string }).id)).toEqual(["w2"]);
  });

  it("无分片的章返回空章归属域，但项目级数据仍在", () => {
    writeFixture(state);
    const store = readStudioWorkflowStore(dataRoot, projectId, "chMissing");
    expect(store?.state.storyboards ?? []).toEqual([]);
    expect(store?.state.workflowConfig).toEqual({ chapterGrade: "warm", subtitleFont: "default" });
  });

  it("按章读不读取他章分片（他章分片损坏也不影响本章读）", () => {
    writeFixture(state);
    const projectRoot = path.join(dataRoot, "_p", projectId);
    const shardDir = fs.existsSync(path.join(projectRoot, "store"))
      ? path.join(projectRoot, "store", "studio-workflow")
      : path.join(projectRoot, "studio-workflow");
    const manifest = JSON.parse(fs.readFileSync(path.join(shardDir, "manifest.json"), "utf-8")) as { shards: string[] };
    const chBShard = manifest.shards.find((name) => name.startsWith("chapters/chB/"));
    expect(chBShard).toBeTruthy();
    // 损坏 chB 分片：全量读会抛错，按 chA 读应跳过 chB 正常返回
    fs.writeFileSync(path.join(shardDir, chBShard!), "{ broken json", "utf-8");
    expect(() => readStudioWorkflowStore(dataRoot, projectId)).toThrow();
    const store = readStudioWorkflowStore(dataRoot, projectId, "chA");
    expect((store?.state.storyboards as unknown[]).map((s) => (s as { id: string }).id)).toEqual(["s1", "s3"]);
  });

  it("legacy 单文件无分片可选，传 chapterId 照旧全量返回", () => {
    const legacyDir = path.join(dataRoot, "_p", projectId);
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "studio-workflow-store.json"), JSON.stringify({ state, version: 10 }), "utf-8");
    const store = readStudioWorkflowStore(dataRoot, projectId, "chA");
    expect(store?.source).toBe("legacy");
    expect((store?.state.storyboards as unknown[]).length).toBe(3);
  });
});