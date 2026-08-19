/**
 * 图层分离分层成片实证（08-19 图层分离探索，收官实证）：
 * 取真实项目 6 张分镜成图 → 逐镜 python 深度分离（缓存）→ DaojieTimeline
 * 多镜分层视差成片（每镜 4s，运镜/环境动画/视差强度各异，cut 衔接）。
 * 运行: vite-node --config build/timeline/vite-node.config.ts build/scripts/layer-parallax-chapter.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";

const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const MA = "/Users/zhengbingjin/Project/IP/MA";
const WORK = "/tmp/layer-sep/multi";
const OUT = path.join(WORK, "layer-parallax-chapter.mp4");
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const BACKEND = path.join(APPS_ROOT, "backend");
const FPS = 30;
const SHOT_FRAMES = 120; // 4s/镜

// 镜图选择:章节 001 的 6 张成图,覆盖人物/场景/特写不同构图
const SHOTS: Array<{ id: string; file: string; motion: { fromScale: number; toScale: number; originX: number; originY: number }; ambientType: "float" | "breathe" | "sway" | "pulse" | "flow"; parallax: number }> = [
  { id: "s001", file: "storyboard-flow-chapter-001-001", motion: { fromScale: 1.0, toScale: 1.08, originX: 0.5, originY: 0.5 }, ambientType: "float", parallax: 0.5 },
  { id: "s007", file: "storyboard-flow-chapter-001-007", motion: { fromScale: 1.06, toScale: 1.0, originX: 0.5, originY: 0.4 }, ambientType: "breathe", parallax: 0.7 },
  { id: "s019", file: "storyboard-flow-chapter-001-019", motion: { fromScale: 1.02, toScale: 1.1, originX: 0.7, originY: 0.5 }, ambientType: "sway", parallax: 0.4 },
  { id: "s026", file: "storyboard-flow-chapter-001-026", motion: { fromScale: 1.0, toScale: 1.06, originX: 0.3, originY: 0.6 }, ambientType: "pulse", parallax: 0.6 },
  { id: "s031", file: "storyboard-flow-chapter-001-031", motion: { fromScale: 1.08, toScale: 1.0, originX: 0.5, originY: 0.5 }, ambientType: "flow", parallax: 0.55 },
  { id: "s043", file: "storyboard-flow-chapter-001-043", motion: { fromScale: 1.0, toScale: 1.12, originX: 0.5, originY: 0.45 }, ambientType: "float", parallax: 0.8 },
];

/** 逐镜深度分离(python separator,产物缓存到 WORK/<id>/) */
function ensureLayers(shot: (typeof SHOTS)[number]): { background: string; subject: string } {
  const dir = path.join(WORK, shot.id);
  const background = path.join(dir, "background.png");
  const subject = path.join(dir, "subject.png");
  if (fs.existsSync(background) && fs.existsSync(subject)) return { background, subject };
  const shotDir = path.join(MA, "workflow-images/chapter-001", shot.file);
  const input = fs.readdirSync(shotDir).find((f) => f.includes("成图") && f.endsWith(".png"));
  if (!input) throw new Error("镜图缺失: " + shotDir);
  const inputPath = path.join(shotDir, input);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("python3", ["-m", "layer_separation.separator", "--input", inputPath, "--subject-out", subject, "--background-out", background], {
    cwd: BACKEND,
    env: { ...process.env, HF_HOME: path.join(USER_DATA, "DeepModel") },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return { background, subject };
}

async function main() {
  const bundlePath = path.join(APPS_ROOT, ".cache", "remotion-bundle");
  if (!fs.existsSync(bundlePath)) throw new Error("bundle 不存在");
  fs.mkdirSync(WORK, { recursive: true });

  const layers = SHOTS.map((s) => ({ id: s.id, ...ensureLayers(s) }));
  console.log("分离完成:", layers.map((l) => l.id).join(","));

  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  const urlByShot: Record<string, { bg: string; subj: string }> = {};
  for (const l of layers) {
    session.register(`${l.id}-bg`, l.background);
    session.register(`${l.id}-subj`, l.subject);
    const [bg, subj] = mediaBridge.buildUrls(session, [`${l.id}-bg`, `${l.id}-subj`]).map((e) => e.url);
    urlByShot[l.id] = { bg, subj };
  }

  const visualClips = SHOTS.map((shot, i) => ({
    clipId: `clip-layered-${shot.id}`,
    kind: "image" as const,
    src: urlByShot[shot.id].bg,
    from: i * SHOT_FRAMES,
    durationInFrames: SHOT_FRAMES,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    panZoom: shot.motion,
    ambient: { type: shot.ambientType, ampX: 0.4, ampY: 0.5, ampScale: 0.008, ampRot: 0.3, freq: 0.25, phase: i * 0.17 },
    layers: { backgroundSrc: urlByShot[shot.id].bg, subjectSrc: urlByShot[shot.id].subj, parallax: shot.parallax },
  }));

  const props = {
    width: 1920,
    height: 1080,
    fps: FPS,
    durationInFrames: SHOT_FRAMES * SHOTS.length,
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
    const composition = await selectComposition({ serveUrl: bundlePath, id: "DaojieTimeline", inputProps: props as never });
    const t0 = Date.now();
    await renderMedia({
      serveUrl: bundlePath, composition, inputProps: props as never, outputLocation: OUT,
      codec: "h264", pixelFormat: "yuv420p", crf: 16, x264Preset: "slow",
      browserExecutable: (browser as unknown as { executablePath: string }).executablePath,
      binariesDirectory: path.join(APPS_ROOT, "node_modules", "@remotion", "compositor-darwin-arm64"),
      chromeMode: "headless-shell", enforceAudioTrack: false, overwrite: true, concurrency: 2,
    } as never);
    console.log(`OK ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)}s, ${SHOTS.length} 镜分层视差)`);
  } finally {
    process.chdir(prevCwd);
    await mediaBridge.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
