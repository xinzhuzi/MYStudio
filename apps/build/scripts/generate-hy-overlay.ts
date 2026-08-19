/**
 * 从零生成 HY overlay（Trellis 08-18-effect-upgrade 终验：overlay 进成片）。
 * 从 queue 的 chapter plan 读取镜头时序+转场→按 adapter.py 同款决策逻辑（mood+轮询+
 * 转场增强）生成窗口→HY worker 渲 ProRes 4444 alpha→落 r49。
 * 运行: cd apps && npx vite-node --config build/timeline/vite-node.config.ts build/scripts/generate-hy-overlay.ts
 */
import fs from "node:fs";
import path from "node:path";
import { ensureBrowser } from "@remotion/renderer";
import { createHyperFramesAdapter } from "@rendering/plugins/hyperframes/hyperframes-adapter";

const MA = "/Users/zhengbingjin/Project/IP/MA";
const QUEUE = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_remotion/queue/queue-state.json";
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const CHAPTER_ID = "chapter-001";
const REV = 49;
const FPS = 30;
const W = 1920, H = 1080;
const ELECTRON = process.execPath; // vite-node 的 node 不可用,需用 Electron——后面有正确路径

// adapter.py 同款决策表(镜像)
const TEMPLATES = ["light-leak","film-grain","lens-flare","vignette-pulse","particle-dust","letterbox-cinematic","highlight-box",
  "ink-bloom","mist-drift","gold-flecks","brush-sweep","paper-breath","candle-flicker","moon-glow","rain-streaks","snow-drift","aura-pulse","sword-flash","seal-glow","dust-motes"];
const DEFAULT_PARAMS: Record<string, Record<string, number>> = {
  "light-leak": { intensity: 0.42, hue: 0 },
  "film-grain": { opacity: 0.2 },
  "lens-flare": { x: 18, y: 24, size: 260 },
  "vignette-pulse": { darkness: 0.42, speed: 2.4 },
  "particle-dust": { count: 40, speed: 7 },
  "letterbox-cinematic": { barHeight: 12, fadeIn: 0.25 },
  "highlight-box": { x: 50, y: 50 },
  "ink-bloom": { intensity: 0.5, x: 50, y: 45 },
  "mist-drift": { opacity: 0.25, speed: 14 },
  "gold-flecks": { count: 8, intensity: 0.5 },
  "brush-sweep": { hue: 210, speed: 3 },
  "paper-breath": { warmth: 0.15, speed: 6 },
  "candle-flicker": { intensity: 0.4, x: 70, y: 65 },
  "moon-glow": { x: 24, y: 22, size: 260 },
  "rain-streaks": { count: 10, speed: 1.2 },
  "snow-drift": { count: 10, speed: 9 },
  "aura-pulse": { intensity: 0.35, speed: 2.5 },
  "sword-flash": { angle: 24 },
  "seal-glow": { intensity: 0.3 },
  "dust-motes": { count: 12, speed: 18 },
};
const ENHANCEMENT: Record<string, [string, Record<string, number>]> = {
  "crossfade": ["mist-drift", { opacity: 0.22, speed: 12 }],
  "fade": ["paper-breath", { warmth: 0.12, speed: 5 }],
  "flash": ["sword-flash", { angle: 24 }],
  "blackout": ["seal-glow", { intensity: 0.25 }],
};
function glEnhance(name: string): [string, Record<string, number>] {
  const n = name.toLowerCase();
  if (/zoom|scale|push|slide|wipe|directional|leftright|radial/.test(n)) return ["brush-sweep", { hue: 210, speed: 2 }];
  if (/dissolve|melt|wave|swap|fade|pixel|butterfly|mosaic|polka/.test(n)) return ["ink-bloom", { intensity: 0.45, x: 50, y: 45 }];
  if (/glitch|morph|burn|dreamy|cross/.test(n)) return ["aura-pulse", { intensity: 0.4, speed: 2 }];
  return ["dust-motes", { count: 12, speed: 14 }];
}

async function main() {
  const q = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  const jobs = (q as { jobs?: unknown[] }).jobs ?? (q as { state?: { jobs?: unknown[] } }).state!.jobs!;
  const entry = (jobs as Array<{ job: { target?: { kind?: string } }; plan?: any }>)
    .filter((it) => it.job.target?.kind === "chapter").pop();
  if (!entry?.plan) throw new Error("无 chapter 条目");
  const plan = entry.plan;

  // 镜头布局(与 adapter 同款:Σ时长−Σ重叠)
  const clips = plan.clips.filter((c: any) => c.trackKind === "video" || c.trackKind === "image")
    .filter((c: any) => c.id.startsWith("visual-sb"))
    .sort((a: any, b: any) => a.id.localeCompare(b.id));
  const trs = new Map(plan.transitions.map((t: any) => [t.fromClipId, t]));
  const starts: number[] = [];
  let acc = 0;
  for (const c of clips) {
    starts.push(acc);
    const t = trs.get(c.id);
    acc += Math.round(c.durationUs * FPS / 1_000_000) - (t && t.effectId !== "cut" ? Math.round(t.durationUs * FPS / 1_000_000) : 0);
  }

  // 窗口生成(装饰+转场增强,与 adapter._build_overlay_slots 同款)
  const windows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i], start = starts[i];
    const dur = Math.round(clip.durationUs / 1000); // µs→ms 上限 1100
    const t = trs.get(clip.id);
    const nextStart = i + 1 < starts.length ? starts[i + 1] : start + 999_999;
    let enhanceUs = 0;
    // 转场增强窗(出镜尾段)
    if (t && t.effectId !== "cut") {
      const enh = t.effectId.startsWith("gl:") ? glEnhance(t.effectId.slice(3)) : ENHANCEMENT[t.effectId];
      if (enh) {
        enhanceUs = Math.min(Math.round(t.durationUs / 1000), Math.max(1, nextStart - start - 1), 1100);
        windows.push({
          slotId: `transition-enh-${clip.id}`,
          cueId: `transition-enhancement-${i + 1}`,
          startUs: (nextStart - enhanceUs) * 1_000_000 / FPS * FPS, // frame→µs
          durationUs: enhanceUs * 1_000,
          templateId: enh[0], parameters: enh[1],
        });
      }
    }
    // 装饰窗
    const templateId = TEMPLATES[i % TEMPLATES.length];
    const params = { ...DEFAULT_PARAMS[templateId] ?? {} };
    if (templateId === "light-leak") params.hue = (i * 31) % 360;
    let decDur = Math.min(dur, nextStart - start - enhanceUs, 1100);
    if (decDur > 0) {
      windows.push({
        slotId: `effect-${clip.id}`,
        cueId: `decorative-effect-${i + 1}`,
        startUs: start * 1_000_000 / FPS * FPS,
        durationUs: decDur * 1_000,
        templateId, parameters: params,
      });
    }
  }
  // 排序+µs 换算
  windows.sort((a, b) => (a.startUs as number) - (b.startUs as number));
  console.log(`windows: ${windows.length}(装饰+增强), 时长覆盖≈${(windows.reduce((s, w) => s + (w.durationUs as number), 0) / 1e6).toFixed(1)}s`);

  // HY worker 渲染
  const outDir = path.join(MA, "video-use", CHAPTER_ID, `r${REV}`);
  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, "hyperframes-overlay.mov");
  const request = {
    schemaVersion: 1,
    projectId: "MA",
    chapterId: CHAPTER_ID,
    revision: REV,
    sourceArtifactSha256: "0".repeat(64),
    inputSha256: "0".repeat(64),
    width: W, height: H, fps: FPS,
    alphaFormat: "prores-4444-mov",
    outputPath,
    windows,
  };
  const runtimeDir = path.join(USER_DATA, "remotion-runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const prevCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browser = await ensureBrowser({ browserExecutable: undefined, chromiumOptions: {}, forceDeviceScaleFactor: undefined, allowFallback: true, onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); } } as never);
    const browserPath = (browser as unknown as { path: string }).path;
    process.env.HYPERFRAMES_BROWSER_PATH = browserPath;
    const adapter = createHyperFramesAdapter({
      storageBasePath: USER_DATA,
      workspaceRootForProject: () => path.join(MA, "video-use"),
      workerPath: "/Applications/漫影工作室.app/Contents/Resources/app.asar.unpacked/out/main/hyperframes-worker.cjs",
      resolveBrowserPath: async () => browserPath,
    } as never);
    const result = await adapter.renderOverlay(request as never);
    if (!result.success) throw new Error("HY 渲染失败: " + JSON.stringify(result).slice(0, 300));
    const stat = fs.statSync(outputPath);
    console.log(`✅ overlay 渲成: ${outputPath} (${(stat.size / 1e6).toFixed(1)}MB)`);
  } finally { process.chdir(prevCwd); }
  process.exit(0);
}
main().catch((e) => { console.error("❌", e); process.exit(1); });
