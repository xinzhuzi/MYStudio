// AtmosphereLayers — 程序化氛围层(08-19 multilayer-composition Child1)。
//
// proof 实证(apps/build/scripts/multilayer-parallax-proof.ts,8s/1080p 12.2s)的
// 手法移植:雾带=CSS 椭圆渐变+blur+screen 混合,双份相距 100% 循环覆盖
// (漂移速度<100%/镜时长免回绕跳变);光尘=seeded PRNG 粒子场(mulberry32,
// 同 seed 逐帧可复现),出界回卷。全部参数由 LayerSpec.template.params 传入,
// 不硬编码 proof 数值;Child2 决策层将扩模板闭集(花瓣/火星/雪/萤火)。
//
// 固定 bundle 走 @remotion/bundler,本文件只相对导入、零外部依赖。

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CompositionLayerSpec } from "./composition-props";

/** panZoom 折减缺省表:背景懒/主体满/前景灵/氛围不吃运镜(屏幕空间层)。 */
export const LAYER_PAN_ZOOM_DAMP_DEFAULTS: Record<CompositionLayerSpec["role"], number> = {
  background: 0.6,
  subject: 1,
  foreground: 1.15,
  atmosphere: 0,
};

export function layerPanZoomDamp(layer: CompositionLayerSpec): number {
  return layer.panZoomDamp ?? LAYER_PAN_ZOOM_DAMP_DEFAULTS[layer.role];
}

/** mulberry32:确定性 PRNG(同 seed 同序列——渲染可复现的前提)。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ParticleSeed {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
  base: number;
}

/** 粒子场种子数据:一次生成,帧内只做相位推进(与 proof 同构)。 */
export function buildParticleField(seed: number, count: number): ParticleSeed[] {
  const rnd = mulberry32(seed);
  const out: ParticleSeed[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: rnd(),
      y: 0.1 + rnd() * 0.85,
      size: 2 + Math.round(rnd() * 4),
      speed: rnd(),
      phase: rnd() * Math.PI * 2,
      base: 0.35 + rnd() * 0.5,
    });
  }
  return out;
}

/** 粒子在 t 秒的状态(纯函数):右飘+上飘+回卷+闪烁。 */
export function particleStateAt(
  particle: ParticleSeed,
  t: number,
): { leftPct: number; topPct: number; opacity: number } {
  const driftPctPerSec = 10 + particle.speed * 16; // 屏宽百分比/秒
  const risePctPerSec = 7 + particle.speed * 12; // 屏高百分比/秒
  const leftPct = ((particle.x + (t * driftPctPerSec) / 100) % 1.08) * 100;
  // 上飘取模回卷:区间 [-0.02, 1.03)(span 1.05),任意时长不越界(长镜渲染安全)。
  const wrappedTop = -0.02 + mod(particle.y + 0.02 - (t * risePctPerSec) / 100, 1.05);
  const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(particle.phase + t * (0.6 + particle.speed * 1.6)));
  return { leftPct, topPct: wrappedTop * 100, opacity: particle.base * twinkle };
}

/** 非负取模(JS % 对负数返回负值,自包一层)。 */
function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

/** 雾带在 t 秒的水平偏移(纯函数):双份相距 100% 屏宽,循环免回绕。 */
export function fogBandLeftsAt(t: number, speedPctPerSec: number, wrap: boolean): number[] {
  const x = -((t * speedPctPerSec) % 100);
  return wrap ? [x, x + 100] : [x];
}

/** 模板参数取值(带缺省与钳制):params 值非法/越界回退缺省,不炸渲染。 */
function numParam(params: Record<string, number> | undefined, key: string, fallback: number, min: number, max: number): number {
  const value = params?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 雾带渐变:两个软边椭圆(边到边全透明,双份拼接无接缝)。 */
const FOG_GRADIENT =
  "radial-gradient(ellipse 55% 60% at 32% 50%, rgba(214,232,246,0.85), rgba(214,232,246,0) 72%),"
  + "radial-gradient(ellipse 45% 50% at 70% 42%, rgba(200,224,244,0.7), rgba(200,224,244,0) 70%)";

function FogBandLayer({ template }: { template: NonNullable<CompositionLayerSpec["template"]> }): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const y = numParam(template.params, "y", 0.55, 0, 0.9);
  const height = numParam(template.params, "height", 0.3, 0.05, 0.8);
  const speed = numParam(template.params, "speed", 1.5, 0.1, 20);
  const blur = numParam(template.params, "blur", 26, 0, 60);
  const opacity = numParam(template.params, "opacity", 0.2, 0.01, 0.6);
  const wrap = template.params?.wrap === 0 ? false : true;
  const bob = Math.sin(t * 0.7 * Math.PI * 2) * 1.2;
  return (
    <>
      {fogBandLeftsAt(t, speed, wrap).map((left) => (
        <div
          key={left}
          style={{
            position: "absolute",
            left: `${left.toFixed(2)}%`,
            top: `${(y * 100 + bob).toFixed(2)}%`,
            width: "100%",
            height: `${Math.round(height * 100)}%`,
            background: FOG_GRADIENT,
            filter: `blur(${blur.toFixed(0)}px)`,
            opacity,
            borderRadius: "50%",
          }}
        />
      ))}
    </>
  );
}

function ParticleFieldLayer({ template }: { template: NonNullable<CompositionLayerSpec["template"]> }): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const count = Math.round(numParam(template.params, "count", 48, 1, 200));
  const seed = Math.round(numParam(template.params, "seed", 20260819, 0, 2147483647));
  const particles = React.useMemo(() => buildParticleField(seed, count), [seed, count]);
  return (
    <>
      {particles.map((particle, index) => {
        const state = particleStateAt(particle, t);
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: `${state.leftPct.toFixed(3)}%`,
              top: `${state.topPct.toFixed(3)}%`,
              width: particle.size,
              height: particle.size,
              borderRadius: "50%",
              background: "rgba(255,246,218,1)",
              boxShadow: `0 0 ${(particle.size * 2.4).toFixed(1)}px rgba(255,240,200,0.9)`,
              opacity: state.opacity.toFixed(3),
            }}
          />
        );
      })}
    </>
  );
}

/**
 * 模板分发:Child1 落地 proof 验证过的两核心;未知模板渲染空层
 * (闭集 fail-closed 在决策/投影/校验闸把关——Child2 接入注册表后未知 id
 * 在 validateCompositionProps 即拒,渲染端兜底不崩)。
 */
export function AtmosphereTemplateLayer({ template }: { template: NonNullable<CompositionLayerSpec["template"]> }): React.ReactElement | null {
  switch (template.id) {
    case "atmo:fog-band":
      return <FogBandLayer template={template} />;
    case "atmo:light-dust":
      return <ParticleFieldLayer template={template} />;
    default:
      return null;
  }
}
