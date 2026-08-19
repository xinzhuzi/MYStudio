/**
 * 多层视差+前景遮挡+程序化粒子实证（08-19 多层合成探索）：
 * 在图层分离双层视差（layer-parallax-proof）之上，按「原生多层」思路加两层——
 *   L0 背景（深度分离产物）懒运镜；L1 主体满运镜+float；
 *   L2 前景雾带×2（程序化 CSS 渐变+blur，screen 混合，近快远慢，穿人物身前=遮挡证明）；
 *   L3 光尘粒子×48（seeded PRNG 确定性，向右上飘+闪烁，同参考视频氛围层）。
 * 组合=独立 entry.tsx（apps/.cache/multilayer-poc/，不入产品 bundle）现场打包，
 * 渲染=@remotion/renderer renderMedia（与章节出品同款管线）。
 * 运行: cd apps && vite-node --config build/timeline/vite-node.config.ts build/scripts/multilayer-parallax-proof.ts
 */
import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";

const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const LAYERS_DIR = "/tmp/layer-sep";
const POC_DIR = path.join(APPS_ROOT, ".cache", "multilayer-poc");
const OUT = path.join(POC_DIR, "multilayer-parallax-proof.mp4");
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const FPS = 30;
const DURATION = 240; // 8s

// entry 代码不用反引号/模板字符串，便于在此模板内安全内嵌。
const ENTRY_TEMPLATE = `
import React from "react";
import { AbsoluteFill, Composition, Img, registerRoot, useCurrentFrame, useVideoConfig } from "remotion";

// ---------- 确定性 PRNG（mulberry32）：粒子场种子化，逐帧可复现 ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var BG_URL = "__BG_URL__";
var SUBJ_URL = "__SUBJ_URL__";

// ---------- 运镜：共享 push-in，按层折减（近=大动，远=懒动） ----------
function dampedScale(frame, dur, fromScale, toScale, damp) {
  var t = frame / dur;
  var s = fromScale + (toScale - fromScale) * t;
  return 1 + (s - 1) * damp;
}

// ---------- 周期环境运动（sin/cos，与产品 ambientAtFrame 同思路） ----------
function ambientOffset(frame, fps, freq, phase, ampXPct, ampYPct, rotDeg) {
  var w = (2 * Math.PI * freq * frame) / fps + phase;
  return {
    x: Math.sin(w) * ampXPct,
    y: Math.cos(w) * ampYPct,
    rot: Math.sin(w * 0.7) * rotDeg,
  };
}

// ---------- L3 光尘粒子场：seeded 一次生成，帧内只做相位推进 ----------
var PARTICLES = (function () {
  var rnd = mulberry32(20260819);
  var out = [];
  for (var i = 0; i < 48; i++) {
    out.push({
      x: rnd(),
      y: 0.1 + rnd() * 0.85,
      size: 2 + Math.round(rnd() * 4),
      speed: rnd(),                       // 0..1 → 决定飘速/闪烁频率
      phase: rnd() * Math.PI * 2,
      base: 0.35 + rnd() * 0.5,           // 基础不透明度
    });
  }
  return out;
})();

function ParticleField() {
  var frame = useCurrentFrame();
  var fps = useVideoConfig().fps;
  var t = frame / fps;
  return React.createElement(
    AbsoluteFill,
    { style: { pointerEvents: "none" } },
    PARTICLES.map(function (p, i) {
      var drift = (10 + p.speed * 16) / 100;   // 屏宽百分比/秒（向右）
      var rise = (7 + p.speed * 12) / 100;     // 屏高百分比/秒（向上）
      var x = (p.x + t * drift) % 1.08;
      var y = p.y - (t * rise) % 1.0;
      if (y < -0.02) y += 1.05;
      var tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.phase + t * (0.6 + p.speed * 1.6)));
      return React.createElement("div", {
        key: i,
        style: {
          position: "absolute",
          left: (x * 100).toFixed(3) + "%",
          top: (y * 100).toFixed(3) + "%",
          width: p.size,
          height: p.size,
          borderRadius: "50%",
          background: "rgba(255,246,218,1)",
          boxShadow: "0 0 " + (p.size * 2.4).toFixed(1) + "px rgba(255,240,200,0.9)",
          opacity: (p.base * tw).toFixed(3),
        },
      });
    })
  );
}

// ---------- L2 前景雾带：程序化椭圆渐变+blur，近快远慢，screen 混合发光 ----------
function FogBands() {
  var frame = useCurrentFrame();
  var fps = useVideoConfig().fps;
  var t = frame / fps;
  var bands = [
    // 远带：腰部高度，慢速横移，穿人物躯干（遮挡证明）
    { y: 0.50, h: 0.32, speed: 1.2, blur: 30, op: 0.16, bobF: 0.22, bobA: 1.2 },
    // 近带：下沿，更近更快
    { y: 0.72, h: 0.28, speed: 2.6, blur: 20, op: 0.22, bobF: 0.3, bobA: 1.8 },
  ];
  return React.createElement(
    AbsoluteFill,
    { style: { mixBlendMode: "screen", pointerEvents: "none" } },
    bands.map(function (b, i) {
      var grad =
        "radial-gradient(ellipse 55% 60% at 32% 50%, rgba(214,232,246,0.85), rgba(214,232,246,0) 72%)," +
        "radial-gradient(ellipse 45% 50% at 70% 42%, rgba(200,224,244,0.7), rgba(200,224,244,0) 70%)";
      var bob = Math.sin(t * b.bobF * Math.PI * 2 + i * 2.1) * b.bobA;
      // 每带渲染两份（相距 100% 屏宽）保证漂移中始终覆盖画面
      return [0, 1].map(function (copy) {
        var left = -((t * b.speed) % 100) + copy * 100;
        return React.createElement("div", {
          key: i + "-" + copy,
          style: {
            position: "absolute",
            left: left.toFixed(2) + "%",
            top: (b.y * 100 + bob).toFixed(2) + "%",
            width: "100%",
            height: (b.h * 100).toFixed(0) + "%",
            background: grad,
            filter: "blur(" + b.blur + "px)",
            opacity: b.op,
            borderRadius: "50%",
          },
        });
      });
    })
  );
}

// ---------- 主体层呼吸微缩放（叠加在运镜之上） ----------
function breatheScale(frame, fps, amp, freq) {
  var w = (2 * Math.PI * freq * frame) / fps;
  return 1 + Math.sin(w) * amp;
}

function MultiLayerScene() {
  var frame = useCurrentFrame();
  var fps = useVideoConfig().fps;

  // 共享 push-in 1.00→1.10；背景懒(damp 0.55)、主体满(damp 1.0)、近雾带更灵(damp 在 FogBands 内以漂移体现)
  var bgScale = dampedScale(frame, __DURATION__, 1.0, 1.1, 0.55);
  var subjScale = dampedScale(frame, __DURATION__, 1.0, 1.1, 1.0);
  var subjAmb = ambientOffset(frame, fps, 0.22, 0.6, 0.3, 0.35, 0.15);

  var layerBase = { position: "absolute", inset: 0 };
  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: "#0b1016" } },
    // L0 背景：懒运镜 + 极慢横向漂移（远山云雾感）
    React.createElement(
      AbsoluteFill,
      {
        style: {
          transform:
            "scale(" + bgScale.toFixed(4) + ") translateX(" +
            (Math.sin((frame / fps) * 0.1) * 0.4).toFixed(2) + "%)",
          transformOrigin: "50% 55%",
        },
      },
      React.createElement(Img, { src: BG_URL, style: { width: "100%", height: "100%", objectFit: "cover" } })
    ),
    // L1 主体：满 push-in + float 周期运动 + 呼吸微缩放
    React.createElement(
      AbsoluteFill,
      {
        style: {
          transform:
            "scale(" + (subjScale * breatheScale(frame, fps, 0.006, 0.18)).toFixed(4) + ") translate(" +
            subjAmb.x.toFixed(2) + "%, " + subjAmb.y.toFixed(2) + "%) rotate(" +
            subjAmb.rot.toFixed(2) + "deg)",
          transformOrigin: "45% 65%",
        },
      },
      React.createElement(Img, { src: SUBJ_URL, style: { width: "100%", height: "100%", objectFit: "cover" } })
    ),
    // L2 前景雾带（遮挡层）
    React.createElement(FogBands, null),
    // L3 光尘粒子
    React.createElement(ParticleField, null)
  );
}

export var RemotionRoot = function () {
  return React.createElement(Composition, {
    id: "MultiLayerProof",
    component: MultiLayerScene,
    durationInFrames: __DURATION__,
    fps: __FPS__,
    width: 1920,
    height: 1080,
  });
};

registerRoot(RemotionRoot);
`;

async function main() {
  fs.mkdirSync(POC_DIR, { recursive: true });

  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  session.register("mlp-background", path.join(LAYERS_DIR, "background2.png"));
  session.register("mlp-subject", path.join(LAYERS_DIR, "subject2.png"));
  const [bgUrl, subjUrl] = mediaBridge
    .buildUrls(session, ["mlp-background", "mlp-subject"])
    .map((e) => e.url);

  const entry = path.join(POC_DIR, "entry.tsx");
  fs.writeFileSync(
    entry,
    ENTRY_TEMPLATE.replace("__BG_URL__", bgUrl).replace("__SUBJ_URL__", subjUrl)
      .replace(/__DURATION__/g, String(DURATION))
      .replace(/__FPS__/g, String(FPS)),
    "utf8",
  );
  console.log(`[mlp] entry written: ${entry}`);

  const tBundle0 = Date.now();
  const serveUrl = await bundle({ entryPoint: entry, onProgress: () => {} });
  console.log(`[mlp] bundled in ${((Date.now() - tBundle0) / 1000).toFixed(1)}s`);

  const runtimeDir = path.join(USER_DATA, "remotion-runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const prevCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browser = await ensureBrowser({ allowFallback: true } as never);
    const composition = await selectComposition({ serveUrl, id: "MultiLayerProof" });
    const t0 = Date.now();
    await renderMedia({
      serveUrl,
      composition,
      outputLocation: OUT,
      codec: "h264",
      pixelFormat: "yuv420p",
      crf: 16,
      x264Preset: "slow",
      browserExecutable: (browser as unknown as { executablePath: string }).executablePath,
      binariesDirectory: path.join(APPS_ROOT, "node_modules", "@remotion", "compositor-darwin-arm64"),
      chromeMode: "headless-shell",
      enforceAudioTrack: false,
      overwrite: true,
      concurrency: 2,
    } as never);
    console.log(`[mlp] OK ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } finally {
    process.chdir(prevCwd);
    await mediaBridge.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
