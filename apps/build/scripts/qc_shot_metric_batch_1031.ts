/**
 * 镜级信号基线批扫(1031 · 给「阈值先记不判」攒标定分布,只记录不出判据)。
 *
 * 为什么要这件:`real-motion` 行的 pass/fail 线要拿真镜攒出来,而 `qc_vad_l2_probe_1031.ts`
 * 一次只吃一支片;逐条手跑既慢又容易各家口径不一。本件的数字直接取 L2 已产的
 * `chapter-qc.motion.summary` evidence,不在脚本里重算 TI/静止占比/blur——
 * 两侧共用一份口径才谈得上并列比较(§九.六「同口径才并列」)。
 *
 * 批不过去判:这里只出分位与极值。线画在哪仍要人裁定(反过度声称:分布 ≠ 合格线)。
 *
 * Usage:
 *   npx vite-node --config build/timeline/vite-node.config.ts \
 *       build/scripts/qc_shot_metric_batch_1031.ts <mp4|目录>... [--vad]
 * 目录只展开该层 `*.mp4`(不递归,免得把整棵 output 树一次吞了);
 * `--vad` 顺带跑 Silero VAD 并把 speechSource 落进表(单镜基线用不到语音,默认跳过省一趟)。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { qcProbeMedia } from "@rendering/plugins/videoqc/chapter-qc-fftools";
import { runFfmpegScanLayer, type ChapterQcFfmpegScanInput } from "@rendering/plugins/videoqc/chapter-qc-ffmpeg-scan";
import { resolveVadPythonExecutable, runChapterQcVad } from "@rendering/plugins/videoqc/chapter-qc-vad";
import type { ChapterQcShotSpan } from "@rendering/plugins/videoqc/chapter-qc-timeline";

const MOTION_SUMMARY = "chapter-qc.motion.summary";
const backendRoot = path.resolve(fileURLToPath(import.meta.url), "../../../backend");
const storageBase = path.join(process.env.HOME ?? "", "Library/Application Support/漫影工作室");

const argv = process.argv.slice(2);
const withVad = argv.includes("--vad");
const targets = argv.filter((arg) => !arg.startsWith("--"));
if (targets.length === 0) {
  console.error("用法: qc_shot_metric_batch_1031.ts <mp4|目录>... [--vad]");
  process.exit(2);
}

const files = expandTargets(targets).sort();
if (files.length === 0) {
  console.error("没有可扫的 mp4");
  process.exit(2);
}

interface Row {
  tier: string;
  file: string;
  durationS: number;
  fps: number;
  speechSource?: string;
  [key: string]: unknown;
}

const rows: Row[] = [];
for (const file of files) {
  const probed = await qcProbeMedia(file);
  const durationS = probed.durationS;
  const fps = probed.fps ?? 24;
  const spans: ChapterQcShotSpan[] = [{ shotId: path.basename(file, ".mp4"), ordinal: 1, startS: 0, endS: durationS, durationS }];
  const input = { videoPath: file, spans, durationS, fps };
  const scan = await runFfmpegScanLayer({ ...input, ...(withVad ? await vadArgsFor(file) : {}) });
  const summary = scan.findings.find((finding) => finding.code === MOTION_SUMMARY);
  rows.push({
    tier: path.basename(path.dirname(file)),
    file,
    durationS: Number(durationS.toFixed(3)),
    fps,
    ...(scan.raw.speechSource ? { speechSource: scan.raw.speechSource } : {}),
    ...(summary?.evidence ?? {}),
    blacks: scan.raw.blacks,
    freezes: scan.raw.freezes,
    silences: scan.raw.silences,
    ...(scan.raw.loudnessInputI !== undefined ? { loudnessInputI: scan.raw.loudnessInputI } : {}),
    frameSampleStep: scan.raw.frameSampleStep,
  });
  console.error(`已扫 ${rows.length}/${files.length}: ${file}`);
}

console.log(JSON.stringify(rows, null, 2));
console.error("\n按 tier 汇总(中位/最小/最大;分布 ≠ 合格线):");
for (const tier of [...new Set(rows.map((row) => row.tier))].sort()) {
  const group = rows.filter((row) => row.tier === tier);
  console.error(
    `  ${tier} n=${group.length} ` +
      ["tiMean", "staticFrameRatio", "blurMean", "scdetMax", "loudnessInputI"]
        .map((key) => `${key}=${formatSpread(group.map((row) => numberAt(row, key)))}`)
        .join(" "),
  );
}

function numberAt(row: Row, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatSpread(values: Array<number | undefined>): string {
  const nums = values.filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  if (nums.length === 0) return "NA";
  const pick = (q: number) => nums[Math.min(nums.length - 1, Math.floor((nums.length - 1) * q))];
  return `${pick(0.5).toFixed(3)}/${nums[0]!.toFixed(3)}/${nums[nums.length - 1]!.toFixed(3)}`;
}

async function vadArgsFor(file: string): Promise<Pick<ChapterQcFfmpegScanInput, "vadSpeech" | "vadReason">> {
  const vad = await runChapterQcVad({ videoPath: file, pythonExecutable: resolveVadPythonExecutable(storageBase), backendRoot });
  return vad.available
    ? { vadSpeech: { segments: vad.segments, ...(vad.model ? { model: vad.model } : {}) } }
    : { vadReason: vad.reason ?? "VAD 不可用" };
}

function expandTargets(args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (!existsSync(arg)) {
      console.error(`跳过不存在的路径: ${arg}`);
      continue;
    }
    if (statSync(arg).isDirectory()) out.push(...readdirSync(arg).filter((name) => name.endsWith(".mp4")).map((name) => path.join(arg, name)));
    else out.push(arg);
  }
  return out;
}
