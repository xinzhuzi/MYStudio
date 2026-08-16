#!/usr/bin/env node
// S4 inkwash-pixel-layer Phase 1: 候选 media-treatment 选型 A/B 对比图生成。
// 用法: node build/timeline/inkwash-candidates.mjs
// 产物: .trellis/tasks/08-15-inkwash-pixel-layer/research/selection-AB-{shot}.png + selection-params.json
// 每个代表镜产出 1 行对比图: 原图 + 6 个候选处理帧（hyperframes media-treatment --apply 渲染单帧）。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { resolveProjectDir } from "./resolve-project-dir.mjs";
import path from "node:path";
import os from "node:os";

const PROFILE = `${process.env.HOME}/Library/Application Support/漫影工作室/hyperframes-profile`;
const CLI = `${PROFILE}/node_modules/hyperframes/bin/hyperframes.mjs`;
// ELECTRON_RUN_AS_NODE: 应用二进制兼作 Node 运行时（与 hyperframes worker 同模式）
const NODE_BIN = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const PROJECT = resolveProjectDir();
const OUT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../.trellis/tasks/08-15-inkwash-pixel-layer/research");

// 代表镜: 近景动作 / 中景叙事 / 远景空镜
const SHOTS = [
  { id: "sb-chapter-001-001", label: "S01-动作近景" },
  { id: "sb-chapter-001-017", label: "S17-中景叙事" },
  { id: "sb-chapter-001-033", label: "S33-学堂群像" },
];

const CANDIDATES = [
  { key: "kuwahara", label: "kuwahara油画", grading: { effects: { kuwahara: 1, kuwaharaRadius: 0.14285714285714285, kuwaharaSharpness: 0.3125, kuwaharaSaturation: 0.5 } } },
  { key: "crosshatch", label: "crosshatch排线", grading: { effects: { crosshatch: 1, crosshatchSpacing: 0.28, crosshatchThickness: 0.25, crosshatchAngle: 0.25, crosshatchContrast: 0.3333333333333333, crosshatchEdges: 0.5, crosshatchLineWeight: 0, crosshatchWave: 0.33, crosshatchWaveFrequency: 0.2222222222222222 } } },
  { key: "crosshatch-inkpaper", label: "排线+墨纸调色板", grading: { palette: ["#1a1a2e", "#f5f5dc"], effects: { crosshatch: 1, crosshatchSpacing: 0.28, crosshatchThickness: 0.25, crosshatchAngle: 0.25, crosshatchContrast: 0.3333333333333333, crosshatchEdges: 0.5, crosshatchLineWeight: 0, crosshatchWave: 0.33, crosshatchWaveFrequency: 0.2222222222222222 } } },
  { key: "halftone", label: "halftone网点", grading: { effects: { halftone: 0.94, halftoneSize: 0.36 } } },
  { key: "twoInkPrint", label: "twoInkPrint双墨", grading: { effects: { twoInkPrint: 1, twoInkPrintSize: 0.42 } } },
  { key: "engraving", label: "engraving雕版", grading: { effects: { engraving: 1, engravingSpacing: 0.4117647058822529, engravingMinThickness: 0.2, engravingMaxThickness: 0.4571428571428572, engravingAngle: 0.25, engravingContrast: 0.4666666666666667, engravingSharpness: 0.59, engravingWave: 0.2, engravingWaveFrequency: 0.2222222222222222 } } },
];

// 兼容两种落盘布局:章节子树 workflow-images/chapter-001/<flow>/ 与历史平铺 workflow-images/<flow>/
// gen-* 跨目录按 mtime 取最新(重生成后新文件在任一布局中都能命中)
function shotSourcePng(shotId) {
  const flowDir = `storyboard-flow-chapter-001-${shotId.slice(-3)}`;
  const dirs = [
    path.join(PROJECT, "workflow-images", "chapter-001", flowDir),
    path.join(PROJECT, "workflow-images", flowDir),
  ].filter((dir) => fs.existsSync(dir));
  const latest = dirs
    .flatMap((dir) => fs.readdirSync(dir).filter((f) => f.startsWith("gen-"))
      .map((f) => ({ file: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs })))
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (!latest) throw new Error(`missing fresh gen image for ${shotId}`);
  return latest.file;
}

function probeSize(png) {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", png], { encoding: "utf8" });
  const w = Number(/pixelWidth: (\d+)/.exec(out)?.[1]);
  const h = Number(/pixelHeight: (\d+)/.exec(out)?.[1]);
  return { w, h };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const paramsRecord = { generatedAt: new Date().toISOString(), candidates: CANDIDATES, shots: SHOTS, frames: {} };

for (const shot of SHOTS) {
  const srcPng = shotSourcePng(shot.id);
  const { w, h } = probeSize(srcPng);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwash-candidates-"));
  const frames = [`原帧|${srcPng}`];
  for (const candidate of CANDIDATES) {
    const projectDir = path.join(workDir, candidate.key);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.copyFileSync(srcPng, path.join(projectDir, "shot.png"));
    fs.writeFileSync(path.join(projectDir, "index.html"),
      `<!doctype html><html><head><style>body{margin:0}img{display:block}</style></head><body>`
      + `<div data-composition-id="probe" data-width="${w}" data-height="${h}" data-duration="0.1">`
      + `<img class="target" src="shot.png" style="width:${w}px;height:${h}px"></div></body></html>`);
    const gradingJson = JSON.stringify(candidate.grading);
    // --dry-run 先验参数合法性，再 --apply 落 CSS 变量，最后渲染 1 帧 PNG
    try {
      execFileSync(NODE_BIN, [CLI, "media-treatment", "--project", projectDir, "--file", "index.html",
        "--selector", "img", "--grading", gradingJson, "--apply", "--json"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      console.error(`[inkwash] apply 失败 ${candidate.key}: status=${error.status} stderr=${String(error.stderr || "").slice(0, 800)}`);
      throw error;
    }
    // --apply 的序列化会丢根元素 data-duration（渲染期无法推断时长），apply 后补写
    const htmlPath = path.join(projectDir, "index.html");
    const applied = fs.readFileSync(htmlPath, "utf8");
    if (!applied.includes("data-duration=")) {
      fs.writeFileSync(htmlPath, applied.replace(`data-height="${h}"`, `data-height="${h}" data-duration="0.5"`));
    }
    // 组合时长 0.1s@10fps = 1 帧：渲染单帧 mp4 再抽 PNG
    const clip = path.join(projectDir, "frame.mp4");
    try {
      execFileSync(NODE_BIN, [CLI, "render", projectDir, "--format", "mp4", "--output", clip, "--fps", "10", "--quiet"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      console.error(`[inkwash] render 失败 ${candidate.key}: status=${error.status}`);
      console.error(String(error.stderr || error.stdout || error.message).slice(0, 1200));
      throw error;
    }
    const frame = path.join(projectDir, "frame.png");
    execFileSync("ffmpeg", ["-y", "-v", "quiet", "-i", clip, "-frames:v", "1", frame], { timeout: 60_000 });
    frames.push(`${candidate.label}|${frame}`);
    console.log(`[inkwash] ${shot.label} ${candidate.label} ✓`);
  }
  // 横向拼板: 原帧 + 6 候选，每帧缩到 480 宽
  const inputs = frames.map((entry) => entry.split("|")[1]);
  const out = path.join(OUT_DIR, `selection-AB-${shot.id}.png`);
  const filter = inputs.map((_, i) => `[${i}:v]scale=480:-1[v${i}]`).join(";")
    + ";" + inputs.map((_, i) => `[v${i}]`).join("") + `hstack=inputs=${inputs.length}[out]`;
  execFileSync("ffmpeg", ["-y", "-v", "quiet", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", out], { timeout: 60_000 });
  paramsRecord.frames[shot.id] = { sheet: out, columns: frames.map((entry) => entry.split("|")[0]) };
  console.log(`[inkwash] sheet -> ${out}`);
  fs.rmSync(workDir, { recursive: true, force: true });
}
fs.writeFileSync(path.join(OUT_DIR, "selection-params.json"), JSON.stringify(paramsRecord, null, 2));
console.log("[inkwash] params -> selection-params.json");
