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
  md5Utf8,
} from "../../frontend/lib/storage/studio-workflow-shards";
import {
  BACKUPS_README_TEMPLATE,
  PROJECT_README_TEMPLATE,
  README_TEMPLATE,
  md5,
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

  it("store 布局 v1:store/ 目录存在时读写都落在 store/studio-workflow(与旧布局等价)", () => {
    const projectDir = makeProjectDir();
    fs.mkdirSync(path.join(projectDir, "store"), { recursive: true });
    const value = JSON.stringify({ state: buildState(), version: 7 });

    const writeResult = writeStudioWorkflowStore(projectDir, value);
    const shardDir = path.join(projectDir, "store", "studio-workflow");
    assert.ok(fs.existsSync(path.join(shardDir, "manifest.json")), "分片应写入 store/studio-workflow/");
    assert.ok(!fs.existsSync(path.join(projectDir, "studio-workflow")), "不应在旧位置新建分片目录");

    const read = readStudioWorkflowStore(projectDir);
    assert.equal(read.sharded, true);
    assert.deepEqual(read.state, buildState());
    assert.equal(read.version, 7);
    assert.ok(writeResult.legacyBackupPath === null, "无 legacy 单文件则无 bak");
  });

  it("store 布局 v1:旧布局写入后模拟应用迁移,store/ 下仍可完整读取", () => {
    const projectDir = makeProjectDir();
    const value = JSON.stringify({ state: buildState(), version: 3 });
    writeStudioWorkflowStore(projectDir, value); // 旧布局:<root>/studio-workflow/

    // 模拟应用侧迁移:整个分片目录搬进 store/
    fs.mkdirSync(path.join(projectDir, "store"), { recursive: true });
    fs.renameSync(path.join(projectDir, "studio-workflow"), path.join(projectDir, "store", "studio-workflow"));

    const read = readStudioWorkflowStore(projectDir);
    assert.equal(read.sharded, true);
    assert.deepEqual(read.state, buildState());
    assert.equal(read.version, 3);
  });

  it("writes README.md as a verbatim copy of the authoritative template (md5-checked) and repairs tampering", () => {
    const projectDir = makeProjectDir();
    const value = JSON.stringify({ state: buildState(), version: 10 });
    writeStudioWorkflowStore(projectDir, value);
    const readmePath = path.join(projectDir, "studio-workflow", "README.md");
    assert.ok(fs.existsSync(readmePath), "README.md 应随写盘生成");
    const written = fs.readFileSync(readmePath, "utf-8");
    assert.equal(written, README_TEMPLATE);
    assert.equal(md5(written), md5(README_TEMPLATE));
    // TS 侧纯 md5 与孪生 node:crypto 一致（同一模板）
    assert.equal(md5Utf8(written), md5(written));

    // 篡改 → 下次写盘自动修复
    fs.writeFileSync(readmePath, "被人手改过的内容", "utf-8");
    writeStudioWorkflowStore(projectDir, value);
    assert.equal(fs.readFileSync(readmePath, "utf-8"), README_TEMPLATE);

    // 删除 → 下次写盘自动补齐
    fs.rmSync(readmePath);
    writeStudioWorkflowStore(projectDir, value);
    assert.equal(fs.readFileSync(readmePath, "utf-8"), README_TEMPLATE);
  });

  it("writes and repairs the project-root README (全目录介绍) from the authoritative template", () => {
    const projectDir = makeProjectDir();
    const value = JSON.stringify({ state: buildState(), version: 10 });
    writeStudioWorkflowStore(projectDir, value);
    const rootReadmePath = path.join(projectDir, "README.md");
    assert.ok(fs.existsSync(rootReadmePath), "项目根 README.md 应随写盘生成");
    assert.equal(fs.readFileSync(rootReadmePath, "utf-8"), PROJECT_README_TEMPLATE);
    assert.ok(PROJECT_README_TEMPLATE.includes("目录总览"));
    const backupsReadmePath = path.join(projectDir, "backups", "README.md");
    assert.ok(fs.existsSync(backupsReadmePath), "backups/README.md 应随写盘生成");
    assert.equal(fs.readFileSync(backupsReadmePath, "utf-8"), BACKUPS_README_TEMPLATE);

    // 篡改 → 下次写盘自动修复；删除 → 自动补齐
    fs.writeFileSync(rootReadmePath, "被手改", "utf-8");
    writeStudioWorkflowStore(projectDir, value);
    assert.equal(fs.readFileSync(rootReadmePath, "utf-8"), PROJECT_README_TEMPLATE);
    fs.rmSync(rootReadmePath);
    writeStudioWorkflowStore(projectDir, value);
    assert.equal(fs.readFileSync(rootReadmePath, "utf-8"), PROJECT_README_TEMPLATE);
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
