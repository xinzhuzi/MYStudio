#!/usr/bin/env node
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
//
// 一次性迁移脚本:把真实产物目录里的 toonflow_ 前缀目录/文件改名为
// MYStudio 工作流阶段名,并同步 studio-workflow-store.json 里的路径字符串。
//
// 用途:Task 08-04-artifact-output-management / Slice #39。
// 幂等:重复运行不会出错(已改名则跳过)。运行前请先 cp -r 备份(脚本内置 dry-run)。
//
// 用法:
//   node migrate-toonflow-dirs-to-stage-names.mjs --dry-run   # 预演,不写盘
//   node migrate-toonflow-dirs-to-stage-names.mjs             # 执行

import { existsSync, readdirSync, renameSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT =
  "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0";
const EXPORTS = resolve(PROJECT_ROOT, "exports", "chapter-001");

const dryRun = process.argv.includes("--dry-run");

// 目录改名映射(旧 → 新)
const DIR_RENAMES = [
  ["toonflow_audio", "voice-audio"],
  ["toonflow_frames", "storyboard-frames"],
  ["toonflow_segments", "clip-segments"],
  ["toonflow_derived_assets", "derived-assets"],
];

// 文件改名映射(旧 → 新)
const FILE_RENAMES = [
  ["toonflow_concat.txt", "clip-concat.txt"],
  // 旧成片名去掉 _toonflow_workflow 后缀,只保留章节名
  [
    "道劫_EP01_断剑夜访道口镇_toonflow_workflow.mp4",
    "道劫_EP01_断剑夜访道口镇.mp4",
  ],
];

// store.json 里路径子串替换(顺序敏感:先长后短,避免子串误伤)
const STORE_REPLACEMENTS = [
  ["toonflow_derived_assets", "derived-assets"],
  ["toonflow_audio", "voice-audio"],
  ["toonflow_frames", "storyboard-frames"],
  ["toonflow_segments", "clip-segments"],
  ["toonflow_concat.txt", "clip-concat.txt"],
  // 成片文件名(描述串 + 路径串)
  ["道劫_EP01_断剑夜访道口镇_toonflow_workflow.mp4", "道劫_EP01_断剑夜访道口镇.mp4"],
];

// 活数据 JSON 文件清单(运行时会读的;不含 .bak-* 历史备份与 backups/ 目录)。
// 每个文件套用同一组 STORE_REPLACEMENTS 子串替换。
const LIVING_DATA_FILES = [
  "script.json",
  "scenes.json",
  "props.json",
  "characters.json",
  "exports/chapter-001/automation_report.json",
  "visual-continuity-backups/storyboard-promotion-20260807T103601978677Z-5e481542ae94/studio-workflow-store.json",
  "visual-continuity-backups/storyboard-human-review-v2-pre-ui-9945ad515453/studio-workflow-store.json",
];

// 非 JSON 的纯文本 manifest 清单(如 ffmpeg concat 列表)。它们内部也写死了
// toonflow_* 目录路径,迁移时同样需要做子串替换,否则留下悬空引用。
// (历史教训:首次迁移只替换了 JSON,漏了这类文本 manifest。)
const TEXT_MANIFEST_FILES = ["exports/chapter-001/clip-concat.txt"];

function log(kind, msg) {
  console.log(`[${kind}] ${msg}`);
}

// --- 1. 磁盘目录改名 ---
let dirChanges = 0;
for (const [oldName, newName] of DIR_RENAMES) {
  const oldPath = resolve(EXPORTS, oldName);
  const newPath = resolve(EXPORTS, newName);
  if (existsSync(newPath)) {
    log("skip-dir", `${newName} 已存在,跳过 ${oldName}`);
    continue;
  }
  if (!existsSync(oldPath)) {
    log("missing-dir", `${oldName} 不存在,跳过`);
    continue;
  }
  log(dryRun ? "dry-rename-dir" : "rename-dir", `${oldName} → ${newName}`);
  if (!dryRun) {
    renameSync(oldPath, newPath);
  }
  dirChanges += 1;
}

// --- 2. 磁盘文件改名 ---
let fileChanges = 0;
for (const [oldName, newName] of FILE_RENAMES) {
  const oldPath = resolve(EXPORTS, oldName);
  const newPath = resolve(EXPORTS, newName);
  if (existsSync(newPath)) {
    log("skip-file", `${newName} 已存在,跳过 ${oldName}`);
    continue;
  }
  if (!existsSync(oldPath)) {
    log("missing-file", `${oldName} 不存在,跳过`);
    continue;
  }
  const size = statSync(oldPath).size;
  log(dryRun ? "dry-rename-file" : "rename-file", `${oldName} → ${newName} (${size} bytes)`);
  if (!dryRun) {
    renameSync(oldPath, newPath);
  }
  fileChanges += 1;
}

// --- 3. store.json 路径字符串替换 ---
// 兼容分片布局：旧单文件与 studio-workflow/ 分片文件都做同样的原文替换。
const STORE_PATH = resolve(PROJECT_ROOT, "studio-workflow-store.json");
const STORE_SHARD_DIR = resolve(PROJECT_ROOT, "studio-workflow");
const storeFiles = [];
if (existsSync(STORE_PATH)) {
  storeFiles.push(STORE_PATH);
} else {
  log("missing-store", `${STORE_PATH} 不存在,尝试分片布局`);
}
if (existsSync(resolve(STORE_SHARD_DIR, "manifest.json"))) {
  for (const entry of readdirSync(STORE_SHARD_DIR)) {
    if (entry.endsWith(".json")) storeFiles.push(resolve(STORE_SHARD_DIR, entry));
  }
}
let storeChanges = 0;
if (storeFiles.length === 0) {
  log("missing-store", `${STORE_PATH} 与 ${STORE_SHARD_DIR} 均不存在,跳过 store 替换`);
}
for (const storeFilePath of storeFiles) {
  const original = readFileSync(storeFilePath, "utf8");
  let mutated = original;
  for (const [from, to] of STORE_REPLACEMENTS) {
    if (mutated.includes(from)) {
      const count = mutated.split(from).length - 1;
      mutated = mutated.split(from).join(to);
      log(dryRun ? "dry-store-replace" : "store-replace", `"${from}" → "${to}" (${count} 处) @ ${storeFilePath}`);
      storeChanges += count;
    }
  }
  if (mutated !== original) {
    if (!dryRun) {
      writeFileSync(storeFilePath, mutated, "utf8");
    }
    log(dryRun ? "dry-store-written" : "store-written", `${storeFilePath} 已更新`);
  } else {
    log("store-unchanged", `${storeFilePath} 无 toonflow_ 残留,未改动`);
  }
}

// --- 4. 活数据 JSON 批量替换(script.json 等) ---
let livingChanges = 0;
for (const rel of LIVING_DATA_FILES) {
  const filePath = resolve(PROJECT_ROOT, rel);
  if (!existsSync(filePath)) {
    log("missing-living", `${rel} 不存在,跳过`);
    continue;
  }
  const original = readFileSync(filePath, "utf8");
  let mutated = original;
  let fileCount = 0;
  for (const [from, to] of STORE_REPLACEMENTS) {
    if (mutated.includes(from)) {
      const count = mutated.split(from).length - 1;
      mutated = mutated.split(from).join(to);
      fileCount += count;
    }
  }
  if (mutated !== original) {
    log(dryRun ? "dry-living-replace" : "living-replace", `${rel} (${fileCount} 处)`);
    if (!dryRun) {
      writeFileSync(filePath, mutated, "utf8");
    }
    livingChanges += fileCount;
  } else {
    log("living-unchanged", `${rel} 无 toonflow_ 残留`);
  }
}

// --- 4.5 非 JSON 文本 manifest 替换(如 ffmpeg concat 列表) ---
let manifestChanges = 0;
for (const rel of TEXT_MANIFEST_FILES) {
  const filePath = resolve(PROJECT_ROOT, rel);
  if (!existsSync(filePath)) {
    log("missing-manifest", `${rel} 不存在,跳过`);
    continue;
  }
  const original = readFileSync(filePath, "utf8");
  let mutated = original;
  let fileCount = 0;
  for (const [from, to] of STORE_REPLACEMENTS) {
    if (mutated.includes(from)) {
      const count = mutated.split(from).length - 1;
      mutated = mutated.split(from).join(to);
      fileCount += count;
    }
  }
  if (mutated !== original) {
    log(dryRun ? "dry-manifest-replace" : "manifest-replace", `${rel} (${fileCount} 处)`);
    if (!dryRun) {
      writeFileSync(filePath, mutated, "utf8");
    }
    manifestChanges += fileCount;
  } else {
    log("manifest-unchanged", `${rel} 无 toonflow_ 残留`);
  }
}

// --- 5. 残留校验(覆盖 store + 活 JSON + 文本 manifest,避免只扫 store 的假 clean) ---
const remainingChecks = [
  "toonflow_audio",
  "toonflow_frames",
  "toonflow_segments",
  "toonflow_derived_assets",
  "toonflow_concat.txt",
  "toonflow_workflow",
];
const VERIFY_FILES = [
  ["store", STORE_PATH],
  ...LIVING_DATA_FILES.map((rel) => [`living:${rel}`, resolve(PROJECT_ROOT, rel)]),
  ...TEXT_MANIFEST_FILES.map((rel) => [`manifest:${rel}`, resolve(PROJECT_ROOT, rel)]),
];
let totalLeftovers = 0;
for (const [tag, filePath] of VERIFY_FILES) {
  if (!existsSync(filePath)) continue;
  const after = readFileSync(filePath, "utf8");
  const leftovers = remainingChecks.filter((tok) => after.includes(tok));
  if (leftovers.length > 0) {
    log("WARN-leftover", `${tag} 仍有残留 token: ${leftovers.join(", ")}`);
    totalLeftovers += leftovers.length;
  }
}
if (totalLeftovers === 0) {
  log("all-clean", `全部 ${VERIFY_FILES.length} 个已处理文件均无 toonflow_ 残留`);
}

log("summary", `dirs=${dirChanges} files=${fileChanges} storeTokens=${storeChanges} livingTokens=${livingChanges} manifestTokens=${manifestChanges} dryRun=${dryRun}`);
