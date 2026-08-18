#!/usr/bin/env node
/**
 * 存量 JSON store 一次性重排为多行格式(indent 2 + 换行结尾)——与应用运行时的
 * pretty-json 归一口径一致(electron/storage/pretty-json.ts)。
 * 应用关闭状态下运行;幂等:已是目标格式或非 JSON 文件原样跳过,*.bak* 不碰。
 *
 * 用法: node apps/build/scripts/reformat-store-pretty.mjs <目录>... [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dirs = args.filter((a) => !a.startsWith("--"));
if (dirs.length === 0) {
  console.error("用法: node apps/build/scripts/reformat-store-pretty.mjs <目录>... [--dry-run]");
  console.error("示例: node apps/build/scripts/reformat-store-pretty.mjs /path/to/project/store");
  process.exit(1);
}

let scanned = 0;
let reformatted = 0;
let skipped = 0;
let failed = 0;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    console.error(`[err] 无法读取目录 ${dir}: ${error.message}`);
    failed += 1;
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // studio-workflow 分片子树已是多行且字节与文件名内容戳绑定,归分片规划器管辖,外部不碰
      if (entry.name === "studio-workflow") {
        skipped += 1;
        continue;
      }
      walk(full);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (entry.name.includes(".bak")) {
      skipped += 1;
      continue;
    }
    scanned += 1;
    let raw;
    let parsed;
    try {
      raw = fs.readFileSync(full, "utf-8");
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`[skip] 非有效 JSON: ${full}`);
      skipped += 1;
      continue;
    }
    const first = raw.trimStart()[0];
    if (first !== "{" && first !== "[") {
      skipped += 1;
      continue;
    }
    const pretty = `${JSON.stringify(parsed, null, 2)}\n`;
    if (raw === pretty) {
      skipped += 1;
      continue;
    }
    console.log(`${dryRun ? "[dry] " : "[fmt] "}${full}`);
    if (dryRun) {
      reformatted += 1;
      continue;
    }
    try {
      fs.writeFileSync(full, pretty, "utf-8");
      reformatted += 1;
    } catch (error) {
      console.error(`[err] ${full}: ${error.message}`);
      failed += 1;
    }
  }
}

for (const dir of dirs) walk(path.resolve(dir));
console.log(
  `完成: 重排 ${reformatted}${dryRun ? "(dry-run)" : ""} / 跳过 ${skipped} / 失败 ${failed} (共扫描 ${scanned} 个 json)`,
);
