// 一次性验证脚本:交叉验证 artifact-inventory-service.ts 的备份分类正则。
//
// 目的:
//   用真实磁盘数据验证改动后的 BACKUP_SUFFIX_RE 既能抓住所有历史备份
//   (.bak / .bak-xxx / .codex-xxx / .codex-...-backup / .smoke-xxx),
//   又不会误伤真正的 store 文件(studio-workflow-store.json 等)。
//
// 约束:
//   - 纯 node fs 扫描 + 正则,不 import electron 运行时,只读磁盘。
//   - 不删任何文件。
//   - 复用 diagnose-blockers.mjs 的递归扫盘骨架,但用【新备份识别正则】。
//
// 正则来源:artifact-inventory-service.ts:228(改动后真实实现)
//   const BACKUP_SUFFIX_RE = /\.(?:bak(?:[-_][^.]*)?$|codex[-_][^.]*$|smoke[-_][^.]*$)/i;

import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";

const PROJECT_ROOT =
  "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0";

// === 新备份识别正则(逐字从源码 artifact-inventory-service.ts:228 抄出) ===
// 不 import 源码(那是 electron 运行时模块),直接复制字面量,避免任何运行时耦合。
// 三条分支,均锚到结尾 $,且分隔符后用 [^.]* 只吞"无点的尾巴":
//   bak   → .bak / .bak-xxx / .bak_xxx
//   codex → .codex-xxx / .codex-...-backup(只要尾巴里没点)
//   smoke → .smoke-xxx
// 设计意图:`data.codex-backup.json` 这类以 .json 结尾的不匹配(尾巴有点)。
const BACKUP_SUFFIX_RE = /\.(?:bak(?:[-_][^.]*)?$|codex[-_][^.]*$|smoke[-_][^.]*$)/i;

// === 假阴性探测器:文件名里出现强备份信号但新正则没抓到 ===
// 用于发现"明显是备份却被漏掉"的样本。比正则更宽松,独立判断,作为 ground-truth 反例搜索。
// 命中以下任一即视为"疑似备份":
//   - 以 .bak 结尾 / .bak 后跟分隔符
//   - .codex- / .codex_ 子串(codex 生成的备份)
//   - .smoke- / .smoke_ 子串(smoke 测试备份)
//   - 文件名包含 "backup" 且不是 .json 本身(很多备份命名带 -backup 后缀)
// 注意:这是【怀疑】集合,不是判定;最终假阴性 = 怀疑且正则未命中。
const SUSPECT_BACKUP_RE = /\.(?:bak(?:[-_].*)?$|codex[-_].*|smoke[-_].*)/i;
const BACKUP_KEYWORD_RE = /(?:^|[-_.])backup(?:[-_.]|$)/i;

// === 假阳性探测器:被正则判为 backup,但语义上不该被当备份删的文件 ===
// 已知的真实 store / 配置文件(绝对不能被匹配成 backup):
const KNOWN_REAL_STORES = new Set([
  "studio-workflow-store.json",
  "studio-workflow.json",
  "剧本.json",
  "script.json",
  "characters.json",
  "scenes.json",
  "props.json",
  "director.json",
  "editing.json",
  "media.json",
  "sclass.json",
  "self-media.json",
  "artifacts.json",
]);

// ---- 扫盘 ----
const files = [];

async function walkDir(dir, rel = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    // 与源码 scanDirectory 同步:跳过隐藏目录与 node_modules
    if (e.isDirectory()) {
      if (!e.name.startsWith(".") && e.name !== "node_modules") {
        await walkDir(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      }
      continue;
    }
    if (!e.isFile()) continue;
    // 与源码同步:跳过 macOS Finder 元数据
    if (e.name === ".DS_Store" || e.name === "._.DS_Store") continue;
    files.push({ name: e.name, relPath: rel ? `${rel}/${e.name}` : e.name });
  }
}

await walkDir(PROJECT_ROOT);

// ---- 分类 ----
const matchedBackup = []; // 新正则判为 backup
const notBackup = []; // 新正则未判为 backup

for (const f of files) {
  if (BACKUP_SUFFIX_RE.test(f.name)) {
    matchedBackup.push(f);
  } else {
    notBackup.push(f);
  }
}

// 假阴性:文件名明显是备份但新正则漏掉
const falseNegatives = notBackup.filter(
  (f) =>
    SUSPECT_BACKUP_RE.test(f.name) ||
    // "backup" 关键词但不是 .json 本身
    (BACKUP_KEYWORD_RE.test(f.name) && !/\.json$/i.test(f.name)) ||
    // .json 文件但 basename 拆开后某段是纯 backup 文件名(防止 .json.bak 漏判)
    (BACKUP_KEYWORD_RE.test(f.name) &&
      SUSPECT_BACKUP_RE.test(f.name.replace(/\.json$/i, ""))),
);

// 假阳性:被正则判为 backup,但属于已知真实 store(不该被匹配)
const falsePositives = matchedBackup.filter(
  (f) => KNOWN_REAL_STORES.has(f.name) || /\.json$/i.test(f.name) === false && false,
);

// 进一步:任何被匹配为 backup 的、其后缀其实仍以 .json 结尾的(说明正则吞错了尾巴)
const suspiciousJsonTail = matchedBackup.filter((f) => /\.json$/i.test(f.name));

// ---- 按备份子类型分组统计(确认 .bak- / .codex- / codex-...-backup 都覆盖) ----
const bySubtype = { bak: [], codex: [], smoke: [], other: [] };
for (const f of matchedBackup) {
  if (/(?:^|[.])bak(?:[-_]|$)/i.test(f.name)) bySubtype.bak.push(f);
  else if (/(?:^|[.])codex[-_]/i.test(f.name)) bySubtype.codex.push(f);
  else if (/(?:^|[.])smoke[-_]/i.test(f.name)) bySubtype.smoke.push(f);
  else bySubtype.other.push(f);
}

// ---- 输出 ----
function fmt(arr, n) {
  return arr.slice(0, n).map((f) => `    ${f.relPath}`).join("\n");
}

console.log("========================================");
console.log(" 备份分类正则交叉验证 (真实磁盘数据)");
console.log("========================================");
console.log(`扫描根目录: ${PROJECT_ROOT}`);
console.log(`总文件数: ${files.length}`);
console.log(`新正则识别为 backup: ${matchedBackup.length}`);
console.log(`未识别为 backup: ${notBackup.length}`);
console.log("");
console.log("=== backup 样本(最多 10 个,确认 .bak-/.codex-/codex-...-backup 都被捕获) ===");
// 故意挑不同子型各取几个,确保覆盖面
const samplePick = [];
for (const sub of ["bak", "codex", "smoke"]) {
  samplePick.push(...bySubtype[sub].slice(0, sub === "bak" ? 4 : 3));
}
// codex-...-backup 这种特殊型单独确认
const codexBackupTail = matchedBackup.filter((f) =>
  /codex[-_][^.]*backup[^.]*$/i.test(f.name),
);
console.log(`  [按子型抽样]`);
console.log(`    .bak-  系列样本 (${Math.min(bySubtype.bak.length, 4)}/${bySubtype.bak.length}):`);
console.log(fmt(bySubtype.bak, 4) || "    (无)");
console.log(`    .codex-系列样本 (${Math.min(bySubtype.codex.length, 3)}/${bySubtype.codex.length}):`);
console.log(fmt(bySubtype.codex, 3) || "    (无)");
console.log(`    .smoke-系列样本 (${Math.min(bySubtype.smoke.length, 3)}/${bySubtype.smoke.length}):`);
console.log(fmt(bySubtype.smoke, 3) || "    (无)");
console.log(`    .codex-...-backup 特殊型 (${codexBackupTail.length} 个):`);
console.log(fmt(codexBackupTail, 3) || "    (无)");
console.log("");
console.log(`=== 前 10 个被识别为 backup 的样本(原始顺序) ===`);
console.log(fmt(matchedBackup, 10) || "    (无)");
console.log("");
console.log(`=== 假阴性(疑似备份但新正则漏掉): ${falseNegatives.length} 个 ===`);
if (falseNegatives.length) {
  console.log(fmt(falseNegatives, 20));
} else {
  console.log("    (无 — 所有疑似备份都被新正则捕获)");
}
console.log("");
console.log(`=== 假阳性(被误判为 backup 的真实 store): ${falsePositives.length} 个 ===`);
if (falsePositives.length) {
  console.log(fmt(falsePositives, 20));
} else {
  console.log("    (无 — studio-workflow-store.json 等真实 store 未被误匹配)");
}
console.log("");
console.log(`=== 二次核查:被匹配为 backup 但仍以 .json 结尾(应保持 0) ===`);
console.log(`    数量: ${suspiciousJsonTail.length}`);
if (suspiciousJsonTail.length) console.log(fmt(suspiciousJsonTail, 10));
console.log("");
console.log("=== 子型分布汇总 ===");
console.log(`    .bak-  系列: ${bySubtype.bak.length}`);
console.log(`    .codex-系列: ${bySubtype.codex.length}`);
console.log(`    .smoke-系列: ${bySubtype.smoke.length}`);
console.log(`    其它:        ${bySubtype.other.length}`);
console.log("");

// ---- 判定 ----
const EXPECTED_BACKUP_RANGE = [55, 75]; // 诊断脚本约 65 个备份的容差区间
const inRange =
  matchedBackup.length >= EXPECTED_BACKUP_RANGE[0] &&
  matchedBackup.length <= EXPECTED_BACKUP_RANGE[1];
const noFalseNeg = falseNegatives.length === 0;
const noFalsePos = falsePositives.length === 0;
const noJsonTail = suspiciousJsonTail.length === 0;

console.log("========================================");
console.log(" 判定");
console.log("========================================");
console.log(`识别数 ${matchedBackup.length} 在期望区间 [${EXPECTED_BACKUP_RANGE[0]}, ${EXPECTED_BACKUP_RANGE[1]}](约65): ${inRange ? "PASS" : "FAIL"}`);
console.log(`无明显假阴性: ${noFalseNeg ? "PASS" : "FAIL"}`);
console.log(`无明显假阳性(studio-workflow-store.json 等未误匹配): ${noFalsePos ? "PASS" : "FAIL"}`);
console.log(`无"backup 但以 .json 结尾"的吞尾错误: ${noJsonTail ? "PASS" : "FAIL"}`);
console.log("");
const passed = inRange && noFalseNeg && noFalsePos && noJsonTail;
console.log(`总体 PASSED: ${passed}`);
process.exit(passed ? 0 : 1);
