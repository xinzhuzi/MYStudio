import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TimelineRenderPlan } from "@/types/editing";
import { layoutVisualTimeline } from "@/electron/rendering/plugins/remotion/composition/timing";
import {
  assertRenderedMediaEvidence,
  hashFileSha256,
  probeRenderedMedia,
} from "../remotion/render-smoke-evidence";

const execFileAsync = promisify(execFile);

export interface FormalOutputQcResult {
  outputSha256: string;
  duration: number;
  width: number;
  height: number;
  videoStreamCount: number;
  audioStreamCount: number;
  subtitleStreamCount: number;
  firstSecondSsim: number;
  sourceSamples: Array<{ clipId: string; ssim: number; outputFrame: string; sourceFrame: string }>;
  blackSegments: Array<{ start: number; end: number; duration: number }>;
  ffprobePath: string;
  blackdetectPath: string;
}

export function assertFormalStreamCounts(input: {
  videoStreamCount: number;
  audioStreamCount: number;
  subtitleStreamCount: number;
}): void {
  if (input.videoStreamCount !== 1 || input.audioStreamCount !== 1 || input.subtitleStreamCount !== 0) {
    throw new Error(
      `formal MP4 stream count mismatch: video=${input.videoStreamCount} audio=${input.audioStreamCount} subtitle=${input.subtitleStreamCount}`,
    );
  }
}

export function assertDistinctFirstShots(ssim: number): void {
  if (ssim >= 0.98) throw new Error(`first and second shots appear duplicated: SSIM=${ssim}`);
}

export function assertSourceFrameMatch(clipId: string, ssim: number): void {
  if (ssim < 0.9) throw new Error(`output/source SSIM below 0.90 for ${clipId}: ${ssim}`);
}

export function formalQcSampleIndexes(visualCount: number): number[] {
  if (!Number.isInteger(visualCount) || visualCount < 2) {
    throw new Error("formal QC requires at least two visual clips");
  }
  return [...new Set([0, 1, Math.floor(visualCount / 2), visualCount - 1])];
}

export function expectedFormalDurationSeconds(plan: TimelineRenderPlan): number {
  return formalVisualTimeline(plan).durationInFrames / plan.renderSettings.fps;
}

export async function runFormalOutputQc(input: {
  outputPath: string;
  plan: TimelineRenderPlan;
  sourcePathByClipId: Readonly<Record<string, string>>;
  evidenceDir: string;
  ffmpegExecutable?: string;
}): Promise<FormalOutputQcResult> {
  const ffmpegExecutable = input.ffmpegExecutable ?? "ffmpeg";
  await fs.promises.mkdir(input.evidenceDir, { recursive: true });
  const probe = await probeRenderedMedia(input.outputPath);
  const ffprobePath = path.join(input.evidenceDir, "ffprobe.json");
  await fs.promises.writeFile(ffprobePath, `${JSON.stringify(probe.raw, null, 2)}\n`);
  const visualTimeline = formalVisualTimeline(input.plan);
  const timingByClipId = new Map(visualTimeline.clips.map((timing) => [timing.clipId, timing]));
  const expectedDuration = visualTimeline.durationInFrames / input.plan.renderSettings.fps;
  assertRenderedMediaEvidence({
    label: "formal ChapterVideo ",
    probe,
    expectedDuration,
    fps: input.plan.renderSettings.fps,
    width: input.plan.renderSettings.width,
    height: input.plan.renderSettings.height,
  });
  const streams = probe.raw.streams ?? [];
  const videoStreamCount = streams.filter((stream) => stream.codec_type === "video").length;
  const audioStreamCount = streams.filter((stream) => stream.codec_type === "audio").length;
  const subtitleStreamCount = streams.filter((stream) => stream.codec_type === "subtitle").length;
  assertFormalStreamCounts({ videoStreamCount, audioStreamCount, subtitleStreamCount });

  const visualClips = input.plan.clips
    .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
    .sort(compareTimelineClips);
  if (visualClips.length < 2) throw new Error("formal QC requires at least two visual clips");
  const framesDir = path.join(input.evidenceDir, "frames");
  await fs.promises.mkdir(framesDir, { recursive: true });
  const firstFrame = path.join(framesDir, "boundary-first.png");
  const secondFrame = path.join(framesDir, "boundary-second.png");
  await extractFrame(
    ffmpegExecutable,
    input.outputPath,
    sampleTimeUs(timingByClipId.get(visualClips[0].id)!, input.plan.renderSettings.fps, visualClips[0].durationUs),
    firstFrame,
  );
  await extractFrame(
    ffmpegExecutable,
    input.outputPath,
    sampleTimeUs(timingByClipId.get(visualClips[1].id)!, input.plan.renderSettings.fps, visualClips[1].durationUs),
    secondFrame,
  );
  const firstSecond = await compareFrames(ffmpegExecutable, firstFrame, secondFrame);
  assertDistinctFirstShots(firstSecond.value);
  await fs.promises.writeFile(
    path.join(input.evidenceDir, "first-second-ssim.log"),
    firstSecond.log,
  );

  const sampleIndexes = formalQcSampleIndexes(visualClips.length);
  const sourceSamples = [] as FormalOutputQcResult["sourceSamples"];
  for (const index of sampleIndexes) {
    const clip = visualClips[index];
    const sourcePath = input.sourcePathByClipId[clip.id];
    if (!sourcePath) throw new Error(`missing QC source path for ${clip.id}`);
    const offsetUs = sampleOffsetUs(clip.durationUs);
    const outputFrame = path.join(framesDir, `sample-${index + 1}-output.png`);
    const sourceFrame = path.join(framesDir, `sample-${index + 1}-source.png`);
    const timing = timingByClipId.get(clip.id);
    if (!timing) throw new Error(`missing formal timing for ${clip.id}`);
    await extractFrame(
      ffmpegExecutable,
      input.outputPath,
      sampleTimeUs(timing, input.plan.renderSettings.fps, clip.durationUs),
      outputFrame,
    );
    await extractFrame(ffmpegExecutable, sourcePath, clip.trimStartUs + offsetUs, sourceFrame);
    const comparison = await compareFrames(ffmpegExecutable, outputFrame, sourceFrame);
    await fs.promises.writeFile(
      path.join(input.evidenceDir, `sample-${index + 1}-ssim.log`),
      comparison.log,
    );
    assertSourceFrameMatch(clip.id, comparison.value);
    sourceSamples.push({
      clipId: clip.id,
      ssim: comparison.value,
      outputFrame,
      sourceFrame,
    });
  }

  const blackdetect = await execFileAsync(ffmpegExecutable, [
    "-hide_banner", "-v", "info", "-i", input.outputPath,
    "-vf", "blackdetect=d=0.5:pic_th=0.98", "-an", "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const blackdetectLog = `${blackdetect.stdout ?? ""}\n${blackdetect.stderr ?? ""}`;
  const blackdetectPath = path.join(input.evidenceDir, "blackdetect.log");
  await fs.promises.writeFile(blackdetectPath, blackdetectLog);
  const blackSegments = parseBlackdetect(blackdetectLog);
  if (blackSegments.length > 0) {
    throw new Error(`formal MP4 contains ${blackSegments.length} black segment(s) of at least 0.5s`);
  }

  return {
    outputSha256: await hashFileSha256(input.outputPath),
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    videoStreamCount,
    audioStreamCount,
    subtitleStreamCount,
    firstSecondSsim: firstSecond.value,
    sourceSamples,
    blackSegments,
    ffprobePath,
    blackdetectPath,
  };
}

export function parseSsim(log: string): number {
  const matches = [...log.matchAll(/All:([0-9]+(?:\.[0-9]+)?)/g)];
  const value = Number(matches.at(-1)?.[1]);
  if (!Number.isFinite(value)) throw new Error("FFmpeg SSIM output is missing All score");
  return value;
}

export function parseBlackdetect(log: string): Array<{ start: number; end: number; duration: number }> {
  return [...log.matchAll(/black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g)]
    .map((match) => ({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) }))
    .filter((segment) => segment.duration >= 0.5);
}

async function extractFrame(
  ffmpegExecutable: string,
  inputPath: string,
  timeUs: number,
  outputPath: string,
): Promise<void> {
  await execFileAsync(ffmpegExecutable, [
    "-hide_banner", "-loglevel", "error", "-i", inputPath,
    "-ss", (timeUs / 1_000_000).toFixed(6), "-frames:v", "1", "-y", outputPath,
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

async function compareFrames(
  ffmpegExecutable: string,
  leftPath: string,
  rightPath: string,
): Promise<{ value: number; log: string }> {
  const result = await execFileAsync(ffmpegExecutable, [
    "-hide_banner", "-v", "info", "-i", leftPath, "-i", rightPath,
    "-lavfi", "ssim", "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return { value: parseSsim(log), log };
}

function sampleOffsetUs(durationUs: number): number {
  return Math.max(100_000, Math.min(1_200_000, durationUs - 200_000));
}

function sampleTimeUs(
  timing: { from: number },
  fps: number,
  durationUs: number,
): number {
  return (timing.from / fps) * 1_000_000 + sampleOffsetUs(durationUs);
}

function formalVisualTimeline(plan: TimelineRenderPlan) {
  const visualClips = plan.clips
    .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
    .sort(compareTimelineClips);
  return layoutVisualTimeline(
    visualClips.map((clip) => ({ clipId: clip.id, durationUs: clip.durationUs })),
    plan.transitions.map((transition) => ({
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      effectId: transition.effectId,
      durationUs: transition.durationUs,
    })),
    plan.renderSettings.fps,
  );
}

function compareTimelineClips(
  left: TimelineRenderPlan["clips"][number],
  right: TimelineRenderPlan["clips"][number],
): number {
  return left.startUs - right.startUs || left.id.localeCompare(right.id);
}
