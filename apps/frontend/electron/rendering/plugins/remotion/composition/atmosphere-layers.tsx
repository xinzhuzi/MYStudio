// AtmosphereLayers — 程序化氛围层(08-19 multilayer-composition Child1/Child2)。
//
// proof 实证(apps/build/scripts/multilayer-parallax-proof.ts,8s/1080p 12.2s)的
// 手法泛化:雾带族=CSS 椭圆渐变+blur,双份相距 100% 循环覆盖(漂移速度<100%/
// 镜时长免回绕跳变);粒子族=seeded PRNG 粒子场(mulberry32,同 seed 逐帧可
// 复现),支持颜色/升降方向/摆动/闪烁/辉光/叶片形状(花瓣/落叶/火星/雪/萤火)。
// 模板闭集=lib/studio/remotion/atmosphere-templates.ts(决策/渲染/校验单源);
// 本文件按 kind 分发,全部参数由 LayerSpec.template.params 传入(决策层
// intensity 已在投影端折进 params)。
//
// 固定 bundle 走 @remotion/bundler,本文件只相对导入、零外部依赖。

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CompositionLayerSpec } from "./composition-props";
import {
  getAtmosphereTemplate,
  isAtmosphereTemplateId,
} from "../../../../../lib/studio/remotion/atmosphere-templates";

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
export function buildParticleField(seed: number, count: number, sizeMin = 2, sizeMax = 6): ParticleSeed[] {
  const rnd = mulberry32(seed);
  const out: ParticleSeed[] = [];
  for (let i = 0; i < count; i++) {
    const speed = rnd();
    out.push({
      x: rnd(),
      y: 0.08 + rnd() * 0.87,
      size: sizeMin + speed * (sizeMax - sizeMin),
      speed,
      phase: rnd() * Math.PI * 2,
      base: 0.35 + rnd() * 0.5,
    });
  }
  return out;
}

export interface ParticleFieldMotion {
  /** 1=上升(光尘/火星/萤火), -1=下降(落叶/花瓣/雪)。 */
  dir: number;
  /** 基速(屏高百分比/秒),每粒子按 speed 0.6..1.4 缩放。 */
  riseSpeed: number;
  driftSpeed: number;
  /** 横向摆动幅度(屏宽百分比)。 */
  sway: number;
  swayFreq: number;
  /** 闪烁幅度 0..1(0=恒定)。 */
  blink: number;
}

/** 粒子在 t 秒的状态(纯函数):漂移+升降+取模回卷+摆动+闪烁。 */
export function particleStateAt(
  particle: ParticleSeed,
  t: number,
  motion: ParticleFieldMotion,
): { leftPct: number; topPct: number; opacity: number; swayPct: number; rotateDeg: number } {
  const speedScale = 0.6 + particle.speed * 0.8;
  const drift = (particle.x + (t * motion.driftSpeed * speedScale) / 100) % 1.08;
  const vertical = ((motion.dir >= 0 ? -1 : 1) * (t * motion.riseSpeed * speedScale)) / 100;
  const top = -0.02 + mod(particle.y + 0.02 + vertical, 1.05);
  const swayPhase = particle.phase + t * motion.swayFreq * Math.PI * 2;
  const swayPct = motion.sway > 0 ? Math.sin(swayPhase) * motion.sway : 0;
  const twinkle = motion.blink > 0
    ? (1 - motion.blink) + motion.blink * (0.5 + 0.5 * Math.sin(particle.phase * 7 + t * (1 + particle.speed * 2)))
    : 1;
  return {
    leftPct: drift * 100,
    topPct: top * 100,
    opacity: particle.base * twinkle,
    swayPct,
    rotateDeg: particle.phase + t * 40 * Math.max(motion.swayFreq, 0.1),
  };
}

/** 雾带在 t 秒的水平偏移(纯函数):双份相距 100% 屏宽,循环免回绕。 */
export function fogBandLeftsAt(t: number, speedPctPerSec: number, wrap: boolean): number[] {
  const x = -((t * speedPctPerSec) % 100);
  return wrap ? [x, x + 100] : [x];
}

/** 非负取模(JS % 对负数返回负值,自包一层)。 */
function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

/** 模板参数取值(带钳制):非法/越界回退缺省,不炸渲染。 */
function numParam(params: Record<string, number> | undefined, key: string, fallback: number, min: number, max: number): number {
  const value = params?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * 模板参数归一:注册表缺省+overrides 合并,intensity(0..2)缩放不透明度与
 * (粒子族)数量——决策层的唯一强度旋钮,锐度纪律不由 AI 越界(同 LUT blend 钳制)。
 */
export function scaledTemplateParams(
  templateId: string,
  overrides: Record<string, number> | undefined,
  intensity: number,
): Record<string, number> {
  const safeIntensity = Number.isFinite(intensity) ? Math.min(2, Math.max(0, intensity)) : 1;
  const merged: Record<string, number> = {};
  const defaults = isAtmosphereTemplateId(templateId)
    ? getAtmosphereTemplate(templateId).defaults
    : {};
  const source = { ...defaults, ...(overrides ?? {}) };
  for (const [key, value] of Object.entries(source)) {
    merged[key] = typeof value === "number" && Number.isFinite(value) ? value : defaults[key] ?? 0;
  }
  merged.opacity = Math.min(1, Math.max(0.01, (merged.opacity ?? 0.2) * safeIntensity));
  if (merged.count !== undefined) {
    merged.count = Math.min(200, Math.max(1, Math.round(merged.count * Math.max(safeIntensity, 0.1))));
  }
  return merged;
}

/** 雾带渐变:两个软边椭圆(边到边全透明,双份拼接无接缝)。 */
const FOG_GRADIENT =
  "radial-gradient(ellipse 55% 60% at 32% 50%, rgba(214,232,246,0.85), rgba(214,232,246,0) 72%),"
  + "radial-gradient(ellipse 45% 50% at 70% 42%, rgba(200,224,244,0.7), rgba(200,224,244,0) 70%)";

function FogBandLayer({ params }: { params: Record<string, number> }): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const y = numParam(params, "y", 0.55, 0, 0.9);
  const height = numParam(params, "height", 0.3, 0.05, 0.8);
  const speed = numParam(params, "speed", 1.5, 0.1, 20);
  const blur = numParam(params, "blur", 26, 0, 60);
  const opacity = numParam(params, "opacity", 0.2, 0.01, 0.6);
  const wrap = params.wrap === 0 ? false : true;
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

function ParticleFieldLayer({ params }: { params: Record<string, number> }): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const count = Math.round(numParam(params, "count", 48, 1, 200));
  const seed = Math.round(numParam(params, "seed", 20260819, 0, 2147483647));
  const r = Math.round(numParam(params, "r", 255, 0, 255));
  const g = Math.round(numParam(params, "g", 246, 0, 255));
  const b = Math.round(numParam(params, "b", 218, 0, 255));
  const sizeMin = numParam(params, "sizeMin", 2, 1, 80);
  const sizeMax = Math.max(sizeMin, numParam(params, "sizeMax", 6, 1, 120));
  const glow = numParam(params, "glow", 0.9, 0, 1);
  const opacity = numParam(params, "opacity", 0.7, 0.01, 1);
  const isLeaf = numParam(params, "shape", 0, 0, 1) >= 0.5;
  const motion: ParticleFieldMotion = {
    dir: numParam(params, "dir", 1, -1, 1) >= 0 ? 1 : -1,
    riseSpeed: numParam(params, "riseSpeed", 14, 0.5, 60),
    driftSpeed: numParam(params, "driftSpeed", 16, 0.5, 60),
    sway: numParam(params, "sway", 0, 0, 10),
    swayFreq: numParam(params, "swayFreq", 0, 0, 2),
    blink: numParam(params, "blink", 0.65, 0, 1),
  };
  const particles = React.useMemo(
    () => buildParticleField(seed, count, sizeMin, sizeMax),
    [seed, count, sizeMin, sizeMax],
  );
  const color = `rgba(${r},${g},${b},1)`;
  return (
    <>
      {particles.map((particle, index) => {
        const state = particleStateAt(particle, t, motion);
        const sizePx = Math.max(2, Math.round(particle.size));
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: `${(state.leftPct + state.swayPct).toFixed(3)}%`,
              top: `${state.topPct.toFixed(3)}%`,
              width: sizePx,
              height: isLeaf ? Math.round(sizePx * 1.4) : sizePx,
              ...(isLeaf
                ? {
                    background: `linear-gradient(135deg, ${color}, rgba(${Math.round(r * 0.7)},${Math.round(g * 0.7)},${Math.round(b * 0.7)},1))`,
                    borderRadius: `${Math.round(sizePx * 0.5)}px ${Math.round(sizePx * 0.15)}px ${Math.round(sizePx * 0.5)}px ${Math.round(sizePx * 0.15)}px`,
                  }
                : {
                    background: color,
                    borderRadius: "50%",
                    boxShadow: glow > 0
                      ? `0 0 ${(sizePx * 2.4 * glow).toFixed(1)}px rgba(${r},${g},${b},${(0.9 * glow).toFixed(2)})`
                      : undefined,
                  }),
              transform: isLeaf ? `rotate(${state.rotateDeg.toFixed(1)}deg)` : undefined,
              opacity: (state.opacity * opacity).toFixed(3),
            }}
          />
        );
      })}
    </>
  );
}

/**
 * 模板分发:按注册表 kind 实例化;未知模板渲染空层(闭集 fail-closed 在
 * 决策/投影/校验闸把关,渲染端兜底不崩)。
 */
export function AtmosphereTemplateLayer({ template }: { template: NonNullable<CompositionLayerSpec["template"]> }): React.ReactElement | null {
  if (!isAtmosphereTemplateId(template.id)) return null;
  const defn = getAtmosphereTemplate(template.id);
  return defn.kind === "fog"
    ? <FogBandLayer params={template.params ?? defn.defaults} />
    : <ParticleFieldLayer params={template.params ?? defn.defaults} />;
}
