#!/usr/bin/env node
// Clean regenerable/historical residue inside a MYStudio project folder.
//
// Policy (conservative):
//   - video-use/*/r<N> revision snapshots: keep the newest --keep-revisions (default 2),
//     delete older sealed revisions.
//   - top-level *.bak-* files older than --bak-days (default 3).
//   - visual-continuity-backups/ older than --bak-days.
//   - assets-migration-report-*: keep newest 1, delete rest.
//   - .DS_Store anywhere under the project dir.
//   - NEVER touch: live stores (*.json), assets/, exports/, editing/, remotion/,
//     continuity-bibles/, backups/ (deletion-service gated), novel/, workflow-images/.
//
// Usage:
//   node clean-project-archives.mjs [--project <dir>] [--keep-revisions 2]
//                                    [--bak-days 3] [--apply]
// Default project: /Users/zhengbingjin/Project/IP/MA (道劫). Dry-run unless --apply.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const APPLY = args.includes("--apply");
const PROJECT = path.resolve(
  flag("project", "/Users/zhengbingjin/Project/IP/MA"),
);
const KEEP_REVISIONS = Number(flag("keep-revisions", "2"));
const BAK_DAYS = Number(flag("bak-days", "3"));

const PROTECTED_TOPLEVEL = new Set([
  "assets", "exports", "editing", "remotion", "continuity-bibles",
  "backups", "novel", "workflow-images",
]);

const du = (p) => {
  try {
    let total = 0;
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else { try { total += fs.statSync(full).size; } catch { /* gone */ } }
      }
    };
    if (fs.existsSync(p)) walk(p);
    return total;
  } catch { return 0; }
};
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
const olderThanDays = (p, days) => Date.now() - fs.statSync(p).mtimeMs > days * 86400e3;
const rmAll = (p) => fs.rmSync(p, { recursive: true, force: true });

if (!fs.existsSync(PROJECT)) {
  console.error(`[clean] 项目目录不存在: ${PROJECT}`);
  process.exit(1);
}

const actions = []; // {label, target, bytes}

// 1. Old revision snapshots under video-use/*/rN
const videoUse = path.join(PROJECT, "video-use");
if (fs.existsSync(videoUse)) {
  for (const chapter of fs.readdirSync(videoUse, { withFileTypes: true })) {
    if (!chapter.isDirectory()) continue;
    const revs = fs.readdirSync(path.join(videoUse, chapter.name), { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^r\d+$/.test(e.name))
      .map((e) => ({ name: e.name, n: Number(e.name.slice(1)) }))
      .sort((a, b) => a.n - b.n);
    const drop = revs.slice(0, Math.max(0, revs.length - KEEP_REVISIONS));
    for (const r of drop) {
      const target = path.join(videoUse, chapter.name, r.name);
      actions.push({ label: `revision ${chapter.name}/${r.name}`, target, bytes: du(target) });
    }
    if (revs.length) {
      console.log(`[clean] ${chapter.name}: 共 ${revs.length} 版(r${revs[0].n}~r${revs[revs.length - 1].n}),保留最新 ${Math.min(KEEP_REVISIONS, revs.length)} 版`);
    }
  }
}

// 2. *.bak-* older than BAK_DAYS (top level only)
for (const e of fs.readdirSync(PROJECT, { withFileTypes: true })) {
  if (e.isFile() && e.name.includes(".bak-") && olderThanDays(path.join(PROJECT, e.name), BAK_DAYS)) {
    actions.push({ label: `bak ${e.name}`, target: path.join(PROJECT, e.name), bytes: du(path.join(PROJECT, e.name)) });
  }
}

// 3. visual-continuity-backups/ older than BAK_DAYS
const vcb = path.join(PROJECT, "visual-continuity-backups");
if (fs.existsSync(vcb) && olderThanDays(vcb, BAK_DAYS)) {
  actions.push({ label: "visual-continuity-backups/", target: vcb, bytes: du(vcb) });
}

// 4. assets-migration-report-*: keep newest 1
const reports = fs.readdirSync(PROJECT, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.startsWith("assets-migration-report-"))
  .map((e) => ({ name: e.name, mtime: fs.statSync(path.join(PROJECT, e.name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
for (const r of reports.slice(1)) {
  actions.push({ label: `report ${r.name}`, target: path.join(PROJECT, r.name), bytes: du(path.join(PROJECT, r.name)) });
}

// 5. .DS_Store anywhere (not counted in reclaim total — tiny)
const dsStores = [];
const walkDs = (dir) => {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.name === ".DS_Store") dsStores.push(full);
    else if (e.isDirectory()) walkDs(full);
  }
};
walkDs(PROJECT);

// Safety: refuse any action that resolved outside the project dir
const inside = (p) => p.startsWith(PROJECT + path.sep);
const totalBytes = actions.reduce((s, a) => s + a.bytes, 0);

console.log(`\n[clean] 模式: ${APPLY ? "真实执行" : "DRY-RUN(加 --apply 执行)"} | 项目: ${PROJECT}`);
console.log(`[clean] 计划清理 ${actions.length} 项,合计 ${mb(totalBytes)};另 .DS_Store ${dsStores.length} 个\n`);
for (const a of actions) console.log(`  - ${a.label}  ${mb(a.bytes)}`);

if (APPLY) {
  for (const a of actions) {
    if (!inside(path.resolve(a.target))) { console.error(`[clean] 拒绝越界: ${a.target}`); process.exit(1); }
    rmAll(a.target);
  }
  for (const s of dsStores) { if (inside(s)) rmAll(s); }
  console.log(`\n[clean] 已清理 ${actions.length} 项 + ${dsStores.length} 个 .DS_Store,释放 ${mb(totalBytes)}`);
} else {
  console.log(`\n[clean] DRY-RUN 结束:未修改任何文件`);
}
