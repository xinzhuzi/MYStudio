// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runTimelineAudioPostProcess } from "./timeline-audio-postprocess";

describe("timeline audio post-process", () => {
  it("runs loudnorm with stream-copy video and records a post-process log", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-audio-postprocess-"));
    const rawInputPath = path.join(root, "raw-remotion.mp4");
    const outputPath = path.join(root, "output.mp4");
    const logPath = path.join(root, "audio-postprocess.log");
    fs.writeFileSync(rawInputPath, "raw", "utf8");
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    try {
      const evidence = await runTimelineAudioPostProcess(
        { rawInputPath, outputPath, logPath, loudnessLufs: -14, truePeakDbtp: -1.5 },
        async (file, args) => {
          calls.push({ file, args });
          fs.writeFileSync(outputPath, "final", "utf8");
          return { stdout: "stdout", stderr: "stderr" };
        },
      );
      expect(calls[0]).toEqual({
        file: "ffmpeg",
        args: expect.arrayContaining([
          "-c:v", "copy",
          "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
          "-ar", "48000",
          "-b:a", "192k",
          "-shortest",
        ]),
      });
      expect(evidence).toEqual({
        engine: "ffmpeg",
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
        logPath,
      });
      expect(fs.readFileSync(logPath, "utf8")).toContain("stderr");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects relative paths before invoking ffmpeg", async () => {
    await expect(runTimelineAudioPostProcess({
      rawInputPath: "raw.mp4",
      outputPath: "/tmp/output.mp4",
      logPath: "/tmp/postprocess.log",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    }, async () => ({ stdout: "", stderr: "" }))).rejects.toThrow("绝对路径");
  });

  it("keeps a diagnostic log when ffmpeg post-processing fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-audio-postprocess-failure-"));
    const logPath = path.join(root, "audio-postprocess.log");
    try {
      await expect(runTimelineAudioPostProcess({
        rawInputPath: path.join(root, "raw.mp4"),
        outputPath: path.join(root, "output.mp4"),
        logPath,
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      }, async () => {
        const error = new Error("ffmpeg failed") as Error & { stderr?: string };
        error.stderr = "loudnorm diagnostic";
        throw error;
      })).rejects.toThrow("ffmpeg failed");
      expect(fs.readFileSync(logPath, "utf8")).toContain("loudnorm diagnostic");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("produces a valid MP4 when loudnorm rejects a very short silent AAC track", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-audio-postprocess-silence-"));
    const rawInputPath = path.join(root, "raw-remotion.mp4");
    const outputPath = path.join(root, "output.mp4");
    const logPath = path.join(root, "audio-postprocess.log");
    try {
      createShortSilentMp4(rawInputPath);
      await runTimelineAudioPostProcess({
        rawInputPath,
        outputPath,
        logPath,
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      });

      const probe = spawnSync("ffprobe", [
        "-v", "error",
        "-show_entries", "stream=codec_type,codec_name",
        "-of", "json",
        outputPath,
      ], { encoding: "utf8" });
      expect(probe.status, probe.stderr).toBe(0);
      const streams = JSON.parse(probe.stdout).streams as Array<{ codec_type: string; codec_name: string }>;
      expect(streams).toEqual(expect.arrayContaining([
        expect.objectContaining({ codec_type: "video", codec_name: "h264" }),
        expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
      ]));
      expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
      expect(fs.readFileSync(logPath, "utf8")).toContain("fallback=anull");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function createShortSilentMp4(outputPath: string): void {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=0.2",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-t", "0.26",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", "-y", outputPath,
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`无法创建短静音 MP4 fixture: ${result.stderr || `exit ${result.status}`}`);
  }
}
