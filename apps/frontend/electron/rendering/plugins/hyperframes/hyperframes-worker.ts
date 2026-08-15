import crypto from "node:crypto";
import fs from "node:fs";
 
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateHyperFramesOverlayRequest, type HyperFramesOverlayRequestV1 } from "@rendering/contracts/video-workflow";

const TOOL_VERSION = "hyperframes@0.7.101";
/**
 * HyperFrames' strict renderer becomes unreliable when one composition owns
 * all 43 full-frame overlays. Keep each strict composition deliberately
 * small, then concatenate the alpha-preserving ProRes segments.
 */
const MAX_WINDOWS_PER_COMPOSITION = 8;
const SUPPORTED_TEMPLATES = new Set([
  "title-card",
  "kinetic-caption",
  "highlight-box",
  // Cinematic overlay templates
  "light-leak",
  "film-grain",
  "lens-flare",
  "vignette-pulse",
  "particle-dust",
  "letterbox-cinematic",
]);

type HyperFramesWorkerResult = {
  schemaVersion: 1;
  projectId: string;
  chapterId: string;
  revision: number;
  status: "accepted" | "blocked";
  sourceArtifactSha256: string;
  inputSha256: string;
  alphaFormat: HyperFramesOverlayRequestV1["alphaFormat"];
  outputPath?: string;
  outputSha256?: string;
  windows: HyperFramesOverlayRequestV1["windows"];
  toolVersion: string;
  generatedAt: number;
  code?: string;
  message?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function numberParameter(parameters: Record<string, string | number | boolean>, key: string, fallback: number, min: number, max: number): number {
  const value = typeof parameters[key] === "number" ? parameters[key] : Number(parameters[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function textParameter(parameters: Record<string, string | number | boolean>, fallback: string): string {
  const value = parameters.text ?? parameters.label ?? fallback;
  return String(value).trim() || fallback;
}

/**
 * 分段渲染的内部窗口形状：跨段裁剪的尾段携带原始窗口起点的偏移，
 * CSS 动画（含 hf-in 入场与无限循环）用负 animation-delay 回退相位，
 * 拼接后与单组合渲染的时间行为一致（child3 AC1）。
 */
type HyperFramesSegmentWindow = HyperFramesOverlayRequestV1["windows"][number] & {
  animationOffsetUs?: number;
};

function animationPhaseStyle(window: HyperFramesSegmentWindow): string {
  if (!window.animationOffsetUs || window.animationOffsetUs <= 0) return "";
  return `animation-delay:${-(window.animationOffsetUs / 1_000_000)}s;`;
}

/**
 * HyperFrames must never render directly to the caller-owned final path. The
 * enclosing mkdtemp directory is created beside that path, so this rename is
 * both atomic and safe to clean up on a failed render.
 */
export function buildHyperFramesWorkerTemporaryOutputPath(
  projectDir: string,
  alphaFormat: HyperFramesOverlayRequestV1["alphaFormat"],
): string {
  switch (alphaFormat) {
    case "prores-4444-mov":
      return path.join(projectDir, "hyperframes-output.mov");
    case "webm-vp9-alpha":
      return path.join(projectDir, "hyperframes-output.webm");
    case "png-sequence":
      return path.join(projectDir, "hyperframes-output");
  }
}

export function moveValidatedOutput(temporaryPath: string, outputPath: string): void {
  if (fs.existsSync(outputPath)) throw new Error(`HyperFrames 输出已存在，拒绝覆盖: ${outputPath}`);
  fs.renameSync(temporaryPath, outputPath);
}

function renderWindow(window: HyperFramesSegmentWindow, index: number): string {
  if (!SUPPORTED_TEMPLATES.has(window.templateId)) {
    throw new Error(`不支持的 HyperFrames templateId: ${window.templateId}`);
  }
  const parameters = window.parameters;
  const left = numberParameter(parameters, "x", 50, 0, 100);
  const top = numberParameter(parameters, "y", 50, 0, 100);
  const fontSize = numberParameter(parameters, "fontSize", 64, 12, 240);
  const color = typeof parameters.color === "string" && /^#[0-9a-fA-F]{6}$/.test(parameters.color)
    ? parameters.color
    : "#ffffff";
  const text = escapeHtml(textParameter(parameters, window.slotId));
  const elementId = `hf-${window.slotId.replace(/[^A-Za-z0-9_-]/g, "-")}-${index + 1}`;
  const startS = window.startUs / 1_000_000;
  const durationS = window.durationUs / 1_000_000;
  const phaseStyle = animationPhaseStyle(window);
  const phaseOffsetS = window.animationOffsetUs && window.animationOffsetUs > 0 ? window.animationOffsetUs / 1_000_000 : 0;

  // --- Cinematic overlay templates (full-frame, no text) ---
  switch (window.templateId) {
    case "light-leak": {
      const intensity = numberParameter(parameters, "intensity", 0.6, 0, 1);
      const hue = numberParameter(parameters, "hue", 30, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-light-leak" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-intensity:${intensity};--hf-hue:${hue}deg;"></div>`;
    }
    case "film-grain": {
      const opacity = numberParameter(parameters, "opacity", 0.15, 0, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-film-grain" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-grain-opacity:${opacity};"></div>`;
    }
    case "lens-flare": {
      const xPos = numberParameter(parameters, "x", 50, 0, 100);
      const yPos = numberParameter(parameters, "y", 30, 0, 100);
      const size = numberParameter(parameters, "size", 200, 50, 800);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-lens-flare" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${xPos}%;top:${yPos}%;--hf-flare-size:${size}px;"></div>`;
    }
    case "vignette-pulse": {
      const darkness = numberParameter(parameters, "darkness", 0.5, 0, 1);
      const speed = numberParameter(parameters, "speed", 2, 0.5, 10);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-vignette-pulse" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-vignette:${darkness};--hf-pulse-speed:${speed}s;"></div>`;
    }
    case "particle-dust": {
      const count = numberParameter(parameters, "count", 30, 5, 100);
      const speed = numberParameter(parameters, "speed", 8, 1, 30);
      let particles = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 37) % 100);
        const py = Math.round((i * 53) % 100);
        // CSS negative delays start each particle at its global animation
        // phase. Adding the offset would replay the crossing segment instead.
        const delay = (((i * 0.3) % 3) - phaseOffsetS).toFixed(1);
        particles += `<span class="hf-dust-particle" style="left:${px}%;top:${py}%;animation-delay:${delay}s;animation-duration:${speed}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-particle-dust" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${particles}</div>`;
    }
    case "letterbox-cinematic": {
      const barHeight = numberParameter(parameters, "barHeight", 10, 0, 25);
      const fadeS = numberParameter(parameters, "fadeIn", 0.5, 0, 3);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-letterbox" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-bar-height:${barHeight}%;--hf-letterbox-fade:${fadeS}s;"></div>`;
    }
  }

  // --- Text-based templates (original) ---
  const className = window.templateId === "highlight-box" ? "hf-highlight" : window.templateId === "kinetic-caption" ? "hf-caption" : "hf-title";
  const content = window.templateId === "highlight-box" ? "" : text;
  return `<div id="${escapeHtml(elementId)}" class="clip ${className}" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${left}%;top:${top}%;font-size:${fontSize}px;color:${color};">${content}</div>`;
}

export function buildHyperFramesCompositionHtml(request: HyperFramesOverlayRequestV1, durationUs?: number): string {
  const derivedDurationUs = Math.max(...request.windows.map((window) => window.startUs + window.durationUs), 1_000);
  const compositionDurationUs = durationUs ?? derivedDurationUs;
  if (!Number.isSafeInteger(compositionDurationUs) || compositionDurationUs <= 0) {
    throw new Error("HyperFrames composition 时长必须是正整数微秒");
  }
  const durationS = compositionDurationUs / 1_000_000;
  const windows = request.windows.map(renderWindow).join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
#stage{position:relative;width:${request.width}px;height:${request.height}px;background:transparent;overflow:hidden}
.clip{position:absolute;transform:translate(-50%,-50%);opacity:0;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-weight:700;text-shadow:0 3px 12px rgba(0,0,0,.45);animation:hf-in .24s ease-out forwards}
.hf-caption{padding:.22em .48em;border-radius:.22em;background:rgba(0,0,0,.48);letter-spacing:.02em}
.hf-title{letter-spacing:.04em}
.hf-highlight{width:24%;height:14%;border:4px solid currentColor;border-radius:18px;box-shadow:0 0 26px currentColor}

/* --- Cinematic overlay templates --- */
.hf-light-leak{width:100%;height:100%;left:0;top:0;transform:none;opacity:calc(var(--hf-intensity,.6));background:radial-gradient(ellipse at 30% 20%,hsla(var(--hf-hue,30deg),90%,60%,.7) 0%,hsla(calc(var(--hf-hue,30deg) + 40deg),80%,50%,.3) 35%,transparent 70%);mix-blend-mode:screen;animation:hf-leak-drift 8s ease-in-out infinite alternate}
@keyframes hf-leak-drift{from{transform:translateX(-3%) scale(1.05)}to{transform:translateX(3%) scale(1.1)}}

.hf-film-grain{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-grain-opacity,.15);background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");mix-blend-mode:overlay;animation:hf-grain-shift .15s steps(4) infinite}
@keyframes hf-grain-shift{from{transform:translate(0,0)}to{transform:translate(-8px,-8px)}}

.hf-lens-flare{transform:translate(-50%,-50%);width:var(--hf-flare-size,200px);height:var(--hf-flare-size,200px);background:radial-gradient(circle,rgba(255,255,255,.8) 0%,rgba(255,200,100,.4) 8%,rgba(100,150,255,.15) 20%,transparent 40%);mix-blend-mode:screen;animation:hf-flare-pulse 4s ease-in-out infinite alternate}
@keyframes hf-flare-pulse{from{opacity:.5;transform:translate(-50%,-50%) scale(.9)}to{opacity:1;transform:translate(-50%,-50%) scale(1.1)}}

.hf-vignette-pulse{width:100%;height:100%;left:0;top:0;transform:none;background:radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,var(--hf-vignette,.5)) 100%);animation:hf-vignette-breath var(--hf-pulse-speed,2s) ease-in-out infinite alternate}
@keyframes hf-vignette-breath{from{opacity:.7}to{opacity:1}}

.hf-particle-dust{width:100%;height:100%;left:0;top:0;transform:none}
.hf-dust-particle{position:absolute;width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.4);box-shadow:0 0 4px rgba(255,255,255,.2);animation:hf-dust-float linear infinite}
@keyframes hf-dust-float{0%{transform:translate(0,0) scale(.5);opacity:0}20%{opacity:.6}80%{opacity:.4}100%{transform:translate(20px,-60px) scale(1);opacity:0}}

.hf-letterbox{width:100%;height:100%;left:0;top:0;transform:none;opacity:0;animation:hf-letterbox-in var(--hf-letterbox-fade,.5s) ease-out forwards}
.hf-letterbox::before,.hf-letterbox::after{content:"";position:absolute;left:0;width:100%;height:var(--hf-bar-height,10%);background:#000}
.hf-letterbox::before{top:0}
.hf-letterbox::after{bottom:0}
@keyframes hf-letterbox-in{from{opacity:0}to{opacity:1}}

@keyframes hf-in{from{opacity:0;transform:translate(-50%,-50%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
</style></head><body><div id="stage" data-composition-id="mystudio-overlay" data-no-timeline data-start="0" data-duration="${durationS}" data-width="${request.width}" data-height="${request.height}" data-fps="${request.fps}">
${windows}
</div><script>
window.__timelines = window.__timelines || {};
window.__timelines["mystudio-overlay"] = {
  duration: () => ${durationS},
  totalDuration: () => ${durationS},
  getChildren: () => [],
  pause: () => undefined,
  play: () => undefined,
  seek: () => undefined,
  totalTime: () => undefined
};
</script></body></html>\n`;
}

export function buildHyperFramesCliArgs(projectDir: string, request: HyperFramesOverlayRequestV1, outputPath = request.outputPath): string[] {
  const format = request.alphaFormat === "prores-4444-mov" ? "mov" : request.alphaFormat === "webm-vp9-alpha" ? "webm" : "png-sequence";
  return ["render", projectDir, "--format", format, "--output", outputPath, "--fps", String(request.fps), "--quiet", "--strict-all"];
}

type HyperFramesRenderSegment = {
  startUs: number;
  durationUs: number;
  windows: HyperFramesSegmentWindow[];
};

function windowEndUs(window: HyperFramesOverlayRequestV1["windows"][number]): number {
  return window.startUs + window.durationUs;
}

function toFrameBoundaryUs(timeUs: number, fps: number): number {
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
      const overlappingCount = request.windows.filter((window) => window.startUs < endUs && windowEndUs(window) > startUs).length;
      if (overlappingCount <= MAX_WINDOWS_PER_COMPOSITION) selectedEndUs = endUs;
    }
    if (!selectedEndUs) {
      throw new Error(`HyperFrames 无法在 ${MAX_WINDOWS_PER_COMPOSITION} 个窗口内切分重叠时间轴`);
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
    return { startUs, durationUs: endUs - startUs, windows };
  });
}

function quoteConcatPath(filePath: string): string {
  return `'${filePath.replace(/'/g, "'\\\\''")}'`;
}

function assertOutputDuration(outputPath: string, expectedDurationUs: number, fps: number): void {
  const ffprobe = process.env.MYSTUDIO_FFPROBE_PATH?.trim() || "ffprobe";
  const raw = execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "json", outputPath], { encoding: "utf8", timeout: 60_000 });
  const parsed = JSON.parse(raw) as { format?: { duration?: string } };
  const actualDurationS = Number(parsed.format?.duration);
  const expectedDurationS = expectedDurationUs / 1_000_000;
  if (!Number.isFinite(actualDurationS) || Math.abs(actualDurationS - expectedDurationS) > 1 / fps) {
    throw new Error(`HyperFrames 输出时长异常: ${actualDurationS}s，期望 ${expectedDurationS}s（容差 1 帧）`);
  }
}

function assertRenderedAlphaOutput(
  outputPath: string,
  request: HyperFramesOverlayRequestV1,
  expectedDurationUs: number,
): void {
  assertAlphaOutput(outputPath, request.alphaFormat);
  if (request.alphaFormat === "png-sequence") return;
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

function renderSegments(
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

function parseArgs(argv: string[]): { requestPath: string; artifactPath: string } {
  const value = (name: string): string => {
    const index = argv.indexOf(name);
    const result = index >= 0 ? argv[index + 1] : undefined;
    if (!result || result.startsWith("--")) throw new Error(`缺少 ${name} 参数`);
    return result;
  };
  return { requestPath: value("--request"), artifactPath: value("--output") };
}

function writeJson(filePath: string, value: HyperFramesWorkerResult): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function blocked(request: Partial<HyperFramesOverlayRequestV1>, code: string, message: string): HyperFramesWorkerResult {
  return {
    schemaVersion: 1,
    projectId: typeof request.projectId === "string" ? request.projectId : "unknown",
    chapterId: typeof request.chapterId === "string" ? request.chapterId : "unknown",
    revision: typeof request.revision === "number" ? request.revision : 0,
    status: "blocked",
    sourceArtifactSha256: typeof request.sourceArtifactSha256 === "string" ? request.sourceArtifactSha256 : "0".repeat(64),
    inputSha256: typeof request.inputSha256 === "string" ? request.inputSha256 : "0".repeat(64),
    alphaFormat: request.alphaFormat ?? "prores-4444-mov",
    windows: Array.isArray(request.windows) ? request.windows : [],
    toolVersion: TOOL_VERSION,
    generatedAt: Date.now(),
    code,
    message,
  };
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

function run(request: HyperFramesOverlayRequestV1, artifactPath: string): HyperFramesWorkerResult {
  const validated = validateHyperFramesOverlayRequest(request);
  if (!validated.success) return blocked(request, "invalid-request", validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  if (!path.isAbsolute(artifactPath) || !path.isAbsolute(request.outputPath)) return blocked(request, "output-path-mismatch", "worker artifact 与 overlay 输出路径都必须是绝对路径");
  const cliPath = process.env.MYSTUDIO_HYPERFRAMES_CLI?.trim();
  const nodePath = process.env.MYSTUDIO_HYPERFRAMES_NODE?.trim();
  if (!cliPath || !path.isAbsolute(cliPath) || !fs.existsSync(cliPath)) return blocked(request, "hyperframes-cli-missing", "HyperFrames CLI 未在应用级 profile 中准备");
  if (!nodePath || !path.isAbsolute(nodePath) || !fs.existsSync(nodePath)) return blocked(request, "node-runtime-missing", "HyperFrames 必须使用应用级 Electron Node");
  const projectDir = fs.mkdtempSync(path.join(path.dirname(request.outputPath), `.hyperframes-${process.pid}-`));
  try {
    renderSegments(validated.value, cliPath, nodePath, projectDir);
    if (!fs.existsSync(request.outputPath)) throw new Error("HyperFrames CLI 未生成输出文件");
    const outputSha256 = validated.value.alphaFormat === "png-sequence"
      ? crypto.createHash("sha256").update(fs.readdirSync(request.outputPath).sort().join("\n")).digest("hex")
      : crypto.createHash("sha256").update(fs.readFileSync(request.outputPath)).digest("hex");
    return {
      schemaVersion: 1,
      projectId: validated.value.projectId,
      chapterId: validated.value.chapterId,
      revision: validated.value.revision,
      status: "accepted",
      sourceArtifactSha256: validated.value.sourceArtifactSha256,
      inputSha256: validated.value.inputSha256,
      alphaFormat: validated.value.alphaFormat,
      outputPath: request.outputPath,
      outputSha256,
      windows: validated.value.windows,
      toolVersion: TOOL_VERSION,
      generatedAt: Date.now(),
    };
  } catch (error) {
    return blocked(validated.value, "render-failed", error instanceof Error ? error.message : String(error));
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

function main(): void {
  let outputPath: string | undefined;
  try {
    const args = parseArgs(process.argv.slice(2));
    outputPath = args.artifactPath;
    const request = JSON.parse(fs.readFileSync(args.requestPath, "utf8")) as unknown;
    const result = run(request as HyperFramesOverlayRequestV1, args.artifactPath);
    writeJson(args.artifactPath, result);
    if (result.status !== "accepted") process.exitCode = 2;
  } catch (error) {
    if (outputPath) writeJson(outputPath, blocked({}, "worker-failed", error instanceof Error ? error.message : String(error)));
    process.exitCode = 2;
  }
}

if (process.env.MYSTUDIO_HYPERFRAMES_WORKER === "1") main();
