import crypto from "node:crypto";
import fs from "node:fs";
 
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { validateHyperFramesOverlayRequest, type HyperFramesOverlayRequestV1 } from "@rendering/contracts/video-workflow";
import { HYPERFRAMES_NPM_VERSION } from "@rendering/plugins/video-workflow/video-workflow-runtime";
import { installUncaughtExceptionGuard } from "../../../runtime/uncaught-exception-guard";

// utility 子进程有独立运行时,主进程的 uncaughtException 守卫罩不到这里;
// undici setTypeOfService EINVAL(上游 undici#5544)必须各自过滤。
installUncaughtExceptionGuard({
  writeLog: (entry) => {
    console.warn(`[hyperframes-worker] ${entry.level}: ${entry.message}`);
  },
});

const TOOL_VERSION = `hyperframes@${HYPERFRAMES_NPM_VERSION}`;
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
const MAX_WINDOWS_PER_COMPOSITION = 4;
const HEAVY_ELEMENT_BUDGET = 15;
const HEAVY_CSS_TOKENS = /radial-gradient|blur\(|clip-path/;

const heavyElementCache = new Map<string, number>();

function estimateHeavyElementCount(window: HyperFramesOverlayRequestV1["windows"][number]): number {
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
function isRegistryTemplate(templateId: string): boolean {
  return templateId.startsWith("hy:");
}

// registry 模板缓存(避免同段多窗重复读盘);raw 提取结果,依赖物化另行缓存
const registryTemplateCache = new Map<string, { styles: string; body: string; scripts: string; depRels: string[] }>();

/**
 * registry assets 根:dev 与打包两种落位——
 * - dev: apps/frontend/assets/hyperframes-registry(相对源码)
 * - 打包: Resources/hyperframes-registry(extraResources to: hyperframes-registry)
 */
function resolveRegistryAssetsRoot(): string {
  // 08-22:env 覆盖(esbuild 单文件 bundle 的 __dirname 相对推导会断链)
  const envRoot = process.env.MYSTUDIO_HYPERFRAMES_REGISTRY_ASSETS?.trim();
  if (envRoot) return envRoot;
  const dev = path.join(__dirname, "../../../../assets/hyperframes-registry");
  if (fs.existsSync(dev)) return dev;
  return path.join(process.resourcesPath ?? "", "hyperframes-registry");
}

const REGISTRY_DEP_REF = /\.\.\/\.\.\/registry-deps\/([^\s"'")]+)/g;

/**
 * 加载 registry HTML 模板,提取 <style>/<body>/<script> 内容。
 * blocks 是完整文档(拆出 style+body);components 是片段(直接用)。
 * 外部 <script src="../../registry-deps/..."> 不内联执行,这里剔除标签、
 * 记录依赖清单,由 materializeRegistryTemplate 在渲染时物化。
 */
function loadRegistryTemplate(templateId: string): { styles: string; body: string; scripts: string; depRels: string[] } {
  const cached = registryTemplateCache.get(templateId);
  if (cached) return cached;
  const name = templateId.slice(3); // strip "hy:"
  const assetsRoot = resolveRegistryAssetsRoot();
  const blockPath = path.join(assetsRoot, "blocks", name, `${name}.html`);
  const componentPath = path.join(assetsRoot, "components", name, `${name}.html`);
  const filePath = fs.existsSync(blockPath) ? blockPath : fs.existsSync(componentPath) ? componentPath : null;
  if (!filePath) throw new Error(`Registry 模板不存在: ${templateId}`);
  const html = fs.readFileSync(filePath, "utf8");

  const depRels = new Set<string>();
  for (const m of html.matchAll(REGISTRY_DEP_REF)) {
    depRels.add(m[1].replace(/[)'"]+$/, ""));
  }

  // 提取 <style> 内容
  const styles: string[] = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    styles.push(m[1]);
  }
  // 提取 <script> 内容(排除外部引用)。
  // 保留含 window.__timelines 的脚本:注册时间线是 HyperFrames CLI 的驱动协议
  // (CLI 逐帧 seek 注册的 timeline),剔除会令模板动画失去同步(308 个模板受累)。
  const scripts: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const code = m[1].trim();
    if (code) {
      scripts.push(code);
    }
  }
  // 提取 <body> 内容(剔除指向 registry-deps 的外部 script 标签)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  const body = (bodyMatch ? bodyMatch[1] : html)
    .replace(/<script[^>]*src=["'][^"']*registry-deps[^"']*["'][^>]*>\s*<\/script>\s*/g, "")
    .trim();

  const result = { styles: styles.join("\n"), body, scripts: scripts.join("\n"), depRels: [...depRels] };
  registryTemplateCache.set(templateId, result);
  return result;
}

interface MaterializedRegistryTemplate {
  styles: string;
  body: string;
  scripts: string;
  /** 依赖 JS 库内容(内联进 head,执行先于模板内联脚本) */
  libScripts: string[];
  /** 字体 CSS(_files 字体已转 data URI,内联 <style>) */
  fontStyles: string;
  /** 地图等 JSON 数据预注入(window.__REGISTRY_DATA__) */
  dataPreload: string;
}

const materializedRegistryCache = new Map<string, MaterializedRegistryTemplate | null>();

/** 内联 JS 防 </script> 提前闭合 */
function inlineSafeJs(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script");
}

/**
 * 渲染时物化 registry 模板依赖:JS 库内联、字体 CSS+data URI 内联、
 * d3.json 数据预注入——composition 完全自包含,无 file:// 跨源问题。
 * 依赖缺失或依赖损坏(如截断的 JSON)一律返回 null(调用方降级丢弃该窗,不阻塞整段渲染)。
 */
function materializeRegistryTemplate(templateId: string): MaterializedRegistryTemplate | null {
  const depsRoot = process.env.MYSTUDIO_REGISTRY_DEPS_DIR?.trim();
  // 缓存键含 depsRoot:依赖目录变化(下载完成/测试切换)不得命中陈旧结果
  const cacheKey = `${depsRoot ?? ""}|${templateId}`;
  if (materializedRegistryCache.has(cacheKey)) return materializedRegistryCache.get(cacheKey) ?? null;
  const raw = loadRegistryTemplate(templateId);
  let result: MaterializedRegistryTemplate | null;
  if (raw.depRels.length === 0) {
    result = { styles: raw.styles, body: raw.body, scripts: raw.scripts, libScripts: [], fontStyles: "", dataPreload: "" };
  } else if (!depsRoot) {
    console.warn(`[hyperframes-worker] ${templateId} 需要特效依赖但未配置 deps 目录;窗口已降级丢弃(设置→视频工作流→HyperFrames 下载依赖)`);
    result = null;
  } else {
    // 路径遏制:依赖相对路径不得逃出 deps 根(防御 map/HTML 被篡改时的路径穿越)
    const rootAbs = path.resolve(depsRoot);
    const safeRel = (rel: string): string | null => {
      const abs = path.resolve(rootAbs, rel);
      return abs.startsWith(rootAbs + path.sep) ? abs : null;
    };
    const missing: string[] = [];
    const relAbs = new Map<string, string>();
    for (const rel of raw.depRels) {
      const abs = safeRel(rel);
      if (abs === null || !fs.existsSync(abs)) missing.push(rel);
      else relAbs.set(rel, abs);
    }
    if (missing.length > 0) {
      console.warn(`[hyperframes-worker] ${templateId} 缺依赖 ${missing.join(", ")};窗口已降级丢弃(设置→视频工作流→HyperFrames 下载依赖)`);
      result = null;
    } else {
      try {
        const libScripts: string[] = [];
        const fontStyles: string[] = [];
        const dataMap: Record<string, unknown> = {};
        for (const [rel, abs] of relAbs) {
          if (rel.endsWith(".js")) {
            libScripts.push(inlineSafeJs(fs.readFileSync(abs, "utf8")));
          } else if (rel.endsWith(".css")) {
            // 字体 CSS:内部 url(_files/x) 转 data URI,整段内联
            let css = fs.readFileSync(abs, "utf8");
            for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
              const ref = m[1].trim().replace(/^["']|["']$/g, "");
              if (/^https?:\/\//.test(ref)) continue;
              const fontAbs = path.join(path.dirname(abs), ref);
              if (!fs.existsSync(fontAbs)) continue;
              const buf = fs.readFileSync(fontAbs);
              const mime = ref.endsWith(".woff2") ? "font/woff2" : ref.endsWith(".woff") ? "font/woff" : "font/ttf";
              css = css.split(`url(${m[1]})`).join(`url(data:${mime};base64,${buf.toString("base64")})`);
            }
            fontStyles.push(css);
          } else if (rel.endsWith(".json")) {
            // 截断/损坏的 JSON 在此抛错,由外层 catch 统一降级——不阻塞整段渲染
            dataMap[rel] = JSON.parse(fs.readFileSync(abs, "utf8"));
          }
        }
        // d3.json("...registry-deps/x.json") → 预注入数据(规避 file:// fetch 限制)
        const scripts = raw.scripts.replace(
          /d3\.json\((["'])(\.\.\/\.\.\/registry-deps\/[^"']+)\1\)/g,
          (_all, _q, url: string) => {
            const rel = url.replace("../../registry-deps/", "");
            return `Promise.resolve(window.__REGISTRY_DATA__[${JSON.stringify(rel)}])`;
          },
        );
        // styles/body 残余 registry-deps 引用(<img href 等)退回 file:// 绝对路径
        // pathToFileURL 正确处理 userData 路径中的空格与中文
        let styles = raw.styles;
        let body = raw.body;
        for (const [rel, abs] of relAbs) {
          const fileUrl = pathToFileURL(abs).href;
          styles = styles.split(`../../registry-deps/${rel}`).join(fileUrl);
          body = body.split(`../../registry-deps/${rel}`).join(fileUrl);
        }
        const dataPreload = Object.keys(dataMap).length
          ? `window.__REGISTRY_DATA__=Object.assign(window.__REGISTRY_DATA__||{},${JSON.stringify(dataMap).replace(/</g, "\\u003c")});`
          : "";
        result = { styles, body, scripts, libScripts, fontStyles: fontStyles.join("\n"), dataPreload };
      } catch (error) {
        console.warn(`[hyperframes-worker] ${templateId} 依赖物化失败(${error instanceof Error ? error.message : String(error)});窗口已降级丢弃`);
        result = null;
      }
    }
  }
  materializedRegistryCache.set(cacheKey, result);
  return result;
}

function renderWindow(window: HyperFramesSegmentWindow, index: number): string {
  // hy:* registry 模板:加载外部 HTML 并包装为定位容器
  if (isRegistryTemplate(window.templateId)) {
    const template = materializeRegistryTemplate(window.templateId);
    if (!template) return ""; // 依赖缺失已告警,降级丢弃该窗不阻塞渲染
    const startS = window.startUs / 1_000_000;
    const durationS = window.durationUs / 1_000_000;
    // class="clip" 是运行时按 data-start/data-duration 控可见性的钩子;
    // .clip 基础样式假设"居中点定位",registry 全幅窗用专属规则抵消
    const id = `hyr-${window.templateId.replace(/[^A-Za-z0-9-]/g, "-")}-${index + 1}`;
    return `<div id="${id}" class="clip hy-registry-window" data-template="${window.templateId}" data-start="${startS}" data-duration="${durationS}" style="position:absolute;inset:0;width:100%;height:100%;overflow:hidden;">${template.body}</div>`;
  }
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
    // --- 08-18-hy-effects Phase 1 本地自写装饰模板 ---
    case "ink-bloom": {
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      const xPos = numberParameter(parameters, "x", 50, 0, 100);
      const yPos = numberParameter(parameters, "y", 45, 0, 100);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-ink-bloom" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${xPos}%;top:${yPos}%;--hf-ink:${intensity};"></div>`;
    }
    case "mist-drift": {
      const opacity = numberParameter(parameters, "opacity", 0.25, 0, 1);
      const speed = numberParameter(parameters, "speed", 14, 4, 40);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-mist-drift" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-mist:${opacity};--hf-mist-speed:${speed}s;"></div>`;
    }
    case "gold-flecks": {
      const count = Math.round(numberParameter(parameters, "count", 8, 3, 12));
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      let flecks = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 41) % 100);
        const py = Math.round((i * 61) % 100);
        const delay = (((i * 0.4) % 4) - phaseOffsetS).toFixed(1);
        flecks += `<span class="hf-fleck" style="left:${px}%;top:${py}%;animation-delay:${delay}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-gold-flecks" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}--hf-fleck:${intensity};"` : ""}>${flecks}</div>`;
    }
    case "brush-sweep": {
      const hue = numberParameter(parameters, "hue", 210, 0, 360);
      const speed = numberParameter(parameters, "speed", 3, 1, 10);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-brush-sweep" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-brush-hue:${hue}deg;--hf-brush-speed:${speed}s;"></div>`;
    }
    case "paper-breath": {
      const warmth = numberParameter(parameters, "warmth", 0.15, 0, 1);
      const speed = numberParameter(parameters, "speed", 6, 2, 20);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-paper-breath" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-warmth:${warmth};--hf-breath-speed:${speed}s;"></div>`;
    }
    case "candle-flicker": {
      const intensity = numberParameter(parameters, "intensity", 0.4, 0, 1);
      const xPos = numberParameter(parameters, "x", 70, 0, 100);
      const yPos = numberParameter(parameters, "y", 65, 0, 100);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-candle-flicker" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${xPos}%;top:${yPos}%;--hf-candle:${intensity};"></div>`;
    }
    case "moon-glow": {
      const xPos = numberParameter(parameters, "x", 24, 0, 100);
      const yPos = numberParameter(parameters, "y", 22, 0, 100);
      const size = numberParameter(parameters, "size", 260, 80, 700);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-moon-glow" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${xPos}%;top:${yPos}%;--hf-moon-size:${size}px;"></div>`;
    }
    case "rain-streaks": {
      const count = Math.round(numberParameter(parameters, "count", 10, 4, 14));
      const speed = numberParameter(parameters, "speed", 1.2, 0.4, 4);
      let streaks = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 29 + 7) % 100);
        const delay = (((i * 0.17) % 1.2) - phaseOffsetS).toFixed(2);
        streaks += `<span class="hf-rain" style="left:${px}%;animation-delay:${delay}s;animation-duration:${speed}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-rain-streaks" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${streaks}</div>`;
    }
    case "snow-drift": {
      const count = Math.round(numberParameter(parameters, "count", 10, 4, 14));
      const speed = numberParameter(parameters, "speed", 9, 3, 25);
      let flakes = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 43 + 13) % 100);
        const delay = (((i * 0.6) % 5) - phaseOffsetS).toFixed(1);
        flakes += `<span class="hf-snow" style="left:${px}%;animation-delay:${delay}s;animation-duration:${speed}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-snow-drift" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${flakes}</div>`;
    }
    case "aura-pulse": {
      const intensity = numberParameter(parameters, "intensity", 0.35, 0, 1);
      const speed = numberParameter(parameters, "speed", 2.5, 0.5, 8);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-aura-pulse" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-aura:${intensity};--hf-aura-speed:${speed}s;"></div>`;
    }
    case "sword-flash": {
      const angle = numberParameter(parameters, "angle", 24, -60, 60);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-sword-flash" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-sword-angle:${angle}deg;"></div>`;
    }
    case "seal-glow": {
      const intensity = numberParameter(parameters, "intensity", 0.3, 0, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-seal-glow" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-seal:${intensity};"></div>`;
    }
    case "speed-lines": {
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      const direction = numberParameter(parameters, "direction", 0, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-speed-lines" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-speed:${intensity};--hf-speed-dir:${direction}deg;"></div>`;
    }
    case "shockwave-ring": {
      const intensity = numberParameter(parameters, "intensity", 0.6, 0, 1);
      const speed = numberParameter(parameters, "speed", 1.5, 0.5, 5);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-shockwave" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-wave:${intensity};--hf-wave-speed:${speed}s;"></div>`;
    }
    case "breathing-light": {
      const intensity = numberParameter(parameters, "intensity", 0.35, 0, 1);
      const speed = numberParameter(parameters, "speed", 3, 1, 10);
      const hue = numberParameter(parameters, "hue", 45, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-breathing-light" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-breathe-l:${intensity};--hf-breathe-speed:${speed}s;--hf-breathe-hue:${hue}deg;"></div>`;
    }
    // --- 08-21 剪映风格特效扩容(20 新模板,3 类) ---
    // 故障/复古类(5)
    case "glitch-rgb": {
      const intensity = numberParameter(parameters, "intensity", 0.6, 0, 1);
      const speed = numberParameter(parameters, "speed", 3, 1, 10);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-glitch-rgb" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-glitch-i:${intensity};--hf-glitch-spd:${speed}s;"></div>`;
    }
    case "glitch-slice": {
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      const slices = Math.round(numberParameter(parameters, "slices", 6, 2, 12));
      let strips = "";
      for (let i = 0; i < slices; i++) {
        strips += `<span class="hf-glitch-strip" style="top:${Math.round((i * 100) / slices)}%;animation-delay:${(i * 0.08).toFixed(2)}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-glitch-slice" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}--hf-slice-i:${intensity};"` : ""}>${strips}</div>`;
    }
    case "glitch-scanline": {
      const intensity = numberParameter(parameters, "intensity", 0.4, 0, 1);
      const speed = numberParameter(parameters, "speed", 8, 1, 20);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-glitch-scanline" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-scan-i:${intensity};--hf-scan-spd:${speed}s;"></div>`;
    }
    case "vhs-rewind": {
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      const hue = numberParameter(parameters, "hue", 280, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-vhs-rewind" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-vhs-i:${intensity};--hf-vhs-hue:${hue}deg;"></div>`;
    }
    case "pixel-blur": {
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      const size = Math.round(numberParameter(parameters, "size", 12, 4, 30));
      return `<div id="${escapeHtml(elementId)}" class="clip hf-pixel-blur" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-pixel-i:${intensity};--hf-pixel-size:${size}px;"></div>`;
    }
    // 光效/粒子类(8)
    case "strobe-flash": {
      const speed = numberParameter(parameters, "speed", 4, 1, 10);
      const color = numberParameter(parameters, "color", 60, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-strobe-flash" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-strobe-spd:${speed}s;--hf-strobe-hue:${color}deg;"></div>`;
    }
    case "neon-glow": {
      const hue = numberParameter(parameters, "hue", 190, 0, 360);
      const intensity = numberParameter(parameters, "intensity", 0.7, 0, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-neon-glow" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-neon-hue:${hue}deg;--hf-neon-i:${intensity};"></div>`;
    }
    case "bokeh-lights": {
      const count = Math.round(numberParameter(parameters, "count", 12, 4, 30));
      const hue = numberParameter(parameters, "hue", 40, 0, 360);
      const speed = numberParameter(parameters, "speed", 5, 1, 15);
      let bokeh = "";
      for (let i = 0; i < count; i++) {
        const bx = Math.round((i * 61 + 13) % 100);
        const by = Math.round((i * 37 + 29) % 100);
        const sz = 30 + ((i * 19) % 60);
        bokeh += `<span class="hf-bokeh" style="left:${bx}%;top:${by}%;width:${sz}px;height:${sz}px;--hf-bokeh-hue:${hue}deg;animation-duration:${(speed + (i % 3)).toFixed(1)}s;animation-delay:${(i * 0.4).toFixed(1)}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-bokeh-lights" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${bokeh}</div>`;
    }
    case "star-twinkle": {
      const count = Math.round(numberParameter(parameters, "count", 15, 5, 40));
      const speed = numberParameter(parameters, "speed", 2, 0.5, 6);
      let stars = "";
      for (let i = 0; i < count; i++) {
        const sx = Math.round((i * 47 + 7) % 100);
        const sy = Math.round((i * 31 + 19) % 100);
        stars += `<span class="hf-star" style="left:${sx}%;top:${sy}%;animation-duration:${(speed + (i % 4) * 0.5).toFixed(1)}s;animation-delay:${(i * 0.15).toFixed(2)}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-star-twinkle" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${stars}</div>`;
    }
    case "confetti-burst": {
      const count = Math.round(numberParameter(parameters, "count", 20, 5, 50));
      const speed = numberParameter(parameters, "speed", 3, 1, 8);
      let confetti = "";
      const colors = ["#f44336", "#e91e63", "#9c27b0", "#2196f3", "#4caf50", "#ff9800", "#ffeb3b"];
      for (let i = 0; i < count; i++) {
        const cx = Math.round((i * 53 + 11) % 100);
        confetti += `<span class="hf-confetti" style="left:${cx}%;background:${colors[i % colors.length]};animation-duration:${(speed + (i % 3) * 0.5).toFixed(1)}s;animation-delay:${(i * 0.1).toFixed(1)}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-confetti-burst" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${confetti}</div>`;
    }
    case "heart-float": {
      const count = Math.round(numberParameter(parameters, "count", 8, 3, 20));
      const speed = numberParameter(parameters, "speed", 4, 1, 10);
      let hearts = "";
      for (let i = 0; i < count; i++) {
        const hx = Math.round((i * 67 + 17) % 100);
        const hs = 14 + ((i * 11) % 20);
        hearts += `<span class="hf-heart" style="left:${hx}%;font-size:${hs}px;animation-duration:${(speed + (i % 3)).toFixed(1)}s;animation-delay:${(i * 0.5).toFixed(1)}s;">♥</span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-heart-float" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${hearts}</div>`;
    }
    case "bubble-rise": {
      const count = Math.round(numberParameter(parameters, "count", 10, 4, 25));
      const speed = numberParameter(parameters, "speed", 6, 2, 15);
      let bubbles = "";
      for (let i = 0; i < count; i++) {
        const bx = Math.round((i * 43 + 23) % 100);
        const bs = 12 + ((i * 17) % 30);
        bubbles += `<span class="hf-bubble" style="left:${bx}%;width:${bs}px;height:${bs}px;animation-duration:${(speed + (i % 4)).toFixed(1)}s;animation-delay:${(i * 0.3).toFixed(1)}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-bubble-rise" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${bubbles}</div>`;
    }
    // 动态/过渡类(7)
    case "zoom-pulse": {
      const intensity = numberParameter(parameters, "intensity", 0.06, 0.01, 0.2);
      const speed = numberParameter(parameters, "speed", 2, 0.5, 6);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-zoom-pulse" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-zoom-i:${intensity};--hf-zoom-spd:${speed}s;"></div>`;
    }
    case "shake-earthquake": {
      const intensity = numberParameter(parameters, "intensity", 8, 2, 20);
      const speed = numberParameter(parameters, "speed", 10, 2, 20);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-shake-eq" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-shake-i:${intensity}px;--hf-shake-spd:${(1 / speed).toFixed(3)}s;"></div>`;
    }
    case "wobble-jelly": {
      const intensity = numberParameter(parameters, "intensity", 0.02, 0.01, 0.1);
      const speed = numberParameter(parameters, "speed", 3, 1, 8);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-wobble-jelly" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-wobble-i:${intensity};--hf-wobble-spd:${speed}s;"></div>`;
    }
    case "spin-hypnotic": {
      const speed = numberParameter(parameters, "speed", 8, 2, 20);
      const size = Math.round(numberParameter(parameters, "size", 300, 100, 600));
      return `<div id="${escapeHtml(elementId)}" class="clip hf-spin-hypnotic" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-spin-spd:${speed}s;--hf-spin-size:${size}px;"></div>`;
    }
    case "ripple-water": {
      const x = numberParameter(parameters, "x", 50, 0, 100);
      const y = numberParameter(parameters, "y", 50, 0, 100);
      const speed = numberParameter(parameters, "speed", 2, 0.5, 5);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-ripple-water" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${x}%;top:${y}%;--hf-ripple-spd:${speed}s;"></div>`;
    }
    case "fade-dip-black": {
      const hold = numberParameter(parameters, "hold", 0.3, 0.1, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-fade-dip-black" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-dip-hold:${hold}s;"></div>`;
    }
    case "flash-white": {
      const hold = numberParameter(parameters, "hold", 0.15, 0.05, 0.5);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-flash-white" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-flash-hold:${hold}s;"></div>`;
    }
    case "dream-soft": {
      const blur = numberParameter(parameters, "blur", 6, 2, 20);
      const glow = numberParameter(parameters, "glow", 0.4, 0.1, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-dream-soft" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-dream-blur:${blur}px;--hf-dream-glow:${glow};"></div>`;
    }
    case "dust-motes": {
      const count = Math.round(numberParameter(parameters, "count", 12, 4, 16));
      const speed = numberParameter(parameters, "speed", 18, 6, 40);
      let motes = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 31 + 5) % 100);
        const py = Math.round((i * 47 + 19) % 100);
        const delay = (((i * 0.8) % 6) - phaseOffsetS).toFixed(1);
        motes += `<span class="hf-mote" style="left:${px}%;top:${py}%;animation-delay:${delay}s;animation-duration:${speed}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-dust-motes" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${motes}</div>`;
    }
  }

  // --- Text-based templates (original) ---
  const className = window.templateId === "highlight-box" ? "hf-highlight" : window.templateId === "kinetic-caption" ? "hf-caption" : "hf-title";
  const content = window.templateId === "highlight-box" ? "" : text;
  return `<div id="${escapeHtml(elementId)}" class="clip ${className}" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${left}%;top:${top}%;font-size:${fontSize}px;color:${color};">${content}</div>`;
}

/** 本次请求中因依赖缺失被降级丢弃的 registry 模板(写进 artifact 供渲染证据链查询) */
export function collectDegradedRegistryTemplates(request: HyperFramesOverlayRequestV1): string[] {
  const degraded = new Set<string>();
  for (const window of request.windows) {
    if (isRegistryTemplate(window.templateId) && materializeRegistryTemplate(window.templateId) === null) {
      degraded.add(window.templateId);
    }
  }
  return [...degraded];
}

export function buildHyperFramesCompositionHtml(request: HyperFramesOverlayRequestV1, durationUs?: number): string {
  const derivedDurationUs = Math.max(...request.windows.map((window) => window.startUs + window.durationUs), 1_000);
  const compositionDurationUs = durationUs ?? derivedDurationUs;
  if (!Number.isSafeInteger(compositionDurationUs) || compositionDurationUs <= 0) {
    throw new Error("HyperFrames composition 时长必须是正整数微秒");
  }
  const durationS = compositionDurationUs / 1_000_000;
  const windows = request.windows.map(renderWindow).join("\n");
  // 收集 hy:* registry 模板的物化产物:styles/scripts/JS库/字体/数据 注入 composition
  const registryStyles: string[] = [];
  const registryScripts: string[] = [];
  const registryLibScripts: string[] = [];
  const registryFontStyles: string[] = [];
  const registryDataPreloads: string[] = [];
  const seenLibRels = new Set<string>();
  const seenTemplates = new Set<string>(); // 同模板多窗:body 逐窗渲染,脚本/样式只注入一次
  for (const window of request.windows) {
    if (isRegistryTemplate(window.templateId)) {
      const template = materializeRegistryTemplate(window.templateId);
      if (!template) continue; // 依赖缺失,renderWindow 已同步降级丢弃
      if (seenTemplates.has(window.templateId)) continue;
      seenTemplates.add(window.templateId);
      if (template.styles) registryStyles.push(template.styles);
      if (template.scripts) {
        // 每模板独立 IIFE+try/catch:34 个非 IIFE 模板的顶层标识符互不冲突,
        // 单模板脚本失败不连坐(此前多模板脚本拼进同一 <script>,一错全灭)
        const tag = window.templateId.replace(/[^A-Za-z0-9:-]/g, "");
        registryScripts.push(`;(function(){try{\n${template.scripts}\n}catch(e){console.warn('[hy-registry:${tag}] script failed:',e)}})();`);
      }
      if (template.fontStyles) registryFontStyles.push(template.fontStyles);
      if (template.dataPreload) registryDataPreloads.push(template.dataPreload);
      // 同一库多窗复用时只内联一次:以内容前缀粗判去重(libScripts 按模板聚合)
      for (const lib of template.libScripts) {
        const key = lib.slice(0, 128);
        if (seenLibRels.has(key)) continue;
        seenLibRels.add(key);
        registryLibScripts.push(lib);
      }
    }
  }
  const registryHeadInjection = [
    registryFontStyles.length ? `<style>/* --- Registry fonts (inlined, data-URI) --- */\n${registryFontStyles.join("\n")}\n</style>` : "",
    registryLibScripts.length || registryDataPreloads.length
      ? `<script>/* --- Registry deps (inlined) --- */\n${registryDataPreloads.join("\n")}\n${registryLibScripts.join("\n;\n")}\n</script>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
#stage{position:relative;width:${request.width}px;height:${request.height}px;background:transparent;overflow:hidden}
.clip{position:absolute;transform:translate(-50%,-50%);opacity:0;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-weight:700;text-shadow:0 3px 12px rgba(0,0,0,.45);animation:hf-in .24s ease-out forwards}
.clip.hy-registry-window{transform:none;left:0;top:0;white-space:normal;opacity:1;animation:none;text-shadow:none;font-weight:400}
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
/* 08-18-hy-effects Phase 1 本地自写装饰模板——CSS 与 renderWindow 分支一一对应。
   全部 mix-blend-mode:screen/overlay+透明渐变(alpha overlay 语义);渐变/滤镜元素数
   控制在 lint 阈值内(单窗<30)。 */
.hf-ink-bloom{width:60%;height:60%;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,hsla(220,15%,30%,calc(var(--hf-ink,.5)*.55)) 0%,hsla(220,10%,40%,calc(var(--hf-ink,.5)*.28)) 40%,transparent 70%);mix-blend-mode:multiply;animation:hf-ink-spread 7s ease-out infinite}
@keyframes hf-ink-spread{0%{transform:translate(-50%,-50%) scale(.4);opacity:0}30%{opacity:1}100%{transform:translate(-50%,-50%) scale(1.25);opacity:.25}}
.hf-mist-drift{width:100%;height:100%;left:0;top:0;background:radial-gradient(ellipse 60% 38% at 30% 72%,hsla(210,20%,88%,var(--hf-mist,.25)),transparent 70%),radial-gradient(ellipse 50% 30% at 70% 40%,hsla(200,15%,85%,calc(var(--hf-mist,.25)*.7)),transparent 70%);mix-blend-mode:screen;animation:hf-mist-move var(--hf-mist-speed,14s) ease-in-out infinite alternate}
@keyframes hf-mist-move{from{transform:translateX(-6%)}to{transform:translateX(6%)}}
.hf-gold-flecks{width:100%;height:100%;left:0;top:0}
.hf-fleck{position:absolute;width:5px;height:5px;border-radius:50%;background:radial-gradient(circle,hsla(43,90%,68%,.9),transparent 70%);opacity:calc(var(--hf-fleck,.5)*.9);mix-blend-mode:screen;animation:hf-fleck-float 5s ease-in-out infinite alternate}
@keyframes hf-fleck-float{from{transform:translateY(0) scale(.8)}to{transform:translateY(-26px) scale(1.15)}}
.hf-brush-sweep{width:100%;height:100%;left:0;top:0;background:linear-gradient(105deg,transparent 30%,hsla(var(--hf-brush-hue,210deg),35%,72%,.34) 47%,hsla(calc(var(--hf-brush-hue,210deg) + 24deg),45%,80%,.5) 50%,hsla(var(--hf-brush-hue,210deg),35%,72%,.34) 53%,transparent 70%);mix-blend-mode:screen;animation:hf-brush-move var(--hf-brush-speed,3s) ease-in-out infinite}
@keyframes hf-brush-move{0%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
.hf-paper-breath{width:100%;height:100%;left:0;top:0;background:radial-gradient(ellipse at 50% 45%,hsla(38,42%,86%,calc(var(--hf-warmth,.15)*.8)),transparent 75%);mix-blend-mode:soft-light;animation:hf-paper-pulse var(--hf-breath-speed,6s) ease-in-out infinite alternate}
@keyframes hf-paper-pulse{from{opacity:.55}to{opacity:1}}
.hf-candle-flicker{width:55%;height:55%;transform:translate(-50%,-50%);background:radial-gradient(circle,hsla(36,88%,64%,calc(var(--hf-candle,.4)*.85)) 0%,hsla(28,80%,52%,calc(var(--hf-candle,.4)*.4)) 45%,transparent 72%);mix-blend-mode:overlay;animation:hf-candle-flk 1.6s steps(3,end) infinite alternate}
@keyframes hf-candle-flk{0%{transform:translate(-50%,-50%) scale(1)}40%{transform:translate(-50%,-50%) scale(1.08) translateY(-1%)}100%{transform:translate(-50%,-50%) scale(.94)}}
.hf-moon-glow{width:var(--hf-moon-size,260px);height:var(--hf-moon-size,260px);transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,hsla(210,30%,92%,.95) 0%,hsla(205,32%,84%,.6) 32%,hsla(200,28%,78%,.25) 55%,transparent 72%);mix-blend-mode:screen;animation:hf-moon-breathe 9s ease-in-out infinite alternate}
@keyframes hf-moon-breathe{from{filter:brightness(.92)}to{filter:brightness(1.08)}}
.hf-rain-streaks{width:100%;height:100%;left:0;top:0}
.hf-rain{position:absolute;top:-12%;width:1.5px;height:13%;background:linear-gradient(to bottom,transparent,hsla(205,34%,84%,.55),transparent);mix-blend-mode:screen;animation:hf-rain-fall linear infinite}
@keyframes hf-rain-fall{to{transform:translateY(125vh)}}
.hf-snow-drift{width:100%;height:100%;left:0;top:0}
.hf-snow{position:absolute;top:-6%;width:6px;height:6px;border-radius:50%;background:radial-gradient(circle,hsla(0,0%,98%,.9),transparent 75%);mix-blend-mode:screen;animation:hf-snow-fall ease-in-out infinite}
@keyframes hf-snow-fall{to{transform:translate(24px,115vh)}}
.hf-aura-pulse{width:100%;height:100%;left:0;top:0;background:radial-gradient(circle at 50% 52%,transparent 34%,hsla(160,55%,70%,calc(var(--hf-aura,.35)*.5)) 48%,transparent 62%);mix-blend-mode:screen;animation:hf-aura-ring var(--hf-aura-speed,2.5s) ease-in-out infinite}
@keyframes hf-aura-ring{0%{transform:scale(.85);opacity:.2}50%{opacity:1}100%{transform:scale(1.1);opacity:.2}}
.hf-sword-flash{width:100%;height:100%;left:0;top:0;background:linear-gradient(to bottom,transparent 46%,hsla(48,95%,88%,.9) 50%,transparent 54%);mix-blend-mode:screen;animation:hf-sword-slash 2.4s ease-out infinite}
@keyframes hf-sword-slash{0%{transform:rotate(var(--hf-sword-angle,24deg)) translateX(-90%);opacity:0}18%{opacity:1}45%{transform:rotate(var(--hf-sword-angle,24deg)) translateX(70%);opacity:0}100%{opacity:0}}
.hf-seal-glow{width:34%;height:26%;right:4%;bottom:6%;background:radial-gradient(ellipse,hsla(6,72%,52%,calc(var(--hf-seal,.3)*.75)),transparent 70%);mix-blend-mode:screen;animation:hf-seal-pulse 4.5s ease-in-out infinite alternate}
@keyframes hf-seal-pulse{from{opacity:.4}to{opacity:1}}
/* 2026-08-19 动画手法：速度线/冲击波纹/呼吸光 */
.hf-speed-lines{width:100%;height:100%;left:0;top:0;transform:none;--hf-sp-count:24;opacity:var(--hf-speed,.5);background:repeating-conic-gradient(from var(--hf-speed-dir,0deg) at 50% 50%,transparent 0deg,rgba(255,255,255,.6) .5deg,transparent 1deg,transparent 15deg);mask-image:radial-gradient(circle,transparent 20%,black 40%,black 100%);-webkit-mask-image:radial-gradient(circle,transparent 20%,black 40%,black 100%);mix-blend-mode:screen;animation:hf-speed-pulse .15s steps(2) infinite}
@keyframes hf-speed-pulse{from{opacity:calc(var(--hf-speed,.5)*.7)}to{opacity:var(--hf-speed,.5)}}
.hf-shockwave{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-wave,.6)}
.hf-shockwave::before,.hf-shockwave::after{content:"";position:absolute;left:50%;top:50%;width:8px;height:8px;border:3px solid rgba(255,255,255,.9);border-radius:50%;transform:translate(-50%,-50%);animation:hf-wave-expand var(--hf-wave-speed,1.5s) ease-out infinite}
.hf-shockwave::after{animation-delay:calc(var(--hf-wave-speed,1.5s)*.3);border-color:rgba(255,220,120,.7)}
@keyframes hf-wave-expand{from{width:8px;height:8px;opacity:1}to{width:120%;height:120%;opacity:0}}
.hf-breathing-light{width:100%;height:100%;left:0;top:0;transform:none;background:radial-gradient(ellipse at 50% 40%,hsla(var(--hf-breathe-hue,45deg),80%,70%,calc(var(--hf-breathe-l,.35)*.5)),transparent 65%);mix-blend-mode:screen;animation:hf-breathe-glow var(--hf-breathe-speed,3s) ease-in-out infinite alternate}
@keyframes hf-breathe-glow{from{opacity:.3}to{opacity:1}}
.hf-dust-motes{width:100%;height:100%;left:0;top:0}
.hf-mote{position:absolute;width:7px;height:7px;border-radius:50%;background:radial-gradient(circle,hsla(44,70%,84%,.5),transparent 72%);mix-blend-mode:screen;animation:hf-mote-drift ease-in-out infinite alternate}
@keyframes hf-mote-drift{from{transform:translate(0,0)}to{transform:translate(18px,-38px)}}
.hf-letterbox::before,.hf-letterbox::after{content:"";position:absolute;left:0;width:100%;height:var(--hf-bar-height,10%);background:#000}
.hf-letterbox::before{top:0}
.hf-letterbox::after{bottom:0}
@keyframes hf-letterbox-in{from{opacity:0}to{opacity:1}}

@keyframes hf-in{from{opacity:0;transform:translate(-50%,-50%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
${registryStyles.length ? `\n/* --- Registry templates (${registryStyles.length}) --- */\n${registryStyles.join("\n")}\n` : ""}

/* --- 08-21 剪映风格特效 CSS(20 新) --- */
/* 故障/复古类 */
.hf-glitch-rgb{width:100%;height:100%;left:0;top:0;transform:none;mix-blend-mode:screen;opacity:var(--hf-glitch-i,.6);background:linear-gradient(90deg,rgba(255,0,60,.3) 0%,transparent 20%,rgba(0,255,255,.3) 80%,rgba(255,0,60,.3) 100%);animation:hf-glitch-shift var(--hf-glitch-spd,3s) steps(2) infinite}
@keyframes hf-glitch-shift{0%{transform:translateX(0)}25%{transform:translateX(-6px)}50%{transform:translateX(4px)}75%{transform:translateX(-2px)}100%{transform:translateX(0)}}
.hf-glitch-slice{width:100%;height:100%;left:0;top:0;transform:none;overflow:hidden;opacity:var(--hf-slice-i,.5)}
.hf-glitch-strip{position:absolute;left:0;width:100%;height:16%;background:rgba(0,255,240,.08);border-top:1px solid rgba(255,0,60,.3);animation:hf-strip-jitter .3s steps(3) infinite}
@keyframes hf-strip-jitter{0%{transform:translateX(0)}50%{transform:translateX(8px)}100%{transform:translateX(-4px)}}
.hf-glitch-scanline{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-scan-i,.4);background:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,255,255,.15) 2px 3px);animation:hf-scan-move var(--hf-scan-spd,8s) linear infinite}
@keyframes hf-scan-move{from{background-position-y:0}to{background-position-y:100px}}
.hf-vhs-rewind{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-vhs-i,.5);background:linear-gradient(180deg,hsla(var(--hf-vhs-hue,280deg),80%,60%,.15) 0%,transparent 40%,hsla(120,80%,60%,.1) 100%);mix-blend-mode:screen;animation:hf-vhs-noise .2s steps(2) infinite}
@keyframes hf-vhs-noise{0%{filter:hue-rotate(0deg) contrast(1.2)}50%{filter:hue-rotate(30deg) contrast(1.4)}100%{filter:hue-rotate(0deg) contrast(1.2)}}
.hf-pixel-blur{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-pixel-i,.5);backdrop-filter:blur(var(--hf-pixel-size,12px)) contrast(1.5) saturate(1.5);animation:hf-pixel-pulse 2s ease-in-out infinite alternate}
@keyframes hf-pixel-pulse{from{opacity:var(--hf-pixel-i,.5)}to{opacity:calc(var(--hf-pixel-i,.5) * .5)}}

/* 光效/粒子类 */
.hf-strobe-flash{width:100%;height:100%;left:0;top:0;transform:none;background:hsla(var(--hf-strobe-hue,60deg),100%,80%,.6);mix-blend-mode:screen;animation:hf-strobe-blink var(--hf-strobe-spd,4s) steps(1) infinite}
@keyframes hf-strobe-blink{0%,49%{opacity:0}50%,54%{opacity:.7}55%,100%{opacity:0}}
.hf-neon-glow{width:100%;height:100%;left:0;top:0;transform:none;background:radial-gradient(ellipse at 50% 50%,hsla(var(--hf-neon-hue,190deg),100%,60%,calc(var(--hf-neon-i,.7)*.3)),hsla(calc(var(--hf-neon-hue,190deg) + 60deg),100%,50%,calc(var(--hf-neon-i,.7)*.1)) 50%,transparent 80%);mix-blend-mode:screen;animation:hf-neon-pulse 2s ease-in-out infinite alternate}
@keyframes hf-neon-pulse{from{filter:brightness(1)}to{filter:brightness(1.4)}}
.hf-bokeh-lights{width:100%;height:100%;left:0;top:0}
.hf-bokeh{position:absolute;border-radius:50%;background:radial-gradient(circle,hsla(var(--hf-bokeh-hue,40deg),80%,70%,.5) 0%,transparent 70%);mix-blend-mode:screen;animation:hf-bokeh-drift ease-in-out infinite alternate}
@keyframes hf-bokeh-drift{from{transform:translate(0,0) scale(.8);opacity:.4}to{transform:translate(15px,-25px) scale(1.1);opacity:.7}}
.hf-star-twinkle{width:100%;height:100%;left:0;top:0}
.hf-star{position:absolute;width:8px;height:8px;background:radial-gradient(circle,white 0%,rgba(255,255,200,.5) 40%,transparent 70%);clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);animation:hf-star-blink ease-in-out infinite alternate}
@keyframes hf-star-blink{from{opacity:.2;transform:scale(.6) rotate(0deg)}to{opacity:1;transform:scale(1.2) rotate(15deg)}}
.hf-confetti-burst{width:100%;height:100%;left:0;top:0}
.hf-confetti{position:absolute;top:-3%;width:10px;height:16px;border-radius:2px;animation:hf-confetti-fall linear infinite}
@keyframes hf-confetti-fall{from{transform:translateY(-10px) rotate(0deg);opacity:1}to{transform:translateY(110vh) rotate(360deg);opacity:.6}}
.hf-heart-float{width:100%;height:100%;left:0;top:0}
.hf-heart{position:absolute;bottom:-5%;color:rgba(255,80,120,.7);text-shadow:0 0 10px rgba(255,80,120,.4);animation:hf-heart-up linear infinite}
@keyframes hf-heart-up{from{transform:translateY(0) scale(.8);opacity:.8}to{transform:translateY(-110vh) scale(1.2) rotate(20deg);opacity:.3}}
.hf-bubble-rise{width:100%;height:100%;left:0;top:0}
.hf-bubble{position:absolute;bottom:-5%;border-radius:50%;border:2px solid rgba(100,200,255,.3);background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.3),rgba(100,200,255,.1) 60%,transparent);animation:hf-bubble-up linear infinite}
@keyframes hf-bubble-up{from{transform:translateY(0);opacity:.5}to{transform:translateY(-110vh) translateX(10px);opacity:.2}}

/* 动态/过渡类 */
.hf-zoom-pulse{width:100%;height:100%;left:0;top:0;transform:scale(1);backdrop-filter:brightness(1.05);animation:hf-zoom-breath var(--hf-zoom-spd,2s) ease-in-out infinite alternate}
@keyframes hf-zoom-breath{from{transform:scale(1)}to{transform:scale(calc(1 + var(--hf-zoom-i,.06)))}}
.hf-shake-eq{width:100%;height:100%;left:0;top:0;transform:none;animation:hf-shake-rumble var(--hf-shake-spd,.1s) linear infinite}
@keyframes hf-shake-rumble{0%{transform:translate(var(--hf-shake-i,8px),0)}25%{transform:translate(calc(var(--hf-shake-i,8px) * -.5),calc(var(--hf-shake-i,8px) * .5))}50%{transform:translate(calc(var(--hf-shake-i,8px) * .7),calc(var(--hf-shake-i,8px) * -.3))}75%{transform:translate(calc(var(--hf-shake-i,8px) * -.3),calc(var(--hf-shake-i,8px) * .7))}100%{transform:translate(var(--hf-shake-i,8px),0)}}
.hf-wobble-jelly{width:100%;height:100%;left:0;top:0;transform:none;animation:hf-wobble-jello var(--hf-wobble-spd,3s) ease-in-out infinite}
@keyframes hf-wobble-jello{0%,100%{transform:skewX(0deg) skewY(0deg)}25%{transform:skewX(calc(var(--hf-wobble-i,.02) * 100deg)) skewY(calc(var(--hf-wobble-i,.02) * -50deg))}50%{transform:skewX(calc(var(--hf-wobble-i,.02) * -100deg)) skewY(calc(var(--hf-wobble-i,.02) * 50deg))}75%{transform:skewX(calc(var(--hf-wobble-i,.02) * 50deg)) skewY(0deg)}}
.hf-spin-hypnotic{left:50%;top:50%;width:var(--hf-spin-size,300px);height:var(--hf-spin-size,300px);border-radius:50%;border:6px dashed rgba(255,255,255,.3);border-top-color:rgba(100,200,255,.5);border-bottom-color:rgba(255,100,200,.5);animation:hf-spin-rotate var(--hf-spin-spd,8s) linear infinite}
@keyframes hf-spin-rotate{from{transform:translate(-50%,-50%) rotate(0deg)}to{transform:translate(-50%,-50%) rotate(360deg)}}
.hf-ripple-water{width:200px;height:200px;border-radius:50%;border:3px solid rgba(100,200,255,.4);animation:hf-ripple-expand var(--hf-ripple-spd,2s) ease-out infinite}
@keyframes hf-ripple-expand{from{transform:translate(-50%,-50%) scale(.2);opacity:.8}to{transform:translate(-50%,-50%) scale(3);opacity:0}}
.hf-fade-dip-black{width:100%;height:100%;left:0;top:0;transform:none;background:#000;animation:hf-dip-blink var(--hf-dip-hold,.3s) linear infinite}
@keyframes hf-dip-blink{0%,100%{opacity:0}50%{opacity:.8}}
.hf-flash-white{width:100%;height:100%;left:0;top:0;transform:none;background:white;animation:hf-flash-blink var(--hf-flash-hold,.15s) ease-out infinite}
@keyframes hf-flash-blink{0%{opacity:.9}100%{opacity:0}}
.hf-dream-soft{width:100%;height:100%;left:0;top:0;transform:none;backdrop-filter:blur(var(--hf-dream-blur,6px)) brightness(1.1) saturate(1.2);background:radial-gradient(ellipse at 50% 40%,rgba(255,200,255,calc(var(--hf-dream-glow,.4)*.3)),transparent 70%);mix-blend-mode:soft-light;animation:hf-dream-breathe 3s ease-in-out infinite alternate}
@keyframes hf-dream-breathe{from{opacity:var(--hf-dream-glow,.4)}to{opacity:calc(var(--hf-dream-glow,.4) * .6)}}

</style>${registryHeadInjection}</head><body><div id="stage" data-composition-id="mystudio-overlay" data-no-timeline data-start="0" data-duration="${durationS}" data-width="${request.width}" data-height="${request.height}" data-fps="${request.fps}">
${windows}
</div>${registryScripts.length ? `<script>\n${registryScripts.join("\n")}\n</script>` : ""}<script>
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
  // registry 模板源码(上游 HTML)普遍含 Math.random/rAF/未作用域选择器,--strict-all
  // 严格 lint 必拒(08-22 实证);仅纯本地合成保留 strict,registry 合成放宽 lint 仍走同渲染器
  const strict = request.windows.some((w) => isRegistryTemplate(w.templateId)) ? [] : ["--strict-all"];
  return ["render", projectDir, "--format", format, "--output", outputPath, "--fps", String(request.fps), "--quiet", ...strict];
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

function assertPngSequenceOutput(
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
    const degradedTemplateIds = collectDegradedRegistryTemplates(validated.value);
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
      ...(degradedTemplateIds.length ? { degradedTemplateIds } : {}),
      toolVersion: TOOL_VERSION,
      generatedAt: Date.now(),
    };
  } catch (error) {
    // 08-22 观测性补:execFileSync 的 stderr 藏着 HY CLI 真实根因(strict 违例
    // /浏览器崩溃等),此前被吞只剩命令行本身——排障必须能看见。
    const detail = error instanceof Error
      ? `${error.message}${typeof (error as unknown as { stderr?: unknown }).stderr === "string" && ((error as unknown as { stderr: string }).stderr).trim() ? ` | stderr: ${((error as unknown as { stderr: string }).stderr).trim().slice(-600)}` : ""}`
      : String(error);
    return blocked(validated.value, "render-failed", detail);
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