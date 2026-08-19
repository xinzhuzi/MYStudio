/**
 * 多层合成章节验收(08-19 multilayer-composition Child4):
 * 6 个真实 chapter-001 镜头(深度拆层产物 /tmp/layer-sep/multi/,过渡期路径)
 * × 异构层配置(damp/ambient/模板组合互异)× 氛围模板(Child2 四组合轮换)
 * × 章节调色(cn-LUT)——全部经**产品固定 bundle**(DaojieTimeline)渲染,
 * 对拍参考视频四要素(遮挡雾带/光尘上飘/人物呼吸/远懒近灵)。
 * 说明: 一键成片正式管线的 plan/manifest/slot 身份链在本环境已漂移
 * (存量,inspectChapterVideoSource 老链路);本验收证明渲染侧全链,
 * 正式管线首次带层一键成片待应用内回流(记入任务 notes)。
 * 运行: cd apps && vite-node --config build/timeline/vite-node.config.ts build/scripts/multilayer-chapter-acceptance.ts
 */
import path from "node:path";
import fs from "node:fs";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";

const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const LAYERS = ["/tmp/layer-sep/multi/s001", "/tmp/layer-sep/multi/s007", "/tmp/layer-sep/multi/s019", "/tmp/layer-sep/multi/s026", "/tmp/layer-sep/multi/s031", "/tmp/layer-sep/multi/s043"];
const OUT = path.join(APPS_ROOT, ".cache", "multilayer-poc", "multilayer-chapter-acceptance.mp4");
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const FPS = 30;
const SHOT_FRAMES = 120; // 4s/镜 × 6 镜 = 24s
const CN_LUT = "cn-daiqing";

/** 6 镜异构配置:damp/ambient/模板组合互异(Child4 AC「层配置互异」)。 */
const SHOT_CONFIGS = [
  { bgDamp: 0.55, ambient: { type: "float", ampX: 0.003, ampY: 0.0035, ampScale: 0.006, ampRot: 0.15, freq: 0.22, phase: 0.6 }, atmo: [{ id: "atmo:fog-band", params: { y: 0.5, height: 0.32, speed: 1.2, blur: 30, opacity: 0.16 } }, { id: "atmo:light-dust", params: {} }] },
  { bgDamp: 0.7, ambient: { type: "breathe", ampX: 0, ampY: 0.002, ampScale: 0.008, ampRot: 0, freq: 0.3, phase: 0.2 }, atmo: [{ id: "atmo:mist-veil", params: {} }] },
  { bgDamp: 0.5, ambient: { type: "sway", ampX: 0.004, ampY: 0, ampScale: 0, ampRot: 0.3, freq: 0.2, phase: 0.8 }, atmo: [{ id: "atmo:light-dust", params: { count: 32 } }, { id: "atmo:fog-band", params: { y: 0.72, height: 0.28, speed: 2.6, blur: 20, opacity: 0.22 } }] },
  { bgDamp: 0.65, ambient: { type: "float", ampX: 0.002, ampY: 0.004, ampScale: 0.005, ampRot: 0.1, freq: 0.25, phase: 0.4 }, atmo: [{ id: "atmo:fireflies", params: {} }] },
  { bgDamp: 0.6, ambient: { type: "flow", ampX: 0.003, ampY: 0.002, ampScale: 0.004, ampRot: 0.2, freq: 0.18, phase: 0.9 }, atmo: [{ id: "atmo:embers", params: { count: 28 } }] },
  { bgDamp: 0.75, ambient: { type: "breathe", ampX: 0, ampY: 0.003, ampScale: 0.006, ampRot: 0, freq: 0.26, phase: 0.1 }, atmo: [{ id: "atmo:petals", params: {} }, { id: "atmo:mist-veil", params: { opacity: 0.08 } }] },
] as const;

async function main() {
  const bundlePath = path.join(APPS_ROOT, ".cache", "remotion-bundle");
  if (!fs.existsSync(bundlePath)) throw new Error("bundle 不存在");

  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  const lutsDir = path.join(APPS_ROOT, "frontend/assets/luts");
  const lutAsset = `lut-${CN_LUT}.png`;
  session.register(lutAsset, path.join(lutsDir, `${CN_LUT}.png`));

  const visualClips = LAYERS.map((dir, index) => {
    const config = SHOT_CONFIGS[index]!;
    session.register(`mla-bg-${index}`, path.join(dir, "background.png"));
    session.register(`mla-subj-${index}`, path.join(dir, "subject.png"));
    const [bgUrl, subjUrl] = mediaBridge.buildUrls(session, [`mla-bg-${index}`, `mla-subj-${index}`]).map((e) => e.url);
    return {
      clipId: `clip-mla-${index}`,
      kind: "image" as const,
      src: bgUrl,
      from: index * SHOT_FRAMES,
      durationInFrames: SHOT_FRAMES,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      panZoom: { fromScale: 1.0, toScale: 1.08, originX: 0.5, originY: 0.55 },
      grade: { lutId: CN_LUT, lutSrc: mediaBridge.buildUrls(session, [lutAsset])[0]!.url, blend: 0.12 },
      layerStack: [
        { role: "background" as const, src: bgUrl, panZoomDamp: config.bgDamp },
        { role: "subject" as const, src: subjUrl, ambient: config.ambient },
        ...config.atmo.map((entry, layerIndex) => ({
          role: "atmosphere" as const,
          template: { id: entry.id, params: entry.params as Record<string, number> },
          ...(layerIndex === 0 ? { blendMode: "screen" as const } : {}),
        })),
      ],
    };
  });

  const props = {
    width: 1920,
    height: 1080,
    fps: FPS,
    durationInFrames: SHOT_FRAMES * LAYERS.length,
    visualClips,
    transitions: [],
    audioClips: [],
    subtitles: [],
  };

  const runtimeDir = path.join(USER_DATA, "remotion-runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const prevCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browser = await ensureBrowser({ allowFallback: true } as never);
    const browserExecutable = (browser as unknown as { executablePath: string }).executablePath;
    // WebGL(grade→GLGradeMedia)需显式 swangle:ANGLE Vulkan 路径 BindToCurrentSequence
    // 失败是既有坑(gl-texture-poc 前科),产品 3D 线同款配置。
    const chromiumOptions = { gl: "swangle" } as never;
    const composition = await selectComposition({ serveUrl: bundlePath, id: "DaojieTimeline", inputProps: props as never, browserExecutable, chromiumOptions });
    const t0 = Date.now();
    await renderMedia({
      serveUrl: bundlePath, composition, inputProps: props as never, outputLocation: OUT,
      codec: "h264", pixelFormat: "yuv420p", crf: 16, x264Preset: "slow",
      browserExecutable,
      chromiumOptions,
      binariesDirectory: path.join(APPS_ROOT, "node_modules", "@remotion", "compositor-darwin-arm64"),
      chromeMode: "headless-shell", enforceAudioTrack: false, overwrite: true, concurrency: 2,
    } as never);
    console.log(`[mla] OK ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)}s, ${LAYERS.length}镜×${SHOT_FRAMES / FPS}s)`);
  } finally {
    process.chdir(prevCwd);
    await mediaBridge.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
