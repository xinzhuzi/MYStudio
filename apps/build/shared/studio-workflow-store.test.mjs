// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// JS 孪生（本目录 studio-workflow-store.mjs）与 TS 权威实现
// （apps/frontend/lib/storage/studio-workflow-shards.ts）的协议对拍守卫：
// 任一侧布局/命名/合并语义漂移都会在此炸掉。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, it } from "vitest";
import {
  planStudioWorkflowShards as planTs,
  mergeStudioWorkflowShards as mergeTs,
} from "../../frontend/lib/storage/studio-workflow-shards";
import {
  mergeStudioWorkflowShards,
  planStudioWorkflowShards,
  readStudioWorkflowStore,
  writeStudioWorkflowStore,
} from "./studio-workflow-store.mjs";

const tmpDirs = [];
const makeProjectDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-shard-twin-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function buildState() {
  return {
    novelChapters: [
      { id: "chapter-001", title: "第一章", sourceText: "正".repeat(300) },
      { id: "chapter-002", title: "第二章", sourceText: "文".repeat(300) },
      { id: "chapter-003", title: "巨章", sourceText: "字".repeat(1500) },
    ],
    storyboards: Array.from({ length: 10 }, (_, index) => ({
      id: `sb-${index}`,
      episodeId: "chapter-001",
      index,
      prompt: `分镜 ${index}`,
    })),
    scriptPlans: [{ id: "plan-1", title: "计划" }],
    sourceBible: "# 原著圣经",
    workflowConfig: { episodeDurationMin: 3 },
    eventGraph: [],
    mediaTasks: [],
  };
}

describe("studio-workflow-store mjs twin parity", () => {
  it("produces identical shard file names and contents as the TS implementation", () => {
    const value = JSON.stringify({ state: buildState(), version: 10 });
    const tsPlan = planTs(value, { limitBytes: 2048 });
    const jsPlan = planStudioWorkflowShards(value, { limitBytes: 2048 });
    assert.deepEqual(jsPlan.manifest, tsPlan.manifest);
    assert.deepEqual(
      jsPlan.files.map((file) => [file.name, file.content]),
      tsPlan.files.map((file) => [file.name, file.content]),
    );
    assert.deepEqual(jsPlan.oversizedFiles, tsPlan.oversizedFiles);
  });

  it("merges shard sets identically to the TS implementation", () => {
    const value = JSON.stringify({ state: buildState(), version: 10 });
    const plan = planStudioWorkflowShards(value, { limitBytes: 1024 });
    const jsMerged = mergeStudioWorkflowShards(plan.files.map((file) => file.content));
    const tsMerged = mergeTs(plan.files.map((file) => file.content));
    assert.deepEqual(jsMerged, tsMerged);
    // 切分无损
    assert.deepEqual(jsMerged.state, buildState());
  });

  it("write→read round-trips on disk and migrates the legacy single file to .bak-sharded-*", () => {
    const projectDir = makeProjectDir();
    const legacyPath = path.join(projectDir, "studio-workflow-store.json");
    const legacyValue = JSON.stringify({ state: buildState(), version: 10 });
    fs.writeFileSync(legacyPath, legacyValue, "utf8");

    // legacy 布局读取
    const legacyRead = readStudioWorkflowStore(projectDir);
    assert.equal(legacyRead.source ?? legacyRead.sharded, false);
    assert.deepEqual(legacyRead.state, buildState());

    const writeResult = writeStudioWorkflowStore(projectDir, legacyValue);
    assert.ok(writeResult.legacyBackupPath && writeResult.legacyBackupPath.includes(".bak-sharded-"));
    assert.ok(!fs.existsSync(legacyPath), "legacy 单文件应已改名");
    assert.ok(fs.existsSync(writeResult.legacyBackupPath), "bak 备份必须保留");

    // 分片布局读取 = legacy 全量
    const shardedRead = readStudioWorkflowStore(projectDir);
    assert.equal(shardedRead.sharded, true);
    assert.deepEqual(shardedRead.state, buildState());
    assert.equal(shardedRead.version, 10);

    // 每片 ≤512KB（单条超限独占片除外，本例 1500 字巨章 ~4.5KB < 512KB）
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, "studio-workflow", "manifest.json"), "utf8"));
    for (const shardName of manifest.shards) {
      const bytes = fs.statSync(path.join(projectDir, "studio-workflow", shardName)).size;
      assert.ok(bytes <= 512 * 1024, `分片超限: ${shardName} ${bytes}`);
    }
  });

  it("writeStudioWorkflowStore cleans previous-generation orphans", () => {
    const projectDir = makeProjectDir();
    const value = JSON.stringify({ state: buildState(), version: 10 });
    writeStudioWorkflowStore(projectDir, value);
    const orphan = path.join(projectDir, "studio-workflow", "storyboards-0000dead.json");
    fs.writeFileSync(orphan, "{}", "utf8");

    writeStudioWorkflowStore(projectDir, value);
    assert.ok(!fs.existsSync(orphan), "上一代孤儿分片应被清理");
  });
});
