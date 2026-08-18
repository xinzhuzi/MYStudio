// GLGradeMedia — 成片调色的 WebGL 媒体位（Trellis 08-18-haldclut-grade，D1 裁定=Remotion 合成层）。
//
// 结构：替代 VisualClip 的 <Img>/<OffthreadVideo> 媒体位——外层 CSS transform
// （panZoom 运镜/shake/contain）照常作用在本容器上，本组件只负责「媒体→LUT→blend」。
// 机制（复用 GLTransitionLayer 的已验证模式）：
// - 渲染期专用（remotion_proxyPort 依赖）；Player 预览回退原媒体（grade 预览不可见，注释口径）。
// - 视频=proxy 帧图 URL 逐帧 TextureLoader.loadAsync（texImage2D(video) 在 swangle 黑纹理，勿走）。
// - 图片=一次 TextureLoader；LUT 纹理一次加载常驻。
// - material/mesh useMemo 稳定持有（R3F args 重建清纹理的坑）；卸载 forceContextLoss。
// LUT 排列与 apps/build/scripts/generate-luts.py 配对：512×512，8×8 块（b 选块），块内 64×64（g 行 r 列）。

import React from "react";
import { continueRender, delayRender, useCurrentFrame, useRemotionEnvironment, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tex;
uniform sampler2D lut;
uniform float blend;
vec3 sampleLut(vec3 c) {
  // 8x8 块网格:蓝通道选块,块内 64px(绿=行,红=列);与 generate-luts.py 烘焙排列配对。
  float block = c.b * 63.0;
  float bx = mod(block, 8.0);
  float by = floor(block / 8.0);
  vec2 cell = vec2(c.r, c.g) * (63.0 / 64.0) + (0.5 / 64.0);
  vec2 lutUv = (vec2(bx, by) + cell) / 8.0;
  return texture2D(lut, lutUv).rgb;
}
void main() {
  vec3 src = texture2D(tex, vUv).rgb;
  vec3 graded = sampleLut(src);
  gl_FragColor = vec4(mix(src, graded, blend), 1.0);
}
`;

function proxyFrameUrl(src: string, timeSeconds: number): string | null {
  const port = (window as unknown as { remotion_proxyPort?: number }).remotion_proxyPort;
  if (!port) return null;
  return `http://127.0.0.1:${port}/proxy?src=${encodeURIComponent(src)}`
    + `&time=${encodeURIComponent(timeSeconds)}&transparent=false&toneMapped=true`;
}

export function GLGradeMedia({
  src,
  kind,
  trimStartFrames,
  playbackRate,
  durationInFrames,
  lutSrc,
  blend,
}: {
  src: string;
  kind: "image" | "video";
  trimStartFrames?: number;
  playbackRate?: number;
  durationInFrames: number;
  lutSrc: string;
  blend: number;
}): React.ReactElement | null {
  const { isRendering } = useRemotionEnvironment();
  const { width, height, fps } = useVideoConfig();
  const frame = useCurrentFrame(); // Sequence 内=clip 相对帧
  if (!isRendering) return null;

  return (
    <ThreeCanvas
      width={width}
      height={height}
      orthographic
      camera={{ position: [0, 0, 1], zoom: 1 }}
      style={{ width: "100%", height: "100%" }}
      gl={{ antialias: false, stencil: false, powerPreference: "low-power" }}
      dpr={1}
    >
      <GradeScene
        frameSrc={
          kind === "video"
            ? proxyFrameUrl(src, Math.max(0, ((trimStartFrames ?? 0) + frame * (playbackRate ?? 1)) / fps))
            : src
        }
        lutSrc={lutSrc}
        blend={blend}
        frame={frame}
        durationInFrames={durationInFrames}
      />
    </ThreeCanvas>
  );
}

function GradeScene({
  frameSrc,
  lutSrc,
  blend,
  frame,
}: {
  frameSrc: string | null;
  lutSrc: string;
  blend: number;
  frame: number;
  durationInFrames: number;
}): React.ReactElement | null {
  const { gl, scene, camera } = useThree();

  const material = React.useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          tex: { value: null },
          lut: { value: null },
          blend: { value: blend },
        },
        depthTest: false,
        depthWrite: false,
      }),
    // blend 经 uniforms 每帧更新,构造期只用初值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
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

  // LUT 纹理一次加载常驻。
  React.useEffect(() => {
    const handle = delayRender("gl-grade lut texture");
    let disposed = false;
    new THREE.TextureLoader().loadAsync(lutSrc).then((lutTex) => {
      if (disposed) {
        lutTex.dispose();
        return;
      }
      lutTex.minFilter = THREE.LinearFilter;
      lutTex.magFilter = THREE.LinearFilter;
      lutTex.generateMipmaps = false;
      const old = material.uniforms.lut.value;
      material.uniforms.lut.value = lutTex;
      if (old instanceof THREE.Texture) old.dispose();
      continueRender(handle);
    }).catch((err: unknown) => {
      console.error("[gl-grade] lut load failed", err);
      continueRender(handle);
    });
    return () => {
      disposed = true;
      continueRender(handle);
    };
  }, [lutSrc, material]);

  // 帧纹理：视频每帧换(proxy 帧图 URL 变化),图片一次。
  React.useEffect(() => {
    if (!frameSrc) return;
    const handle = delayRender("gl-grade frame texture " + frame);
    let disposed = false;
    new THREE.TextureLoader().loadAsync(frameSrc).then((tex) => {
      if (disposed) {
        tex.dispose();
        return;
      }
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      const old = material.uniforms.tex.value;
      material.uniforms.tex.value = tex;
      material.uniforms.blend.value = blend;
      gl.render(scene, camera);
      if (old instanceof THREE.Texture) old.dispose();
      continueRender(handle);
    }).catch((err: unknown) => {
      console.error("[gl-grade] frame texture load failed", err);
      continueRender(handle);
    });
    return () => {
      disposed = true;
      continueRender(handle);
    };
  }, [frameSrc, frame, blend, gl, scene, camera, material]);

  return null;
}
