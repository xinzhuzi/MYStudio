import fs from "node:fs";
import path from "node:path";
import { HyperFramesOverlayRequestV1 } from "@rendering/contracts/video-workflow";
import { execFileSync } from "node:child_process";
import { buildHyperFramesCliArgs, buildHyperFramesCompositionHtml } from "./hf-composition";
import { HEAVY_ELEMENT_BUDGET, HyperFramesSegmentWindow, MAX_WINDOWS_PER_COMPOSITION, buildHyperFramesWorkerTemporaryOutputPath, estimateHeavyElementCount, moveValidatedOutput } from "./hf-shared";

/**
 * HyperFrames 分段与输出校验——分段切分/时长断言/alpha 与 PNG 序列校验/渲染执行。file-size-reduction P1 拆出,体逐字保留。
 */
export type HyperFramesRenderSegment = {
  startUs: number;
  durationUs: number;
  windows: HyperFramesSegmentWindow[];
};

export function windowEndUs(window: HyperFramesOverlayRequestV1["windows"][number]): number {
  return window.startUs + window.durationUs;
}

export function toFrameBoundaryUs(timeUs: number, fps: number): number {
  return Math.round((Math.round(timeUs * fps / 1_000_000) * 1_000_000) / fps);
}

/**
 * Partitions the absolute overlay timeline at deterministic window boundaries.
 * Windows crossing a boundary are clipped into both neighbours, preserving
 * their original global timing after the segments are concatenated.
 */
export function splitHyperFramesRenderSegments(request: HyperFramesOverlayRequestV1): HyperFramesRenderSegment[] {
  const totalDurationUs = Math.max(...request.windows.map(windowEndUs));
  if (request.windows.length <= MAX_WINDOWS_PER_COMPOSITION) {
    return [{ startUs: 0, durationUs: totalDurationUs, windows: request.windows }];
  }
  const ordered = [...request.windows].sort((left, right) => (
    left.startUs - right.startUs || left.slotId.localeCompare(right.slotId)
  ));
  const roundedTotalDurationUs = toFrameBoundaryUs(totalDurationUs, request.fps);
  const candidateBoundaries = [...new Set([
    ...ordered.map((window) => toFrameBoundaryUs(window.startUs, request.fps)),
    roundedTotalDurationUs,
  ])].filter((boundaryUs) => boundaryUs > 0 && boundaryUs <= roundedTotalDurationUs).sort((left, right) => left - right);
  const boundaries = [0];
  while (boundaries[boundaries.length - 1] < roundedTotalDurationUs) {
    const startUs = boundaries[boundaries.length - 1];
    let selectedEndUs: number | undefined;
    for (const endUs of candidateBoundaries) {
      if (endUs <= startUs) continue;
      const overlapping = request.windows.filter((window) => window.startUs < endUs && windowEndUs(window) > startUs);
      if (overlapping.length > MAX_WINDOWS_PER_COMPOSITION) continue;
      // heavy 预算(08-22):单窗段豁免——模板自身超重不可再分,交给 strict 兜底。
      const heavySum = overlapping.reduce((sum, window) => sum + estimateHeavyElementCount(window), 0);
      if (overlapping.length > 1 && heavySum > HEAVY_ELEMENT_BUDGET) continue;
      selectedEndUs = endUs;
    }
    if (!selectedEndUs) {
      throw new Error(`HyperFrames 无法在 ${MAX_WINDOWS_PER_COMPOSITION} 个窗口/heavy≤${HEAVY_ELEMENT_BUDGET} 内切分重叠时间轴`);
    }
    boundaries.push(selectedEndUs);
  }
  return boundaries.slice(0, -1).map((startUs, index) => {
    const endUs = boundaries[index + 1];
    const windows = request.windows.flatMap((window) => {
      const clippedStartUs = Math.max(window.startUs, startUs);
      const clippedEndUs = Math.min(windowEndUs(window), endUs);
      if (clippedEndUs <= clippedStartUs) return [];
      return [{
        ...window,
        startUs: clippedStartUs - startUs,
        durationUs: clippedEndUs - clippedStartUs,
        ...(window.startUs < startUs ? { animationOffsetUs: startUs - window.startUs } : {}),
      }];
    });
    if (windows.length > MAX_WINDOWS_PER_COMPOSITION) {
      throw new Error(`HyperFrames 分段 ${index + 1} 包含 ${windows.length} 个窗口，拒绝绕过 strict-all 渲染上限`);
    }
    const segmentHeavy = windows.reduce((sum, window) => sum + estimateHeavyElementCount(window), 0);
    if (windows.length > 1 && segmentHeavy > HEAVY_ELEMENT_BUDGET) {
      throw new Error(`HyperFrames 分段 ${index + 1} heavy 元素 ${segmentHeavy} 超预算 ${HEAVY_ELEMENT_BUDGET}，拒绝绕过 heavy-overlay 熔断`);
    }
    return { startUs, durationUs: endUs - startUs, windows };
  });
}

export function quoteConcatPath(filePath: string): string {
  return `'${filePath.replace(/'/g, "'\\\\''")}'`;
}

export function assertOutputDuration(outputPath: string, expectedDurationUs: number, fps: number): void {
  const ffprobe = process.env.MYSTUDIO_FFPROBE_PATH?.trim() || "ffprobe";
  const raw = execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "json", outputPath], { encoding: "utf8", timeout: 60_000 });
  const parsed = JSON.parse(raw) as { format?: { duration?: string } };
  const actualDurationS = Number(parsed.format?.duration);
  const expectedDurationS = expectedDurationUs / 1_000_000;
  if (!Number.isFinite(actualDurationS) || Math.abs(actualDurationS - expectedDurationS) > 1 / fps) {
    throw new Error(`HyperFrames 输出时长异常: ${actualDurationS}s，期望 ${expectedDurationS}s（容差 1 帧）`);
  }
}

export function assertRenderedAlphaOutput(
  outputPath: string,
  request: HyperFramesOverlayRequestV1,
  expectedDurationUs: number,
): void {
  assertAlphaOutput(outputPath, request.alphaFormat);
  if (request.alphaFormat === "png-sequence") {
    assertPngSequenceOutput(outputPath, request, expectedDurationUs);
    return;
  }
  const ffprobe = process.env.MYSTUDIO_FFPROBE_PATH?.trim() || "ffprobe";
  const raw = execFileSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate", "-of", "json", outputPath], { encoding: "utf8", timeout: 60_000 });
  const parsed = JSON.parse(raw) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; r_frame_rate?: string }> };
  const videoStreams = parsed.streams?.filter((stream) => stream.codec_type === "video") ?? [];
  const audioStreams = parsed.streams?.filter((stream) => stream.codec_type === "audio") ?? [];
  const video = videoStreams[0];
  if (videoStreams.length !== 1 || audioStreams.length !== 0) {
    throw new Error(`HyperFrames 分段必须只包含一个视频流且没有音频（video=${videoStreams.length}, audio=${audioStreams.length}）`);
  }
  const [numerator, denominator] = (video?.r_frame_rate ?? "").split("/").map(Number);
  const actualFps = denominator ? numerator / denominator : Number.NaN;
  if (video?.width !== request.width || video.height !== request.height || !Number.isFinite(actualFps) || Math.abs(actualFps - request.fps) > 0.001) {
    throw new Error(`HyperFrames 输出规格异常: ${video?.width ?? "?"}x${video?.height ?? "?"}@${video?.r_frame_rate ?? "?"}，期望 ${request.width}x${request.height}@${request.fps}`);
  }
  assertOutputDuration(outputPath, expectedDurationUs, request.fps);
}

export function assertPngSequenceOutput(
  outputPath: string,
  request: HyperFramesOverlayRequestV1,
  expectedDurationUs: number,
): void {
  const pngPaths = fs.readdirSync(outputPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => path.join(outputPath, entry.name))
    .sort();
  const expectedFrames = Math.max(1, Math.round(expectedDurationUs * request.fps / 1_000_000));
  if (Math.abs(pngPaths.length - expectedFrames) > 1) {
    throw new Error(`HyperFrames PNG 序列帧数异常: ${pngPaths.length}，期望 ${expectedFrames}（容差 1 帧）`);
  }
  for (const pngPath of pngPaths) {
    const header = Buffer.alloc(26);
    const fd = fs.openSync(pngPath, "r");
    try {
      if (fs.readSync(fd, header, 0, header.length, 0) !== header.length
        || header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
        || header.subarray(12, 16).toString("ascii") !== "IHDR") {
        throw new Error(`HyperFrames PNG 帧格式无效: ${pngPath}`);
      }
    } finally {
      fs.closeSync(fd);
    }
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    const colorType = header[25];
    if (width !== request.width || height !== request.height) {
      throw new Error(`HyperFrames PNG 帧规格异常: ${width}x${height}，期望 ${request.width}x${request.height}`);
    }
    if (colorType !== 4 && colorType !== 6) {
      throw new Error(`HyperFrames PNG 帧不含 alpha: colorType=${colorType}`);
    }
  }
}

export function renderSegments(
  request: HyperFramesOverlayRequestV1,
  cliPath: string,
  nodePath: string,
  projectDir: string,
): void {
  if (fs.existsSync(request.outputPath)) throw new Error(`HyperFrames 输出已存在，拒绝覆盖: ${request.outputPath}`);
  const segments = splitHyperFramesRenderSegments(request);
  if (segments.length === 1) {
    fs.writeFileSync(path.join(projectDir, "index.html"), buildHyperFramesCompositionHtml(request, segments[0].durationUs), "utf8");
    const temporaryOutputPath = buildHyperFramesWorkerTemporaryOutputPath(projectDir, request.alphaFormat);
    execFileSync(nodePath, [cliPath, ...buildHyperFramesCliArgs(projectDir, request, temporaryOutputPath)], {
      cwd: projectDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", MYSTUDIO_FFMPEG_PATH: process.env.MYSTUDIO_FFMPEG_PATH ?? "", MYSTUDIO_FFPROBE_PATH: process.env.MYSTUDIO_FFPROBE_PATH ?? "" },
      encoding: "utf8", timeout: 30 * 60_000, stdio: ["ignore", "pipe", "pipe"],
    });
    assertRenderedAlphaOutput(temporaryOutputPath, request, segments[0].durationUs);
    moveValidatedOutput(temporaryOutputPath, request.outputPath);
    return;
  }
  if (request.alphaFormat !== "prores-4444-mov") {
    throw new Error("多个 HyperFrames 严格分段目前只支持可无损拼接的 ProRes 4444 MOV");
  }
  const segmentDir = fs.mkdtempSync(path.join(path.dirname(request.outputPath), `.hyperframes-segments-${process.pid}-`));
  try {
    const segmentPaths = segments.map((segment, index) => {
      const segmentProjectDir = path.join(segmentDir, `segment-${String(index + 1).padStart(2, "0")}`);
      fs.mkdirSync(segmentProjectDir, { recursive: true });
      const segmentRequest = { ...request, windows: segment.windows };
      const segmentPath = path.join(segmentDir, `segment-${String(index + 1).padStart(2, "0")}.mov`);
      fs.writeFileSync(path.join(segmentProjectDir, "index.html"), buildHyperFramesCompositionHtml(segmentRequest, segment.durationUs), "utf8");
      execFileSync(nodePath, [cliPath, ...buildHyperFramesCliArgs(segmentProjectDir, segmentRequest, segmentPath)], {
        cwd: segmentProjectDir,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", MYSTUDIO_FFMPEG_PATH: process.env.MYSTUDIO_FFMPEG_PATH ?? "", MYSTUDIO_FFPROBE_PATH: process.env.MYSTUDIO_FFPROBE_PATH ?? "" },
        encoding: "utf8", timeout: 30 * 60_000, stdio: ["ignore", "pipe", "pipe"],
      });
      assertRenderedAlphaOutput(segmentPath, request, segment.durationUs);
      return segmentPath;
    });
    const concatManifestPath = path.join(segmentDir, "segments.txt");
    fs.writeFileSync(concatManifestPath, `${segmentPaths.map((segmentPath) => `file ${quoteConcatPath(segmentPath)}`).join("\n")}\n`, "utf8");
    const outputTemporaryPath = buildHyperFramesWorkerTemporaryOutputPath(segmentDir, request.alphaFormat);
    const ffmpeg = process.env.MYSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg";
    execFileSync(ffmpeg, ["-n", "-f", "concat", "-safe", "0", "-i", concatManifestPath, "-map", "0:v:0", "-an", "-c", "copy", outputTemporaryPath], {
      encoding: "utf8", timeout: 5 * 60_000, stdio: ["ignore", "pipe", "pipe"],
    });
    // 拼接结果必须在校验通过后才进入最终路径：失败不得留下会被“拒绝覆盖”挡住重试的最终文件（child3 AC3）。
    assertRenderedAlphaOutput(outputTemporaryPath, request, Math.max(...request.windows.map(windowEndUs)));
    moveValidatedOutput(outputTemporaryPath, request.outputPath);
  } finally {
    fs.rmSync(segmentDir, { recursive: true, force: true });
  }
}


function assertAlphaOutput(outputPath: string, alphaFormat: HyperFramesOverlayRequestV1["alphaFormat"]): void {
  if (alphaFormat === "png-sequence") {
    const entries = fs.readdirSync(outputPath, { withFileTypes: true });
    if (!entries.some((entry) => entry.isFile() && entry.name.endsWith(".png"))) throw new Error("HyperFrames PNG sequence 没有输出 PNG 帧");
    return;
  }
  const ffprobe = process.env.MYSTUDIO_FFPROBE_PATH?.trim() || "ffprobe";
  const raw = execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt", "-of", "json", outputPath], { encoding: "utf8", timeout: 60_000 });
  const parsed = JSON.parse(raw) as { streams?: Array<{ codec_name?: string; pix_fmt?: string }> };
  const stream = parsed.streams?.[0];
  if (!stream?.pix_fmt?.includes("a")) throw new Error(`HyperFrames 输出不含 alpha: ${stream?.codec_name ?? "unknown"}/${stream?.pix_fmt ?? "unknown"}`);
  if (alphaFormat === "prores-4444-mov" && stream.codec_name !== "prores") throw new Error(`HyperFrames MOV 编码器不是 ProRes: ${stream.codec_name ?? "unknown"}`);
  if (alphaFormat === "webm-vp9-alpha" && stream.codec_name !== "vp9") throw new Error(`HyperFrames WebM 编码器不是 VP9: ${stream.codec_name ?? "unknown"}`);
}
