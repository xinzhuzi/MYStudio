/** Extract the first frame from a video file as a PNG using FFmpeg. */

import { execFileSync } from "node:child_process";

/**
 * Extract the first frame of `videoPath` to `outputPath` as a PNG.
 * @param ffmpegPath Absolute path to the FFmpeg binary.
 * @param videoPath  Absolute path to the source video.
 * @param outputPath Absolute path where the PNG should be written.
 */
export function extractFirstFrame(ffmpegPath: string, videoPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      execFileSync(ffmpegPath, [
        "-y",
        "-i", videoPath,
        "-frames:v", "1",
        "-q:v", "2",
        outputPath,
      ], {
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      });
      resolve();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
