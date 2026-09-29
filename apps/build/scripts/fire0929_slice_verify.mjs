#!/usr/bin/env node
/**
 * 实弹验收 0929 — 引擎日志切片独立复验器(修正过滤器):
 * 驱动 v2 内嵌过滤器漏抓「Model storage policy」形态加载行(驱动进程已载入旧码,无法热改),
 * 本器对已落盘的两份切片用修正过滤器重跑加载行/进度行/executed 行断言,作为上报真源。
 * 用法:node apps/build/scripts/fire0929_slice_verify.mjs
 */
import { readFileSync } from "node:fs";

const OUT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/output`;
const SLICES = [
  ["i2i", `${OUT_DIR}/fire0929-i2i-engine-slice.log`],
  ["edit", `${OUT_DIR}/fire0929-edit-engine-slice.log`],
];

const clean = (l) => l.replace(/\x1b\[[0-9;]*m/g, "");
let allPass = true;
for (const [tag, path] of SLICES) {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { console.log(`${tag}: 切片缺失 ${path}`); allPass = false; continue; }
  const lines = text.split("\n").map(clean);
  // 权重加载行:带模型文件名;排除 [MY出图] 侧车摘要(静态全图枚举)与 custom_nodes 导入行
  const loadLines = lines.filter((l) => /\.safetensors|\.gguf/i.test(l) && !/\[MY出图\]/.test(l) && !/custom_nodes/.test(l));
  const hereticLoad = loadLines.filter((l) => /heretic/i.test(l));
  const peLoad = loadLines.filter((l) => /pe_i2i/i.test(l));
  const ditLoad = loadLines.filter((l) => /qwen_image_2\.1_bf16/i.test(l));
  const viggleLoad = loadLines.filter((l) => /viggle/i.test(l));
  const funAccLoad = loadLines.filter((l) => /Fun-Acc/i.test(l));
  const tqdm40 = lines.filter((l) => /\b40\/40\b/.test(l));
  const executedLines = lines.filter((l) => /Prompt executed in/.test(l));
  const tqdmOther = lines.filter((l) => /\b(359\/359|4\/4)\b/.test(l));
  const checks = [
    ["heretic TE 加载行≥1", hereticLoad.length >= 1, heriticJoin(hereticLoad)],
    ["PE TE(pe_i2i)加载行≥1", peLoad.length >= 1, heriticJoin(peLoad)],
    ["DiT(qwen_image_2.1_bf16)加载行≥1", ditLoad.length >= 1, heriticJoin(ditLoad)],
    ["viggle LoRA 零加载", viggleLoad.length === 0, heriticJoin(viggleLoad)],
    ["Fun-Acc LoRA 零加载", funAccLoad.length === 0, heriticJoin(funAccLoad)],
    ["采样进度 40/40 在场", tqdm40.length >= 1, heriticJoin(tqdm40, 1)],
    ["无 359/359 或 4/4 进度(懒支路未采样)", tqdmOther.length === 0, heriticJoin(tqdmOther, 2)],
    ["Prompt executed 行≥1", executedLines.length >= 1, executedLines.join(" | ").slice(0, 200)],
  ];
  console.log(`════ ${tag}(切片 ${path}) ════`);
  for (const [name, pass, detail] of checks) {
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
    if (!pass) allPass = false;
  }
}
function heriticJoin(arr, n = 2) {
  return (arr.slice(0, n).map((l) => l.trim().slice(0, 170)).join(" ; ")) || "(无)";
}
console.log(allPass ? "切片复验:全绿" : "切片复验:存在失败项");
process.exit(allPass ? 0 : 1);
