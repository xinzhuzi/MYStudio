/**
 * 第二批 6 动画手法实证（08-19）：残影/速度剪影/神光/帧步进/调色脉动/水墨晕染转场。
 * 6 镜 × 3s,DaojieTimeline;镜间 ink-bleed 转场实证遮罩揭示。
 * 运行: vite-node --config build/timeline/vite-node.config.ts build/scripts/second-batch-fx-proof.ts
 */
import fs from "node:fs";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";

const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const MA = "/Users/zhengbingjin/Project/IP/MA";
const WORK = "/tmp/layer-sep";
const OUT = path.join(WORK, "second-batch-fx-proof.mp4");
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const FPS = 30;
const SHOT_FRAMES = 90; // 3s/镜
const LUTS = path.join(APPS_ROOT, "frontend/assets/luts");

const SHOT_DIRS = [
  "storyboard-flow-chapter-001-007",
  "storyboard-flow-chapter-001-019",
  "storyboard-flow-chapter-001-026",
  "storyboard-flow-chapter-001-031",
  "storyboard-flow-chapter-001-038",
  "storyboard-flow-chapter-001-043",
];

function shotImage(dir: string): string {
  const full = path.join(MA, "workflow-images/chapter-001", dir);
  const f = fs.readdirSync(full).find((x) => x.includes("成图") && x.endsWith(".png"));
  if (!f) throw new Error("镜图缺失: " + full);
  return path.join(full, f);
}

async function main() {
  const bundlePath = path.join(APPS_ROOT, ".cache", "remotion-bundle");
  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  const urls = SHOT_DIRS.map((d, i) => {
    session.register(`sb-${i}`, shotImage(d));
    return mediaBridge.buildUrls(session, [`sb-${i}`])[0]!.url;
  });
  // 调色脉动需要 LUT
  const lutFile = fs.readdirSync(LUTS).find((f) => f.endsWith(".png"))!;
  session.register("proof-lut", path.join(LUTS, lutFile));
  const lutUrl = mediaBridge.buildUrls(session, ["proof-lut"])[0]!.url;

  const base = { kind: "image" as const, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } };
  // 转场重叠压缩起点(与 HY 脚本同款): from_i = Σ时长 − Σ重叠
  const froms: number[] = [];
  { let acc = 0; for (let i = 0; i < SHOT_DIRS.length; i++) { froms.push(acc); acc += SHOT_FRAMES - 18; } }
  const clip = (i: number, extra: Record<string, unknown>) => ({
    clipId: `clip-${i}`,
    src: urls[i],
    from: froms[i],
    durationInFrames: SHOT_FRAMES,
    panZoom: { fromScale: 1.0, toScale: 1.06, originX: 0.5, originY: 0.5 },
    ...base,
    ...extra,
  });

  const visualClips = [
    clip(0, { fx: { afterimage: { copies: 3, offsetPx: 26, opacity: 0.5 } } }), // 残影
    clip(1, { fx: { speedSilhouette: { direction: "ltr" as const } } }), // 速度剪影
    clip(2, { fx: { godRays: { intensity: 0.7, hue: 42 } } }), // 神光
    clip(3, { frameStep: 2 }), // 帧步进 on twos
    clip(4, { grade: { lutId: "film-bleach-bypass", lutSrc: lutUrl, blend: 0.12, blendPulse: { amp: 0.08, freq: 0.35 } } }), // 调色脉动
    clip(5, {}), // 收尾镜,承接 ink-bleed 进场
  ];

  // 镜间全部用水墨晕染转场(重叠 18 帧)
  const transitions = visualClips.slice(0, -1).map((c, i) => ({
    fromClipId: c.clipId,
    toClipId: visualClips[i + 1]!.clipId,
    effectId: "ink-bleed",
    overlapFrames: 18,
  }));

  const props = {
    width: 1920, height: 1080, fps: FPS,
    durationInFrames: SHOT_FRAMES * visualClips.length,
    visualClips, transitions, audioClips: [], subtitles: [],
  };

  const runtimeDir = path.join(USER_DATA, "remotion-runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
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
      // grade(WebGL LUT)需要 SwiftShader:默认 headless-shell 须显式 swangle(与章节出品同款)
      chromiumOptions: { gl: "swangle" },
    } as never);
    console.log(`OK ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)}s, 6 手法)`);
  } finally {
    process.chdir(APPS_ROOT);
    await mediaBridge.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
