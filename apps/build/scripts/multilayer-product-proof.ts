/**
 * 多层合成产品 bundle 实证(08-19 multilayer-composition Child1 验收):
 * 与 multilayer-parallax-proof(临时 entry)不同,本脚本走**产品固定 bundle**
 * (DaojieTimeline 组合,entry=frontend/.../composition/entry.tsx)——验证
 * layerStack 四层(懒背景+浮主体+前景雾带遮挡+光尘粒子)在产品 bundle 内
 * 端到端渲染,proof 手法(atmosphere-layers.tsx)确已进包。
 * 前置: npm run remotion:bundle(改 composition 后须重建)。
 * 运行: cd apps && vite-node --config build/timeline/vite-node.config.ts build/scripts/multilayer-product-proof.ts
 */
import path from "node:path";
import fs from "node:fs";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";

const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const LAYERS_DIR = "/tmp/layer-sep";
const OUT = path.join(APPS_ROOT, ".cache", "multilayer-poc", "multilayer-product-proof.mp4");
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const FPS = 30;
const DURATION = 240; // 8s

async function main() {
  const bundlePath = path.join(APPS_ROOT, ".cache", "remotion-bundle");
  if (!fs.existsSync(bundlePath)) throw new Error("bundle 不存在,先 npm run remotion:bundle");

  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  session.register("mlp2-background", path.join(LAYERS_DIR, "background2.png"));
  session.register("mlp2-subject", path.join(LAYERS_DIR, "subject2.png"));
  const [bgUrl, subjUrl] = mediaBridge
    .buildUrls(session, ["mlp2-background", "mlp2-subject"])
    .map((e) => e.url);

  const props = {
    width: 1920,
    height: 1080,
    fps: FPS,
    durationInFrames: DURATION,
    visualClips: [
      {
        clipId: "clip-ml-001",
        kind: "image",
        src: bgUrl, // 单层媒体位被 layerStack 覆盖;保留供契约校验
        from: 0,
        durationInFrames: DURATION,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        panZoom: { fromScale: 1.0, toScale: 1.1, originX: 0.5, originY: 0.55 },
        layerStack: [
          // L0 懒背景(damp 0.55)
          { role: "background", src: bgUrl, panZoomDamp: 0.55 },
          // L1 主体:吃满运镜+float(clip 级 ambient 由 subject 层继承)
          { role: "subject", src: subjUrl, ambient: { type: "float", ampX: 0.003, ampY: 0.0035, ampScale: 0.006, ampRot: 0.15, freq: 0.22, phase: 0.6 } },
          // L2 前景雾带遮挡(程序化,穿人物身前)
          { role: "atmosphere", template: { id: "atmo:fog-band", params: { y: 0.5, height: 0.32, speed: 1.2, blur: 30, opacity: 0.16 } }, blendMode: "screen" },
          { role: "atmosphere", template: { id: "atmo:fog-band", params: { y: 0.72, height: 0.28, speed: 2.6, blur: 20, opacity: 0.22 } }, blendMode: "screen" },
          // L3 光尘粒子(seeded)
          { role: "atmosphere", template: { id: "atmo:light-dust", params: { count: 48, seed: 20260819 } } },
        ],
      },
    ],
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
    const composition = await selectComposition({ serveUrl: bundlePath, id: "DaojieTimeline", inputProps: props as never });
    const t0 = Date.now();
    await renderMedia({
      serveUrl: bundlePath, composition, inputProps: props as never, outputLocation: OUT,
      codec: "h264", pixelFormat: "yuv420p", crf: 16, x264Preset: "slow",
      browserExecutable: (browser as unknown as { executablePath: string }).executablePath,
      binariesDirectory: path.join(APPS_ROOT, "node_modules", "@remotion", "compositor-darwin-arm64"),
      chromeMode: "headless-shell", enforceAudioTrack: false, overwrite: true, concurrency: 2,
    } as never);
    console.log(`[mlp2] OK ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } finally {
    process.chdir(prevCwd);
    await mediaBridge.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
