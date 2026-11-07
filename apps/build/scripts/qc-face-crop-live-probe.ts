/**
 * 人脸裁片腿真链路探针(1107 吸收件② · 确定性腿)。
 *
 * 单测把 python/ffmpeg 都替成了假返回值,「接线正确」不等于「真片出得出裁片」。
 * 本件在同一批时间点上用生产口径出两套图:
 *   ① runChapterQcFaceCrops(真托管 Python + 真 YuNet)→ 原始分辨率头部裁片;
 *   ② L5 抽帧同款 `-vf scale='min(1280,iw)':-2` → 整帧探针(预审模型实际吃到的字节)。
 * 两套再交给 qc_face_detect_probe_1102.py 量面积占比——「脸占输入多少」就是这条腿买到的东西。
 * 本件不回写 App、不叫多模态模型:判断力那一半要等可用的视觉件,这里只量分辨率收益。
 *
 * Usage:
 *   npx vite-node --config build/timeline/vite-node.config.ts \
 *       build/scripts/qc-face-crop-live-probe.ts <mp4>... [--samples 12] [--out <dir>]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runChapterQcFaceCrops } from "@rendering/plugins/videoqc/chapter-qc-face";
import { resolveVadPythonExecutable } from "@rendering/plugins/videoqc/chapter-qc-vad";

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const videos: string[] = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--")) {
    flags.set(argv[i].slice(2), argv[i + 1] ?? "");
    i += 1;
  } else {
    videos.push(argv[i]);
  }
}
if (videos.length === 0) {
  console.error("用法: qc-face-crop-live-probe.ts <mp4>... [--samples 12] [--out <dir>]");
  process.exit(2);
}
const samples = Number(flags.get("samples") ?? 12);
const outRoot = path.resolve(flags.get("out") ?? path.join("output", "qc-people-1107-absorb", "crop-probe"));
const storageBase = flags.get("storage") ?? path.join(homedir(), "Library/Application Support/漫影工作室");
const backendRoot = path.resolve(fileURLToPath(import.meta.url), "../../../backend");

function run(tool: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${tool} 退出 ${code}:${stderr.slice(-200)}`))));
  });
}

async function probeDurationS(file: string): Promise<number> {
  const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ stdout }) : reject(new Error(`ffprobe 退出 ${code}`))));
  });
  return Number(stdout.trim() || 0);
}

const report: unknown[] = [];
for (const relative of videos) {
  // 侧车 cwd 是 backendRoot,相对路径在那边根本打不开——这里先归一,别让「文件没找到」冒充「这章没脸」
  const video = path.resolve(relative);
  const base = path.basename(video, path.extname(video));
  const framesDir = path.join(outRoot, base, "vision-frames");
  mkdirSync(framesDir, { recursive: true });
  const durationS = await probeDurationS(video);
  // 与 L5 同口径:每格中点取帧,时间点保留三位小数——裁片台账的 index 就是这里的顺序
  const timestamps = Array.from({ length: samples }, (_, i) => Math.round(((i + 0.5) * durationS / samples) * 1000) / 1000);

  for (const [index, tS] of timestamps.entries()) {
    await run("ffmpeg", [
      "-y", "-ss", tS.toFixed(3), "-i", video,
      "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "2",
      path.join(framesDir, `vis-${String(index + 1).padStart(3, "0")}-mid-t${tS.toFixed(1)}.jpg`),
    ]);
  }

  const crops = await runChapterQcFaceCrops({
    videoPath: video,
    pythonExecutable: resolveVadPythonExecutable(storageBase),
    backendRoot,
    timestamps,
    cropsDir: framesDir,
  });
  report.push({
    video,
    durationS,
    samples: timestamps.length,
    timestamps,
    available: crops.available,
    ...(crops.reason ? { reason: crops.reason } : {}),
    crops: crops.crops,
  });
  const produced = crops.crops.filter((crop) => crop.status === "crop");
  console.log(JSON.stringify({
    clip: base,
    available: crops.available,
    requested: timestamps.length,
    crop: produced.length,
    noFace: crops.crops.filter((crop) => crop.status === "no-face").length,
    gaps: crops.crops.filter((crop) => crop.status === "read-failed" || crop.status === "write-failed").length,
    nativeFacePx: produced.map((crop) => crop.faceShortSidePx),
    cropPx: produced.map((crop) => crop.cropPx),
    upscaled: produced.filter((crop) => crop.upscaled).length,
  }));
}
writeFileSync(path.join(outRoot, "crop-probe-report.json"), JSON.stringify({ ranAt: new Date().toISOString(), storageBase, results: report }, null, 2));
console.log(`证据已保存 ${path.join(outRoot, "crop-probe-report.json")};两套 jpg 同在 vision-frames/,可直接喂 qc_face_detect_probe_1102.py 量面积占比。`);
