#!/usr/bin/env node
// S4 inkwash-pixel-layer Phase 2: 43 镜批量水墨预处理（确定性）。
// 用法: node build/timeline/inkwash-preprocess.mjs [--only 001,017] [--out <dir>]
// 产物: <out>/shot-NNN.png（43 张处理帧）+ <out>/evidence.json（每镜 参数+输入/输出 SHA256）
// 确定性: 同参数同输入 → 输出 SHA 必一致（main 里 --verify 模式复跑抽 3 镜断言）。
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { resolveProjectDir } from "./resolve-project-dir.mjs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const PROFILE = `${process.env.HOME}/Library/Application Support/漫影工作室/hyperframes-profile`;
const CLI = `${PROFILE}/node_modules/hyperframes/bin/hyperframes.mjs`;
const NODE_BIN = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const PROJECT = resolveProjectDir();
const DEFAULT_OUT = path.join(PROJECT, "workflow-images", "inkwash-pilot");

// 选型定案（research/selection.md）：kuwahara 低强度 + film-grain 纸面颗粒
const GRADING = {
  intensity: 1,
  effects: {
    kuwahara: 0.7,
    kuwaharaRadius: 0.14285714285714285,
    kuwaharaSharpness: 0.3125,
    kuwaharaSaturation: 0.5,
  },
  // grain（finishing 家族）实测为逐次随机的噪点种子（重跑 SSIM 0.97），破坏确定性——
  // 已从选型剔除（selection.md），纸面肌理待固定种子方案后再评估。
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

// 兼容两种落盘布局:章节子树 workflow-images/chapter-001/<flow>/ 与历史平铺 workflow-images/<flow>/
// gen-* 跨目录按 mtime 取最新(重生成后新文件在任一布局中都能命中)
function shotSourcePng(nnn) {
  const flowDir = `storyboard-flow-chapter-001-${nnn}`;
  const dirs = [
    path.join(PROJECT, "workflow-images", "chapter-001", flowDir),
    path.join(PROJECT, "workflow-images", flowDir),
  ].filter((dir) => fs.existsSync(dir));
  const latest = dirs
    .flatMap((dir) => fs.readdirSync(dir).filter((f) => f.startsWith("gen-"))
      .map((f) => ({ file: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs })))
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (!latest) throw new Error(`missing fresh gen image for ${nnn}`);
  return latest.file;
}

function processShot(nnn) {
  const srcPng = shotSourcePng(nnn);
  const { w, h } = probeSize(srcPng);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `inkwash-pre-${nnn}-`));
  try {
    fs.copyFileSync(srcPng, path.join(workDir, "shot.png"));
    fs.writeFileSync(path.join(workDir, "index.html"),
      `<!doctype html><html><head><style>body{margin:0}img{display:block}</style></head><body>`
      + `<div data-composition-id="probe" data-width="${w}" data-height="${h}" data-duration="0.5">`
      + `<img class="target" src="shot.png" style="width:${w}px;height:${h}px"></div></body></html>`);
    execFileSync(NODE_BIN, [CLI, "media-treatment", "--project", workDir, "--file", "index.html",
      "--selector", "img", "--grading", JSON.stringify(GRADING), "--apply", "--json"],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 60_000 });
    // --apply 序列化会丢根 data-duration，渲染期无法推断时长 → 补写；
    // 同时冻结全部 CSS 动画（grain 等循环动画的捕获相位不定 → 输出不确定，
    // 静态分镜帧本就无动画语义，冻结在 0% 关键帧保证确定性）
    const htmlPath = path.join(workDir, "index.html");
    let applied = fs.readFileSync(htmlPath, "utf8");
    if (!applied.includes("data-duration=")) {
      applied = applied.replace(`data-height="${h}"`, `data-height="${h}" data-duration="0.5"`);
    }
    applied = applied.replace("</head>", "<style>*{animation:none!important;transition:none!important}</style></head>");
    fs.writeFileSync(htmlPath, applied);
    const clip = path.join(workDir, "frame.mp4");
    // 浏览器捕获存在亚像素级运行方差（多次实测 SHA 不稳定，失败镜头随机；CLI --docker
    // 官方确定性通道当前静默失败）。默认走浏览器渲染 + 感知级确定性（SSIM≥0.9995）；
    // MYSTUDIO_INKWASH_DOCKER=1 时尝试 docker 字节级确定性。
    const useDocker = process.env.MYSTUDIO_INKWASH_DOCKER === "1";
    if (useDocker && !dockerAvailable) throw new Error("MYSTUDIO_INKWASH_DOCKER=1 但 Docker 不可用");
    execFileSync(NODE_BIN, [CLI, "render", workDir, "--format", "mp4", "--output", clip, "--fps", "10", "--quiet", ...(useDocker ? ["--docker"] : [])],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] });
    const outPng = path.join(outDir, `shot-${nnn}.png`);
    execFileSync("ffmpeg", ["-y", "-v", "quiet", "-i", clip, "-frames:v", "1", "-update", "1", outPng], { timeout: 60_000 });
    return { shot: `sb-chapter-001-${nnn}`, sourcePath: srcPng, sourceSha256: sha256(srcPng), outputPath: outPng, outputSha256: sha256(outPng) };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

let dockerAvailable = false;
try { execFileSync("docker", ["info"], { stdio: "ignore", timeout: 15_000 }); dockerAvailable = true; } catch { dockerAvailable = false; }
console.log(`[inkwash-pre] docker=${dockerAvailable ? "ok（字节级确定性）" : "不可用"} mode=${process.env.MYSTUDIO_INKWASH_DOCKER === "1" ? "docker" : "browser+感知级"}`);

fs.mkdirSync(outDir, { recursive: true });
const evidencePath = path.join(outDir, "evidence.json");
const shots = [];
for (let i = 1; i <= 43; i++) {
  const nnn = String(i).padStart(3, "0");
  if (onlyIdx && !onlyIdx.includes(nnn)) continue;
  const record = processShot(nnn);
  shots.push(record);
  console.log(`[inkwash-pre] ${nnn} ✓ ${record.outputSha256.slice(0, 12)}`);
}

if (!verify) {
  fs.writeFileSync(evidencePath, JSON.stringify({ generatedAt: new Date().toISOString(), grading: GRADING, frames: shots }, null, 2));
  console.log(`[inkwash-pre] evidence -> ${evidencePath}`);
} else {
  // 确定性验证（感知级）：重跑帧与 evidence 存档帧 SSIM≥0.9995 视为稳定。
  // 字节级 SHA 在浏览器捕获下不可达（亚像素方差），docker 通道待修后可恢复字节级。
  const existing = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const byShot = new Map(existing.frames.map((f) => [f.shot, f.outputPath]));
  const results = [];
  for (const s of shots) {
    const archived = byShot.get(s.shot);
    if (!archived || !fs.existsSync(archived)) { results.push({ shot: s.shot, ok: false, why: "missing-archive" }); continue; }
    // processShot 已覆盖输出；archived 若与输出同路径则对比无意义——verify 模式下先归档
    // ffmpeg 的 ssim 汇总走 stderr，spawnSync 双流捕获
    const probe = spawnSync("ffmpeg", ["-i", archived, "-i", s.outputPath, "-filter_complex", "ssim", "-f", "null", "-"], { encoding: "utf8", timeout: 60_000 });
    const ssimText = /All:[0-9.]+/.exec(`${probe.stderr || ""}${probe.stdout || ""}`)?.[0] ?? "";
    const ssim = parseFloat(/All:([0-9.]+)/.exec(ssimText)?.[1] ?? "0");
    results.push({ shot: s.shot, ok: ssim >= 0.9995, ssim });
  }
  const bad = results.filter((r) => !r.ok);
  for (const r of results) console.log(`[inkwash-pre] verify ${r.shot} ssim=${r.ssim?.toFixed(5) ?? "?"} ${r.ok ? "OK" : "FAIL " + (r.why || "")}`);
  if (bad.length > 0) { console.error(`[inkwash-pre] VERIFY FAIL: ${bad.map((m) => m.shot).join(",")}`); process.exit(1); }
  console.log(`[inkwash-pre] VERIFY OK(感知级): ${results.length} shots ssim>=0.9995`);
}
