/**
 * 视频双纹理 PoC（Trellis 08-18-gl-transitions Step B / 复审 M5）。
 * 验证命题：两路 <video> → three.VideoTexture → ShaderMaterial 双纹理混合，
 * 在 headless-shell SwiftShader 下能否渲染、多快、context 是否稳定。
 * 这是 gl-transitions 全量收录与 HaldCLUT-on-video 的共同前置门。
 *
 * 流程：ffmpeg 合成两段确定性测试视频 → MediaBridge 出 http URL →
 * 生成临时 entry.tsx（apps/.cache/gl-poc/，不入产品 bundle）→ @remotion/bundler
 * 现场打包 → renderMedia(headless-shell) → ffmpeg 抽帧+signalstats 判定混合发生。
 *
 * 运行: cd apps && vite-node --config build/timeline/vite-node.config.ts build/scripts/gl-texture-poc.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";

const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const POC_DIR = path.join(APPS_ROOT, ".cache", "gl-poc");
const RUNTIME_DIR = path.join(
  "/Users/zhengbingjin/Library/Application Support/漫影工作室",
  "remotion-runtime",
);
const FPS = 25;
const DURATION = 50; // 2s
const W = 640;
const H = 360;

function run(cmd: string, args: string[]) {
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function makeTestVideos() {
  fs.mkdirSync(POC_DIR, { recursive: true });
  // POC_MODE=video(默认): <video>→three.VideoTexture(产品从未走过的路,正是 M5 要测的);
  // POC_MODE=image: 静态 PNG→TextureLoader(CinematicVisualClip 已验证路径)——二分诊断用。
  // POC_CODEC=h264 复测 H.264;默认 vp9(webm,无专利编解码问题)。
  const codec = process.env.POC_CODEC === "h264" ? "libx264" : "libvpx-vp9";
  const ext = process.env.POC_CODEC === "h264" ? "mp4" : "webm";
  const pix = process.env.POC_CODEC === "h264" ? ["-pix_fmt", "yuv420p"] : [];
  const a = path.join(POC_DIR, `a.${ext}`);
  const b = path.join(POC_DIR, `b.${ext}`);
  const common = ["-t", "2", "-c:v", codec, ...pix, "-an"];
  run("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}`, ...common, a]);
  run("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}`,
    "-vf", "hue=h=180,hue=s=3", ...common, b]);
  const pa = path.join(POC_DIR, "a.png");
  const pb = path.join(POC_DIR, "b.png");
  run("ffmpeg", ["-y", "-i", a, "-vframes", "1", pa]);
  run("ffmpeg", ["-y", "-i", b, "-vframes", "1", pb]);
  return { a, b, pa, pb };
}

function writeEntry(urls: Record<string, string>) {
  const entry = path.join(POC_DIR, "entry.tsx");
  const solid = process.env.POC_SOLID === "1";
  const mode = process.env.POC_MODE === "image" ? "image" : "video";
  const code = ENTRY_TEMPLATE
    .replace("__URL_A__", urls["poc-a"])
    .replace("__URL_B__", urls["poc-b"])
    .replace("__IMG_A__", urls["poc-pa"])
    .replace("__IMG_B__", urls["poc-pb"])
    .replace(/__SOLID__/g, solid ? "true" : "false")
    .replace(/__FREEZE__/g, process.env.POC_FREEZE === "1" ? "true" : "false")
    .replace(/__SEEK__/g, process.env.POC_SEEK === "1" ? "true" : "false")
    .replace(/__NOCANVAS__/g, process.env.POC_NOCANVAS === "1" ? "true" : "false")
    .replace(/__CANVAS__/g, process.env.POC_CANVAS === "1" ? "true" : "false")
    .replace(/__PRODUCT__/g, process.env.POC_PRODUCT === "1" ? "true" : "false")
    .replace(/__MODE__/g, JSON.stringify(mode));
  fs.writeFileSync(entry, code, "utf8");
  return entry;
}

const ENTRY_TEMPLATE = `import React from "react";
import { AbsoluteFill, Composition, OffthreadVideo, Sequence, Video, continueRender, delayRender, registerRoot, useCurrentFrame, useVideoConfig } from "remotion";
import { GLTransitionLayer } from "../../frontend/electron/rendering/plugins/remotion/composition/GLTransitionLayer";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

const UNDERLAY: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 };
// POC_NOCANVAS: video 提到 canvas 之上直出——判定「video 本身黑帧(解码限制)」还是「纹理上传黑」。
const OVERLAY: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 2 };
const HIDDEN: React.CSSProperties = { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" };

const VERT = \`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
\`;
const FRAG = \`
uniform sampler2D fromTex;
uniform sampler2D toTex;
uniform float progress;
varying vec2 vUv;
void main() {
  // 诊断开关：POC_SOLID=1 纯红验证绘制管线;POC_FREEZE=1 只输出 fromTex 验证纹理是否持续更新。
  #ifdef POC_SOLID
  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
  #else
  #ifdef POC_FREEZE
  gl_FragColor = texture2D(fromTex, vUv);
  #else
  float p = smoothstep(vUv.x - 0.06, vUv.x + 0.06, progress * 1.12 - 0.06);
  gl_FragColor = mix(texture2D(fromTex, vUv), texture2D(toTex, vUv), p);
  #endif
  #endif
}
\`;

function PocScene({ videoA, videoB, wrapA, wrapB, imageUrlA, imageUrlB, srcA, srcB, texturesRef }: { videoA: React.RefObject<HTMLVideoElement | null>; videoB: React.RefObject<HTMLVideoElement | null>; wrapA: React.RefObject<HTMLDivElement | null>; wrapB: React.RefObject<HTMLDivElement | null>; imageUrlA: string; imageUrlB: string; srcA: string; srcB: string; texturesRef: React.MutableRefObject<{ from?: THREE.Texture | null; to?: THREE.Texture | null }> }) {
  const { gl, scene, camera } = useThree();
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const [handle] = React.useState(() => delayRender("gl-poc: waiting for both textures"));

  // Imperative 场景（与产品 CinematicVisualClip 同模式）：material/mesh 用 useMemo
  // 稳定持有——R3F 声明式 args 每次渲染都是新对象字面量，会重建实例把已附着的
  // 纹理清掉（PoC 实测踩坑：纯色通、纹理黑）。
  const material = React.useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: __SOLID__ ? { POC_SOLID: "" } : __FREEZE__ ? { POC_FREEZE: "" } : undefined,
    uniforms: {
      fromTex: { value: null },
      toTex: { value: null },
      progress: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  }), []);
  const mesh = React.useMemo(() => new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material), [material]);

  React.useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (e: Event) => {
      e.preventDefault();
      console.warn("[poc] ⚠️ WebGL context lost at frame", frame);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => canvas.removeEventListener("webglcontextlost", onLost);
  }, [gl, frame]);

  React.useEffect(() => {
    scene.add(mesh);
    return () => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      gl.forceContextLoss();
      gl.dispose();
      material.dispose();
    };
  }, [gl, scene, mesh, material]);

  // __CANVAS__ 模式（官方 useOffthreadVideoTexture 同姿势）：每帧把 proxy 帧图 URL
  // 直接 TextureLoader.loadAsync——与 image 模式同上传机制，帧时序由本 effect 的
  // delayRender/loadAsync 保证。proxy 端口由渲染器注入 window.remotion_proxyPort。
  const frameSrcs = React.useMemo((): [string, string] | null => {
    if (!__CANVAS__) return null;
    const port = (window as unknown as { remotion_proxyPort?: number }).remotion_proxyPort;
    if (!port) return null;
    const t = Math.max(0, frame / fps);
    const mk = (src: string) =>
      "http://127.0.0.1:" + port + "/proxy?src=" + encodeURIComponent(src)
        + "&time=" + encodeURIComponent(t) + "&transparent=false&toneMapped=true";
    return [mk(srcA), mk(srcB)];
  }, [frame, fps, srcA, srcB]);

  React.useEffect(() => {
    if (!frameSrcs) return;
    const h = delayRender("gl-poc proxy frame " + frame);
    let disposed = false;
    const loader = new THREE.TextureLoader();
    Promise.all(frameSrcs.map((u) => loader.loadAsync(u)))
      .then(([ta, tb]) => {
        if (disposed) {
          ta.dispose();
          tb.dispose();
          return;
        }
        const old = [texturesRef.current.from, texturesRef.current.to];
        material.uniforms.fromTex.value = ta;
        material.uniforms.toTex.value = tb;
        texturesRef.current.from = ta;
        texturesRef.current.to = tb;
        gl.render(scene, camera);
        for (const t of old) if (t) t.dispose();
        continueRender(h);
      })
      .catch((err) => {
        console.error("[poc] proxy frame load failed", err);
        continueRender(h);
      });
    return () => {
      disposed = true;
      continueRender(h);
    };
  }, [frameSrcs, frame, gl, scene, camera, material, texturesRef]);

  React.useEffect(() => {
    if (frameSrcs) { // __CANVAS__ 模式由上面的 effect 管纹理
      continueRender(handle);
      return;
    }
    let cancelled = false;
    const attachVideo = (el: HTMLVideoElement | null) =>
      new Promise<THREE.VideoTexture | null>((resolve) => {
        if (!el) return resolve(null);
        if (el.readyState >= 2) return resolve(new THREE.VideoTexture(el));
        el.addEventListener("loadeddata", () => resolve(new THREE.VideoTexture(el)), { once: true });
      });
    const attachImage = (url: string) =>
      new Promise<THREE.Texture | null>((resolve) => {
        new THREE.TextureLoader().load(url, (tex) => resolve(tex));
      });
    const attachImgEl = (el: HTMLImageElement | null) =>
      new Promise<THREE.Texture | null>((resolve) => {
        if (!el) return resolve(null);
        const tex = new THREE.Texture(el);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        resolve(tex);
      });
    const imgs = () => [
      wrapA.current?.querySelector("img") ?? null,
      wrapB.current?.querySelector("img") ?? null,
    ];
    const pair = __MODE__ === "image"
      ? Promise.all([attachImage(imageUrlA), attachImage(imageUrlB)])
      : __CANVAS__
        ? Promise.all(imgs().map((el) => attachImgEl(el)))
        : Promise.all([attachVideo(videoA.current), attachVideo(videoB.current)]);
    pair.then(([ta, tb]) => {
      if (cancelled) return;
      material.uniforms.fromTex.value = ta;
      material.uniforms.toTex.value = tb;
      texturesRef.current.from = ta;
      texturesRef.current.to = tb;
      continueRender(handle);
    });
    return () => { cancelled = true; };
  }, [handle, material, videoA, videoB, imageUrlA, imageUrlB]);

  material.uniforms.progress.value = frame / Math.max(1, durationInFrames - 1);
  if (!__SEEK__) gl.render(scene, camera);
  return null;
}

function SeekDriver({ videoA, videoB, texturesRef, frame, fps }: {
  videoA: React.RefObject<HTMLVideoElement | null>;
  videoB: React.RefObject<HTMLVideoElement | null>;
  texturesRef: React.MutableRefObject<{ from?: THREE.Texture | null; to?: THREE.Texture | null }>;
  frame: number;
  fps: number;
}) {
  const { gl, scene, camera } = useThree();
  React.useEffect(() => {
    const h = delayRender("gl-poc seek frame " + frame);
    let done = 0;
    let settled = false;
    let armed = false;
    const els = [videoA.current, videoB.current].filter(Boolean) as HTMLVideoElement[];
    const onSeeked = () => {
      done += 1;
      if (done < els.length || settled || els.length === 0) return;
      settled = true;
      // 手动 seek 后强制纹理重采样（rVFC 时机不受控，PoC 实测黑帧）。
      for (const tex of [texturesRef.current.from, texturesRef.current.to]) {
        if (tex) tex.needsUpdate = true;
      }
      gl.render(scene, camera);
      continueRender(h);
    };
    const t = Math.min(frame / fps, Math.max(0, (els[0]?.duration ?? 2) - 0.04));
    const tryBegin = (): boolean => {
      if (armed || els.length === 0) return armed;
      if (!els.every((el) => el.readyState >= 1)) return false;
      armed = true;
      els.forEach((el) => el.addEventListener("seeked", onSeeked, { once: true }));
      els.forEach((el) => { el.currentTime = t; });
      return true;
    };
    if (!tryBegin()) {
      // metadata 未就绪时设置 currentTime 无效——等 loadedmetadata 再 seek。
      els.forEach((el) => el.addEventListener("loadedmetadata", tryBegin, { once: true }));
    }
    return () => {
      els.forEach((el) => {
        el.removeEventListener("seeked", onSeeked);
        el.removeEventListener("loadedmetadata", tryBegin);
      });
      if (!settled) continueRender(h);
    };
  }, [frame, fps, gl, scene, camera, videoA, videoB, texturesRef]);
  return null;
}

function ImgFrameDriver({ wrapA, wrapB, texturesRef, frame }: {
  wrapA: React.RefObject<HTMLDivElement | null>;
  wrapB: React.RefObject<HTMLDivElement | null>;
  texturesRef: React.MutableRefObject<{ from?: THREE.Texture | null; to?: THREE.Texture | null }>;
  frame: number;
}) {
  const { gl, scene, camera } = useThree();
  React.useEffect(() => {
    const h = delayRender("gl-poc img frame " + frame);
    let settled = false;
    const imgs = [wrapA.current?.querySelector("img") ?? null, wrapB.current?.querySelector("img") ?? null]
      .filter(Boolean) as HTMLImageElement[];
    const commit = () => {
      if (settled || imgs.length === 0) return;
      settled = true;
      // img.src 每帧被 OffthreadVideo 替换；等 load 后强制重传纹理再画。
      for (const tex of [texturesRef.current.from, texturesRef.current.to]) {
        if (tex) tex.needsUpdate = true;
      }
      gl.render(scene, camera);
      continueRender(h);
    };
    if (imgs.every((img) => img.complete)) {
      // 已就绪的帧也要走一次 decode,确保新 src 解码完成后再上纹理。
      Promise.all(imgs.map((img) => img.decode().catch(() => undefined))).then(commit);
    } else {
      Promise.all(imgs.map((img) => img.decode().catch(() => undefined))).then(commit);
    }
    return () => {
      if (!settled) continueRender(h);
    };
  }, [frame, gl, scene, camera, wrapA, wrapB, texturesRef]);
  return null;
}

function PocVideo({ srcA, srcB, imgA, imgB }: { srcA: string; srcB: string; imgA: string; imgB: string }) {
  const videoA = React.useRef<HTMLVideoElement | null>(null);
  const videoB = React.useRef<HTMLVideoElement | null>(null);
  const wrapA = React.useRef<HTMLDivElement | null>(null);
  const wrapB = React.useRef<HTMLDivElement | null>(null);
  const texturesRef = React.useRef<{ from?: THREE.Texture | null; to?: THREE.Texture | null }>({});
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {__MODE__ === "image" || __CANVAS__ ? null : (
        __SEEK__ ? (
          <>
            {/* 手动逐帧 seek 模式：不用 Remotion <Video>(其 seek 完成信号与 three 纹理的
                rVFC 更新不同步,截图时纹理仍是黑帧——PoC 实测)。 */}
            <video ref={videoA} src={srcA} muted playsInline style={UNDERLAY} />
            <video ref={videoB} src={srcB} muted playsInline style={UNDERLAY} />
          </>
      ) : (
          <>
            {/* 视频必须真实可见才会产帧：headless 下 opacity:0/1x1 的 video 不触发
                rVFC/纹理上传（PoC 实测全黑）。放在 canvas 底层、被 WebGL 画面盖住。 */}
            <Video ref={videoA} src={srcA} muted style={__NOCANVAS__ ? OVERLAY : UNDERLAY} />
            <Video ref={videoB} src={srcB} muted style={UNDERLAY} />
          </>
        )
      )}
      <ThreeCanvas
        width={width}
        height={height}
        orthographic
        camera={{ position: [0, 0, 1], zoom: 1 }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 1 }}
        gl={{ antialias: false, stencil: false, powerPreference: "low-power" }}
        dpr={1}
      >
        <PocScene videoA={videoA} videoB={videoB} wrapA={wrapA} wrapB={wrapB} imageUrlA={imgA} imageUrlB={imgB} srcA={srcA} srcB={srcB} texturesRef={texturesRef} />
        {__SEEK__ ? <SeekDriver videoA={videoA} videoB={videoB} texturesRef={texturesRef} frame={frame} fps={fps} /> : null}
      </ThreeCanvas>
    </AbsoluteFill>
  );
}

function ProductVideo({ srcA, srcB }: { srcA: string; srcB: string }) {
  // 产品组件全管线验证：真 GLTransitionLayer + 合成 clip props + gl:Directional 转场。
  const { width, height } = useVideoConfig();
  const overlap = 20;
  const transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
  const clipA = {
    clipId: "a", kind: "video" as const, src: srcA, from: 0,
    durationInFrames: ${DURATION}, transform, trimStartFrames: 0, playbackRate: 1, muted: true,
  };
  const clipB = {
    clipId: "b", kind: "video" as const, src: srcB, from: ${DURATION} - overlap,
    durationInFrames: overlap, transform, trimStartFrames: 0, playbackRate: 1, muted: true,
  };
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Sequence from={0} durationInFrames={${DURATION} - overlap + 1} layout="none">
        <OffthreadVideo src={srcA} muted style={{ width: "100%", height: "100%" }} />
      </Sequence>
      <Sequence from={${DURATION} - overlap} durationInFrames={overlap} layout="none">
        <GLTransitionLayer
          transition={{ fromClipId: "a", toClipId: "b", effectId: "gl:Directional", overlapFrames: overlap }}
          fromClip={clipA}
          toClip={clipB}
        />
      </Sequence>
      <div style={{ position: "absolute", left: 0, top: 0, width, height }} />
    </AbsoluteFill>
  );
}

export const RemotionRoot: React.FC = () => (
  <Composition
    id="GLPoc"
    component={__PRODUCT__ ? ProductVideo : PocVideo}
    durationInFrames={${DURATION}}
    fps={${FPS}}
    width={${W}}
    height={${H}}
    defaultProps={{ srcA: "__URL_A__", srcB: "__URL_B__", imgA: "__IMG_A__", imgB: "__IMG_B__" }}
  />
);

registerRoot(RemotionRoot);
`;

async function main() {
  const t0 = Date.now();
  const { a, b, pa, pb } = makeTestVideos();
  console.log("[poc] test videos ready");

  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  session.register("poc-a", a);
  session.register("poc-b", b);
  session.register("poc-pa", pa);
  session.register("poc-pb", pb);
  const urls = Object.fromEntries(
    mediaBridge.buildUrls(session, ["poc-a", "poc-b", "poc-pa", "poc-pb"]).map((e) => [e.assetId, e.url]),
  ) as Record<string, string>;
  console.log("[poc] media bridge up");

  const entry = writeEntry(urls);
  const tBundle0 = Date.now();
  const serveUrl = await bundle({ entryPoint: entry, onProgress: () => {} });
  const bundleMs = Date.now() - tBundle0;
  console.log(`[poc] bundled in ${(bundleMs / 1000).toFixed(1)}s`);

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const prevCwd = process.cwd();
  process.chdir(RUNTIME_DIR);
  try {
    const browser = await ensureBrowser({ browserExecutable: undefined, chromiumOptions: {}, forceDeviceScaleFactor: undefined, allowFallback: true, onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); } } as never);
    // swangle = SwiftShader WebGL 的显式开关（产品 3D 线同款：run-full-pipeline.ts:1152，
    // 不传则 ANGLE Vulkan 路径 BindToCurrentSequence 失败——PoC 第一轮实测）。
    const composition = await selectComposition({
      serveUrl,
      id: "GLPoc",
      browserExecutable: (browser as { path: string }).path,
      chromiumOptions: { gl: "swangle" },
    });
    const output = path.join(POC_DIR, "poc-out.mp4");
    const tRender0 = Date.now();
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: output,
      browserExecutable: (browser as { path: string }).path,
      chromiumOptions: { gl: "swangle" },
      concurrency: 2,
      timeoutInSeconds: 180,
      quiet: true,
    });
    const renderMs = Date.now() - tRender0;
    console.log(`[poc] rendered ${DURATION} frames in ${(renderMs / 1000).toFixed(1)}s (${(DURATION / (renderMs / 1000)).toFixed(1)} fps)`);

    // 抽帧判定：progress 0 / 0.5 / 1 三帧的 1x1 平均 RGB，混合发生=三帧彼此显著不同。
    const probe = (frame: number): [number, number, number] => {
      const png = path.join(POC_DIR, `f${frame}.png`);
      run("ffmpeg", ["-y", "-i", output, "-vf", `select='eq(n,${frame})'`, "-vframes", "1", png]);
      const raw = spawnSync("ffmpeg",
        ["-i", png, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        { encoding: "buffer" }).stdout as Buffer;
      return [raw[0], raw[1], raw[2]];
    };
    const c0 = probe(0), cMid = probe(Math.floor(DURATION / 2)), cLast = probe(DURATION - 1);
    const channelSpread = (a: [number, number, number], b: [number, number, number]) =>
      Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    const spread = Math.max(channelSpread(c0, cMid), channelSpread(cMid, cLast), channelSpread(c0, cLast));
    console.log(`[poc] frame rgb  f0=[${c0}] mid=[${cMid}] last=[${cLast}] (channel spread=${spread.toFixed(1)})`);

    const verdict = {
      rendered: true,
      frames: DURATION,
      renderSeconds: +(renderMs / 1000).toFixed(1),
      fps: +(DURATION / (renderMs / 1000)).toFixed(1),
      bundleSeconds: +(bundleMs / 1000).toFixed(1),
      rgb: { f0: c0, mid: cMid, last: cLast },
      channelSpread: +spread.toFixed(1),
      mixOccurred: spread > 30,
      totalSeconds: +((Date.now() - t0) / 1000).toFixed(1),
      output,
    };
    fs.writeFileSync(path.join(POC_DIR, "poc-result.json"), JSON.stringify(verdict, null, 2));
    console.log("[poc] VERDICT:", JSON.stringify(verdict, null, 2));
    console.log(verdict.mixOccurred ? "[poc] ✅ 混合发生——视频双纹理在 headless SwiftShader 下可行" : "[poc] ⚠️ 三帧几乎相同——混合未发生，需查 shader/纹理更新");
  } finally {
    process.chdir(prevCwd);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[poc] ❌ FAILED:", err?.message ?? err);
  fs.writeFileSync(path.join(POC_DIR, "poc-result.json"), JSON.stringify({ rendered: false, error: String(err?.message ?? err) }, null, 2));
  process.exit(1);
});
