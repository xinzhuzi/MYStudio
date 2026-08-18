// GLTransitionLayer — gl-transitions 转场的 Remotion 合成层渲染宿主
// （Trellis 08-18-gl-transitions B3，设计 §1.2「渲染归属 A 案」）。
//
// 机制（PoC 九轮实测收敛，research/gl-texture-poc-2026-08-18.md）：
// - 视频/图片镜统一走「Remotion proxy 帧图 URL + TextureLoader.loadAsync」逐帧换纹理
//   （= 官方 useOffthreadVideoTexture 同姿势）；texImage2D(video) 在 swangle 下黑纹理，勿走。
// - 渲染期专用：依赖 window.remotion_proxyPort（渲染器注入）。Player 预览不挂载，
//   DOM 层的 crossfade smoothstep（transition-style.ts gl: 分支）作为预览兜底。
// - SwiftShader 生存参数照搬 CinematicVisualClip（antialias/stencil 关、dpr=1），
//   卸载即 forceContextLoss+dispose（context 上限 ~16 的前科）。
// - material/mesh 必须 useMemo 稳定持有：R3F 声明式 args 每渲染新对象会重建实例、
//   清掉已附着纹理（PoC 踩坑：纯色通、纹理黑）。

import React from "react";
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame, useVideoConfig, useRemotionEnvironment } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CompositionTransitionProps, CompositionVisualClipProps } from "./composition-props";
import { getGlTransition } from "./gl-transition-registry";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function buildFragmentShader(glsl: string): string {
  return /* glsl */ `
uniform sampler2D fromTex;
uniform sampler2D toTex;
uniform float progress;
uniform float ratio;
vec4 getFromColor(vec2 uv) { return texture2D(fromTex, uv); }
vec4 getToColor(vec2 uv) { return texture2D(toTex, uv); }
${glsl}
void main() { gl_FragColor = transition(vUv); }
`;
}

function toUniformValue(arr: readonly number[]): THREE.Vector2 | THREE.Vector3 | THREE.Vector4 | number {
  if (arr.length === 2) return new THREE.Vector2(arr[0], arr[1]);
  if (arr.length === 3) return new THREE.Vector3(arr[0], arr[1], arr[2]);
  if (arr.length === 4) return new THREE.Vector4(arr[0], arr[1], arr[2], arr[3]);
  return arr[0] ?? 0;
}

/** 出镜镜在重叠区内的 clip 内帧序（重叠区贴着出镜镜尾部）。 */
function fromClipLocalFrame(fromClip: CompositionVisualClipProps, overlapFrames: number, localFrame: number): number {
  return Math.max(0, fromClip.durationInFrames - overlapFrames + localFrame);
}

/** clip 内帧序 → proxy 帧图的媒体时间（秒）；trim/playbackRate 换算对齐 OffthreadVideo。 */
function mediaTimeAtClipFrame(clip: CompositionVisualClipProps, clipLocalFrame: number, fps: number): number {
  const rate = clip.playbackRate ?? 1;
  return Math.max(0, ((clip.trimStartFrames ?? 0) + clipLocalFrame * rate) / fps);
}

function proxyFrameUrl(src: string, timeSeconds: number, transparent: boolean): string | null {
  const port = (window as unknown as { remotion_proxyPort?: number }).remotion_proxyPort;
  if (!port) return null;
  return `http://127.0.0.1:${port}/proxy?src=${encodeURIComponent(src)}`
    + `&time=${encodeURIComponent(timeSeconds)}&transparent=${String(transparent)}&toneMapped=true`;
}

export function GLTransitionLayer({
  transition,
  fromClip,
  toClip,
}: {
  transition: CompositionTransitionProps;
  fromClip: CompositionVisualClipProps;
  toClip: CompositionVisualClipProps;
}): React.ReactElement | null {
  const { isRendering } = useRemotionEnvironment();
  const { width, height, fps } = useVideoConfig();
  // Sequence 相对帧 = 重叠区内本地帧序（挂载点在重叠区 Sequence 内）。
  const localFrame = useCurrentFrame();

  const defn = getGlTransition(transition.effectId);
  if (!isRendering || !defn) return null;

  return (
    <AbsoluteFill>
      <ThreeCanvas
        width={width}
        height={height}
        orthographic
        camera={{ position: [0, 0, 1], zoom: 1 }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 2 }}
        gl={{ antialias: false, stencil: false, powerPreference: "low-power" }}
        dpr={1}
      >
        <GLTransitionScene
          glsl={defn.glsl}
          defaultUniforms={defn.defaultUniforms}
          fromSrc={fromClip.src}
          toSrc={toClip.src}
          fromTime={mediaTimeAtClipFrame(fromClip, fromClipLocalFrame(fromClip, transition.overlapFrames, localFrame), fps)}
          toTime={mediaTimeAtClipFrame(toClip, localFrame, fps)}
          progress={localFrame / Math.max(1, transition.overlapFrames - 1)}
          ratio={width / height}
          fromTransparent={fromClip.kind === "video" ? false : undefined}
          toTransparent={toClip.kind === "video" ? false : undefined}
        />
      </ThreeCanvas>
    </AbsoluteFill>
  );
}

function GLTransitionScene({
  glsl,
  defaultUniforms,
  fromSrc,
  toSrc,
  fromTime,
  toTime,
  progress,
  ratio,
}: {
  glsl: string;
  defaultUniforms: Readonly<Record<string, readonly number[]>>;
  fromSrc: string;
  toSrc: string;
  fromTime: number;
  toTime: number;
  progress: number;
  ratio: number;
  fromTransparent?: boolean;
  toTransparent?: boolean;
}): React.ReactElement | null {
  const { gl, scene, camera } = useThree();

  const material = React.useMemo(() => {
    const uniforms: Record<string, { value: unknown }> = {
      fromTex: { value: null },
      toTex: { value: null },
      progress: { value: 0 },
      ratio: { value: ratio },
    };
    for (const [key, value] of Object.entries(defaultUniforms)) {
      uniforms[key] = { value: toUniformValue(value) };
    }
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: buildFragmentShader(glsl),
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    // defaultUniforms 来自 registry as const，引用稳定；ratio 变化仅预览期发生。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glsl]);

  const mesh = React.useMemo(
    () => new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material),
    [material],
  );

  React.useEffect(() => {
    scene.add(mesh);
    return () => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      gl.forceContextLoss();
      gl.dispose();
    };
  }, [gl, scene, mesh, material]);

  // 逐帧换纹理：proxy 帧图 URL 随时间变，loadAsync 完成即上纹理重绘再放行截图。
  React.useEffect(() => {
    const fromUrl = proxyFrameUrl(fromSrc, fromTime, false);
    const toUrl = proxyFrameUrl(toSrc, toTime, false);
    if (!fromUrl || !toUrl) return;
    const handle = delayRender("gl-transition frame textures");
    let disposed = false;
    const loader = new THREE.TextureLoader();
    Promise.all([loader.loadAsync(fromUrl), loader.loadAsync(toUrl)])
      .then(([fromTex, toTex]) => {
        if (disposed) {
          fromTex.dispose();
          toTex.dispose();
          return;
        }
        const old = [material.uniforms.fromTex.value, material.uniforms.toTex.value];
        material.uniforms.fromTex.value = fromTex;
        material.uniforms.toTex.value = toTex;
        material.uniforms.progress.value = progress;
        material.uniforms.ratio.value = ratio;
        gl.render(scene, camera);
        for (const tex of old) {
          if (tex instanceof THREE.Texture) tex.dispose();
        }
        continueRender(handle);
      })
      .catch((err: unknown) => {
        console.error("[gl-transition] proxy frame load failed", err);
        continueRender(handle);
      });
    return () => {
      disposed = true;
      continueRender(handle);
    };
  }, [fromSrc, toSrc, fromTime, toTime, progress, ratio, gl, scene, camera, material]);

  return null;
}
