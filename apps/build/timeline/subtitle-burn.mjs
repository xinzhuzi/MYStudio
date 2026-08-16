#!/usr/bin/env node
// 字幕烧帧（source-embedded 语义落地）：在 inkwash 预处理帧上以 drawtext 烧入台词。
// 背景: 生成图 prompt 从不含台词（新旧两代皆然），source-embedded 的 authority 声明
// 长期与画面事实不符——本脚本让"画面自带字幕"成立。在 kuwahara 之后烧字保证字形锐利。
// 用法: node build/timeline/subtitle-burn.mjs [--only 001,017] [--out <dir>] [--verify]
// 产物: <out>/shot-NNN.png + <out>/evidence.json（每镜 折行/参数/输入输出 SHA256）
// 确定性: 纯 ffmpeg drawtext（无浏览器捕获）→ 字节级确定，--verify 用 SHA 复核。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { resolveProjectDir } from "./resolve-project-dir.mjs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const PROJECT = resolveProjectDir();
const FRAMES_DIR = path.join(PROJECT, "workflow-images", "inkwash-pilot");
const DEFAULT_OUT = path.join(PROJECT, "workflow-images", "subtitle-burn");
const FONT = "/System/Library/Fonts/PingFang.ttc";

// 横版 ~16:9（实测 fanren 帧 1672×941 → 成片 1920×1080 近无损全幅）
const STYLE = {
  fontfile: FONT,
  fontsize: 54,
  fontcolor: "white",
  borderw: 5,
  bordercolor: "black",
  shadowcolor: "black@0.45",
  shadowx: 2,
  shadowy: 3,
  maxCharsPerLine: 22,
  maxLines: 2,
  lineGap: 78, // 字高 ×1.44
  bottomMargin: 110, // 末行文字框底边距帧底
};

const argv = process.argv.slice(2);
const onlyIdx = argv.includes("--only") ? argv[argv.indexOf("--only") + 1]?.split(",") : null;
const outDir = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : DEFAULT_OUT;
const verify = argv.includes("--verify");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function probeSize(png) {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", png], { encoding: "utf8" });
  return {
    w: Number(/pixelWidth: (\d+)/.exec(out)?.[1]),
    h: Number(/pixelHeight: (\d+)/.exec(out)?.[1]),
  };
}

// 中文折行：优先在标点后断行，退化为任意位置硬断；台词均为短句（≤44 字）。
function wrapLine(text) {
  const chars = [...text];
  if (chars.length <= STYLE.maxCharsPerLine) return [text];
  const breakAfter = new Set("，。！？；：、…—,.!?;: ");
  const lines = [];
  let rest = chars;
  while (lines.length < STYLE.maxLines - 1 && rest.length > STYLE.maxCharsPerLine) {
    let cut = -1;
    for (let i = STYLE.maxCharsPerLine; i >= Math.ceil(STYLE.maxCharsPerLine * 0.6); i--) {
      if (breakAfter.has(rest[i - 1] ?? "")) { cut = i; break; }
    }
    if (cut < 0) cut = STYLE.maxCharsPerLine;
    lines.push(rest.slice(0, cut).join("").trim());
    rest = rest.slice(cut);
  }
  lines.push(rest.join("").trim());
  return lines.filter((l) => l.length > 0);
}

const store = JSON.parse(fs.readFileSync(path.join(PROJECT, "studio-workflow-store.json"), "utf8"));
const storyboards = store.state.storyboards
  .filter((b) => b.episodeId === "chapter-001")
  .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
if (storyboards.length === 0) throw new Error("store 中无 chapter-001 分镜");

function burnShot(sb) {
  const nnn = /-(\d{3})$/.exec(sb.id)?.[1];
  if (!nnn) throw new Error(`分镜 id 无镜号后缀: ${sb.id}`);
  const srcPng = path.join(FRAMES_DIR, `shot-${nnn}.png`);
  if (!fs.existsSync(srcPng)) throw new Error(`缺 inkwash 帧: ${srcPng}`);
  const text = String(sb.line ?? "").trim();
  const outPng = path.join(outDir, `shot-${nnn}.png`);
  const { h } = probeSize(srcPng);
  if (!text) {
    fs.copyFileSync(srcPng, outPng);
    return { shot: sb.id, index: sb.index, line: "", lines: [], skippedNoText: true, sourceSha256: sha256(srcPng), outputSha256: sha256(outPng) };
  }
  const lines = wrapLine(text);
  if (lines.length > STYLE.maxLines) throw new Error(`${sb.id} 台词超两行: ${text}`);
  // 文本走 textfile（规避 drawtext 转义：引号/冒号/百分号）
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `subtitle-burn-${nnn}-`));
  try {
    const filters = lines.map((line, i) => {
      const txtFile = path.join(workDir, `line-${i}.txt`);
      fs.writeFileSync(txtFile, line);
      const y = h - STYLE.bottomMargin - STYLE.fontsize - (lines.length - 1 - i) * STYLE.lineGap;
      const opts = Object.entries({ ...STYLE, maxCharsPerLine: undefined, maxLines: undefined, lineGap: undefined, bottomMargin: undefined })
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .concat([`textfile=${txtFile}`, `x=(w-text_w)/2`, `y=${y}`])
        .join(":");
      return `drawtext=${opts}`;
    });
    execFileSync("ffmpeg", ["-y", "-v", "quiet", "-i", srcPng, "-vf", filters.join(","), "-frames:v", "1", "-update", "1", outPng], { timeout: 60_000 });
    return { shot: sb.id, index: sb.index, line: text, lines, sourceSha256: sha256(srcPng), outputSha256: sha256(outPng) };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

fs.mkdirSync(outDir, { recursive: true });
const evidencePath = path.join(outDir, "evidence.json");
const records = [];
for (const sb of storyboards) {
  const nnn = /-(\d{3})$/.exec(sb.id)?.[1];
  if (onlyIdx && !onlyIdx.includes(nnn)) continue;
  const r = burnShot(sb);
  records.push(r);
  console.log(`[subtitle-burn] ${nnn} ${r.skippedNoText ? "跳过(无台词)" : r.lines.length + " 行"} ✓ ${r.outputSha256.slice(0, 12)}`);
}

if (!verify) {
  fs.writeFileSync(evidencePath, JSON.stringify({ generatedAt: new Date().toISOString(), style: STYLE, frames: records }, null, 2));
  console.log(`[subtitle-burn] evidence -> ${evidencePath}`);
} else {
  const existing = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const byShot = new Map(existing.frames.map((f) => [f.shot, f.outputSha256]));
  const bad = records.filter((r) => byShot.get(r.shot) !== r.outputSha256);
  for (const r of records) console.log(`[subtitle-burn] verify ${r.shot} ${byShot.get(r.shot) === r.outputSha256 ? "OK" : "FAIL"}`);
  if (bad.length > 0) { console.error(`[subtitle-burn] VERIFY FAIL: ${bad.map((b) => b.shot).join(",")}`); process.exit(1); }
  console.log(`[subtitle-burn] VERIFY OK(字节级): ${records.length} shots`);
}
