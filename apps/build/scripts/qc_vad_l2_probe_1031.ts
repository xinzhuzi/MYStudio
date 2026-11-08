/**
 * 实际侧真链路探针(1031 · VAD + L2 逐帧 + 三态板,全部用真 runner,不打桩)。
 *
 * 为什么要这件:单测把 ffmpeg/python 都替成了假返回值,「接线正确」不等于
 * 「在本机真片上跑得出数」。本件把三段真活串起来一次:
 *   ① managed Python(设置页装的 silero-vad)→ speech_vad.worker 出语音段;
 *   ② 该段喂 runFfmpegScanLayer(真 ffmpeg 一趟)→ 看 raw.speechSource 是否落 silero-vad;
 *   ③ 把 L2 的 raw/finding 喂三态板 → 打印 unverified 行,验证「没测出来 ≠ 通过」。
 *
 * Usage:
 *   npx vite-node --config build/timeline/vite-node.config.ts \
 *       build/scripts/qc_vad_l2_probe_1031.ts <mp4> [storageBase]
 */
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runFfmpegScanLayer } from "@rendering/plugins/videoqc/chapter-qc-ffmpeg-scan";
import { resolveVadPythonExecutable, runChapterQcVad } from "@rendering/plugins/videoqc/chapter-qc-vad";
import {
  buildChapterQcRequirements,
  summarizeChapterQcRequirements,
} from "@rendering/plugins/videoqc/chapter-qc-verdicts";
import type { ChapterQcLayerId, ChapterQcLayerResultV1 } from "@rendering/plugins/videoqc/chapter-qc-types";
import type { ChapterQcShotSpan } from "@rendering/plugins/videoqc/chapter-qc-timeline";

const [videoPath, storageArg] = process.argv.slice(2);
if (!videoPath) {
  console.error("用法: qc_vad_l2_probe_1031.ts <mp4> [storageBase]");
  process.exit(2);
}
const storageBase = storageArg ?? path.join(homedir(), "Library/Application Support/漫影工作室");
const backendRoot = path.resolve(fileURLToPath(import.meta.url), "../../../backend");

const probe = await qcProbeMediaFor(videoPath);
const vad = await runChapterQcVad({
  videoPath,
  pythonExecutable: resolveVadPythonExecutable(storageBase),
  backendRoot,
});
const spans: ChapterQcShotSpan[] = [{ shotId: "whole", ordinal: 1, startS: 0, endS: probe.durationS, durationS: probe.durationS }];
const scan = await runFfmpegScanLayer({
  videoPath,
  spans,
  durationS: probe.durationS,
  fps: probe.fps,
  ...(vad.available
    ? { vadSpeech: { segments: vad.segments, ...(vad.model ? { model: vad.model } : {}) } }
    : { vadReason: vad.reason ?? "VAD 不可用" }),
});

const layers = Object.fromEntries(
  (["structural", "ffmpegScan", "aesthetic", "semantic", "vision"] as ChapterQcLayerId[]).map((id) => [
    id,
    { status: id === "structural" || id === "ffmpegScan" ? "passed" : "skipped", reason: "探针只跑实际侧" },
  ]),
) as Record<ChapterQcLayerId, ChapterQcLayerResultV1>;
const signals = {
  blacks: scan.raw.blacks,
  freezes: scan.raw.freezes,
  silences: scan.raw.silences,
  ...(scan.raw.loudnessInputI !== undefined ? { loudnessInputI: scan.raw.loudnessInputI } : {}),
  ...(scan.raw.speechSeconds !== undefined ? { speechSeconds: scan.raw.speechSeconds } : {}),
  ...(scan.raw.speechSource ? { speechSource: scan.raw.speechSource } : {}),
  ...(scan.raw.blurMean !== undefined ? { blurMean: scan.raw.blurMean } : {}),
  ...(scan.raw.frameSampleCount !== undefined ? { frameSampleCount: scan.raw.frameSampleCount } : {}),
  frameSampleStep: scan.raw.frameSampleStep,
};
const requirements = buildChapterQcRequirements({ layers, findings: scan.findings, signals });

// 人证行翻转核对:同一份 L2 实测数,只加一条已签的人工复核,应当只翻 human-full-watch。
const signed = buildChapterQcRequirements({
  layers,
  findings: scan.findings,
  signals,
  humanReview: { fullWatched: true, audioListened: true, reviewer: "probe", at: Date.now() },
});
const unsignedPassIds = new Set(requirements.filter((r) => r.verdict === "pass").map((r) => r.requirementId));

console.log(
  JSON.stringify(
    {
      video: videoPath,
      durationS: probe.durationS,
      fps: probe.fps,
      vad: {
        available: vad.available,
        segments: vad.segments.length,
        speechSeconds: vad.speechSeconds,
        model: vad.model,
        reason: vad.reason,
      },
      l2: scan.raw,
      findings: scan.findings.map((f) => ({ code: f.code, severity: f.severity, message: f.message })),
      notes: scan.notes,
      frameSamplePoints: scan.framePoints.length,
      board: summarizeChapterQcRequirements(requirements),
      unverifiedRows: requirements
        .filter((r) => r.verdict === "unverified")
        .map((r) => `${r.requirementId}: ${r.missing ?? r.note ?? ""}`),
      humanReviewFlip: {
        board: summarizeChapterQcRequirements(signed),
        rowsFlippedToPass: signed
          .filter((r) => r.verdict === "pass" && !unsignedPassIds.has(r.requirementId))
          .map((r) => r.requirementId),
      },
    },
    null,
    2,
  ),
);

async function qcProbeMediaFor(file: string): Promise<{ durationS: number; fps: number }> {
  const { qcProbeMedia } = await import("@rendering/plugins/videoqc/chapter-qc-fftools");
  const probed = await qcProbeMedia(file);
  return { durationS: probed.durationS, fps: probed.fps ?? 24 };
}
