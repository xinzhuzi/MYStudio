import crypto from "node:crypto";
import fs from "node:fs";
 
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateHyperFramesOverlayRequest, type HyperFramesOverlayRequestV1 } from "@rendering/contracts/video-workflow";

const TOOL_VERSION = "hyperframes@0.7.101";
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

function renderWindow(window: HyperFramesOverlayRequestV1["windows"][number], index: number): string {
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

  // --- Cinematic overlay templates (full-frame, no text) ---
  switch (window.templateId) {
    case "light-leak": {
      const intensity = numberParameter(parameters, "intensity", 0.6, 0, 1);
      const hue = numberParameter(parameters, "hue", 30, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-light-leak" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="--hf-intensity:${intensity};--hf-hue:${hue}deg;"></div>`;
    }
    case "film-grain": {
      const opacity = numberParameter(parameters, "opacity", 0.15, 0, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-film-grain" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="--hf-grain-opacity:${opacity};"></div>`;
    }
    case "lens-flare": {
      const xPos = numberParameter(parameters, "x", 50, 0, 100);
      const yPos = numberParameter(parameters, "y", 30, 0, 100);
      const size = numberParameter(parameters, "size", 200, 50, 800);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-lens-flare" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="left:${xPos}%;top:${yPos}%;--hf-flare-size:${size}px;"></div>`;
    }
    case "vignette-pulse": {
      const darkness = numberParameter(parameters, "darkness", 0.5, 0, 1);
      const speed = numberParameter(parameters, "speed", 2, 0.5, 10);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-vignette-pulse" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="--hf-vignette:${darkness};--hf-pulse-speed:${speed}s;"></div>`;
    }
    case "particle-dust": {
      const count = numberParameter(parameters, "count", 30, 5, 100);
      const speed = numberParameter(parameters, "speed", 8, 1, 30);
      let particles = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 37) % 100);
        const py = Math.round((i * 53) % 100);
        const delay = ((i * 0.3) % 3).toFixed(1);
        particles += `<span class="hf-dust-particle" style="left:${px}%;top:${py}%;animation-delay:${delay}s;animation-duration:${speed}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-particle-dust" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}">${particles}</div>`;
    }
    case "letterbox-cinematic": {
      const barHeight = numberParameter(parameters, "barHeight", 10, 0, 25);
      const fadeS = numberParameter(parameters, "fadeIn", 0.5, 0, 3);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-letterbox" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="--hf-bar-height:${barHeight}%;--hf-letterbox-fade:${fadeS}s;"></div>`;
    }
  }

  // --- Text-based templates (original) ---
  const className = window.templateId === "highlight-box" ? "hf-highlight" : window.templateId === "kinetic-caption" ? "hf-caption" : "hf-title";
  const content = window.templateId === "highlight-box" ? "" : text;
  return `<div id="${escapeHtml(elementId)}" class="clip ${className}" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="left:${left}%;top:${top}%;font-size:${fontSize}px;color:${color};">${content}</div>`;
}

export function buildHyperFramesCompositionHtml(request: HyperFramesOverlayRequestV1): string {
  const durationS = Math.max(...request.windows.map((window) => (window.startUs + window.durationUs) / 1_000_000), 0.001);
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

export function buildHyperFramesCliArgs(projectDir: string, request: HyperFramesOverlayRequestV1): string[] {
  const format = request.alphaFormat === "prores-4444-mov" ? "mov" : request.alphaFormat === "webm-vp9-alpha" ? "webm" : "png-sequence";
  return ["render", projectDir, "--format", format, "--output", request.outputPath, "--fps", String(request.fps), "--quiet", "--strict-all"];
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
  const entryPath = path.join(projectDir, "index.html");
  fs.writeFileSync(entryPath, buildHyperFramesCompositionHtml(validated.value), "utf8");
  try {
    const cliArgs = buildHyperFramesCliArgs(projectDir, validated.value);
    execFileSync(nodePath, [cliPath, ...cliArgs], {
      cwd: projectDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        MYSTUDIO_FFMPEG_PATH: process.env.MYSTUDIO_FFMPEG_PATH ?? "",
        MYSTUDIO_FFPROBE_PATH: process.env.MYSTUDIO_FFPROBE_PATH ?? "",
      },
      encoding: "utf8",
      timeout: 30 * 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (validated.value.alphaFormat === "png-sequence") assertAlphaOutput(request.outputPath, validated.value.alphaFormat);
    else {
      if (!fs.existsSync(request.outputPath)) throw new Error("HyperFrames CLI 未生成输出文件");
      assertAlphaOutput(request.outputPath, validated.value.alphaFormat);
    }
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
