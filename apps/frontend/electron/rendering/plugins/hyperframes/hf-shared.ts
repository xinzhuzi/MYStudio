import fs from "node:fs";
import path from "node:path";
import { HyperFramesOverlayRequestV1 } from "@rendering/contracts/video-workflow";
import { HYPERFRAMES_NPM_VERSION } from "@rendering/plugins/video-workflow/video-workflow-runtime";
import { buildHyperFramesCompositionHtml } from "./hf-composition";

/**
 * HyperFrames worker 共享底座——常量/重元素预算/模板清单/参数工具/临时产物路径。file-size-reduction P1 拆出,体逐字保留。
 */
export const TOOL_VERSION = `hyperframes@${HYPERFRAMES_NPM_VERSION}`;
/**
 * HyperFrames' strict renderer becomes unreliable when one composition owns
 * many full-frame overlays. Keep each strict composition deliberately small,
 * then concatenate the alpha-preserving ProRes segments.
 *
 * 08-22 修(两段式):①三镜像失同步补门;②heavy-overlay 预算切分——HY strict
 * lint 按 composition 内带 blur/radial-gradient/clip-path 的元素计数,08-21
 * 新模板 CSS 普遍更重(bokeh+star+confetti+ink 四窗段实测 28 heavy 元素熔断,
 * 且字段报告+本仓 alpha 探针实证:组合内 star 可见度掉到单模板的 1/7,捕获层
 * 劣化是物理真实)。窗数上限之外再加 heavy 元素预算(估算器与 linter 同口径:
 * 样式表中含 heavy 令牌的规则所涉 class,统计 body 内命中元素数)。
 */
export const MAX_WINDOWS_PER_COMPOSITION = 4;
export const HEAVY_ELEMENT_BUDGET = 15;
export const HEAVY_CSS_TOKENS = /radial-gradient|blur\(|clip-path/;

const heavyElementCache = new Map<string, number>();

export function estimateHeavyElementCount(window: HyperFramesOverlayRequestV1["windows"][number]): number {
  const key = `${window.templateId}|${window.durationUs}|${JSON.stringify(window.parameters ?? {})}`;
  const cached = heavyElementCache.get(key);
  if (cached !== undefined) return cached;
  const html = buildHyperFramesCompositionHtml({
    schemaVersion: 1,
    projectId: "heavy-estimate",
    chapterId: "heavy-estimate",
    revision: 1,
    sourceArtifactSha256: "0".repeat(64),
    inputSha256: "0".repeat(64),
    width: 1920,
    height: 1080,
    fps: 30,
    alphaFormat: "prores-4444-mov",
    outputPath: "/tmp/heavy-estimate.mov",
    windows: [window],
  }, window.durationUs);
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const heavyClasses = new Set<string>();
  for (const rule of style.split("}")) {
    if (!HEAVY_CSS_TOKENS.test(rule)) continue;
    const selector = rule.split("{")[0] ?? "";
    for (const match of selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)) heavyClasses.add(match[1]!);
  }
  let count = 0;
  // 任意标签(div/span 都有:star-twinkle 粒子是 span,08-22 实测 div-only 漏算 15)
  for (const element of html.matchAll(/<\w+[^>]*\bclass="([^"]*)"[^>]*>/g)) {
    if (element[1]!.split(/\s+/).some((cls) => heavyClasses.has(cls))) count += 1;
  }
  count += (html.match(/style="[^"]*(?:radial-gradient|blur\(|clip-path)[^"]*"/g) ?? []).length;
  heavyElementCache.set(key, count);
  return count;
}
// 08-22 修(三镜像失同步):08-21 剪映风扩容的 20 新模板进了决策池(adapter.py)
// 与 TS 契约(HYPERFRAMES_DECORATIVE_TEMPLATE_IDS),也补齐了下方渲染 case,
// 但漏加本 Set 门——重跑撞上新模板即 blocked「不支持的 templateId」。
// 现导出供 hyperframes-template-sync.test.ts 与契约白名单对拍守护。
export const SUPPORTED_TEMPLATES = new Set([
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
  // 08-18-hy-effects Phase 1：本地自写装饰模板（repo 内 HTML/CSS，零许可风险；
  // Registry 块商用条款未确认前不引入）。CSS 类定义见 composition 样式段。
  "ink-bloom",
  "mist-drift",
  "gold-flecks",
  "brush-sweep",
  "paper-breath",
  "candle-flicker",
  "moon-glow",
  "rain-streaks",
  "snow-drift",
  "aura-pulse",
  "sword-flash",
  "seal-glow",
  "dust-motes",
  // 2026-08-19 动画手法：冲击/氛围效果
  "speed-lines",
  "shockwave-ring",
  "breathing-light",
  // 08-21 剪映风格扩容(20 新)——08-22 补入本门(见文件头注)
  "glitch-rgb", "glitch-slice", "glitch-scanline", "vhs-rewind", "pixel-blur",
  "strobe-flash", "neon-glow", "bokeh-lights", "star-twinkle", "confetti-burst",
  "heart-float", "bubble-rise", "zoom-pulse", "shake-earthquake", "wobble-jelly",
  "spin-hypnotic", "ripple-water", "fade-dip-black", "flash-white", "dream-soft",
]);

export type HyperFramesWorkerResult = {
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

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function numberParameter(parameters: Record<string, string | number | boolean>, key: string, fallback: number, min: number, max: number): number {
  const value = typeof parameters[key] === "number" ? parameters[key] : Number(parameters[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function textParameter(parameters: Record<string, string | number | boolean>, fallback: string): string {
  const value = parameters.text ?? parameters.label ?? fallback;
  return String(value).trim() || fallback;
}

/**
 * 分段渲染的内部窗口形状：跨段裁剪的尾段携带原始窗口起点的偏移，
 * CSS 动画（含 hf-in 入场与无限循环）用负 animation-delay 回退相位，
 * 拼接后与单组合渲染的时间行为一致（child3 AC1）。
 */
export type HyperFramesSegmentWindow = HyperFramesOverlayRequestV1["windows"][number] & {
  animationOffsetUs?: number;
};

export function animationPhaseStyle(window: HyperFramesSegmentWindow): string {
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
  if (!fs.lstatSync(temporaryPath).isDirectory()) {
    try {
      // The temporary output is created beside the final path, so a hard link
      // gives regular files an atomic no-clobber publish on the same volume.
      fs.linkSync(temporaryPath, outputPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`HyperFrames 输出已存在，拒绝覆盖: ${outputPath}`);
      }
      throw error;
    }
    fs.unlinkSync(temporaryPath);
    return;
  }

  const lockPath = `${outputPath}.mystudio-publish.lock`;
  let lockFd: number | undefined;
  try {
    lockFd = fs.openSync(lockPath, "wx");
    if (fs.existsSync(outputPath)) throw new Error(`HyperFrames 输出已存在，拒绝覆盖: ${outputPath}`);
    fs.renameSync(temporaryPath, outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`HyperFrames 输出已存在或正在发布，拒绝覆盖: ${outputPath}`);
    }
    throw error;
  } finally {
    if (lockFd !== undefined) fs.closeSync(lockFd);
    if (lockFd !== undefined) fs.rmSync(lockPath, { force: true });
  }
}

// hy: 前缀走 registry 路径(从 assets 加载外部 HTML)
