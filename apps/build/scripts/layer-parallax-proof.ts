/**
 * 图层分离分层渲染实证（08-19 图层分离探索）：
 * 深度分离的 subject/background 两层 → LayeredVisualClip 双层视差短片。
 * 组合=ChapterVideo 手工最小 props（1 镜 5s，push-in + 主体 float 环境动画）；
 * 渲染=@remotion/renderer renderMedia（与章节出品同款管线）。
 * 运行: vite-node --config build/timeline/vite-node.config.ts build/scripts/layer-parallax-proof.ts
 */
import fs from "node:fs";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";

const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const LAYERS_DIR = "/tmp/layer-sep";
const OUT = path.join(LAYERS_DIR, "layer-parallax-proof.mp4");
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const FPS = 30;
const DURATION = 150; // 5s

async function main() {
  const bundlePath = path.join(APPS_ROOT, ".cache", "remotion-bundle");
  if (!fs.existsSync(bundlePath)) throw new Error("bundle 不存在");

  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  session.register("layer-background", path.join(LAYERS_DIR, "background2.png"));
  session.register("layer-subject", path.join(LAYERS_DIR, "subject2.png"));
  const [bgUrl, subjUrl] = mediaBridge.buildUrls(session, ["layer-background", "layer-subject"]).map((e) => e.url);

  const props = {
    width: 1920,
    height: 1080,
    fps: FPS,
    durationInFrames: DURATION,
    visualClips: [
      {
        clipId: "clip-layered-001",
        kind: "image",
        src: bgUrl, // 单层媒体位被 layers 覆盖；保留 bridge URL 供契约校验
        from: 0,
        durationInFrames: DURATION,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        panZoom: { fromScale: 1.0, toScale: 1.1, originX: 0.5, originY: 0.5 },
        ambient: { type: "float", ampX: 0.4, ampY: 0.5, ampScale: 0.008, ampRot: 0.3, freq: 0.25, phase: 0 },
        layers: { backgroundSrc: bgUrl, subjectSrc: subjUrl, parallax: 0.6 },
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
    console.log(`OK ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } finally {
    process.chdir(prevCwd);
    await mediaBridge.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
