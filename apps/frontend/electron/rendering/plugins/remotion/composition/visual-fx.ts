// 镜头级 2D 特效（Design §6 的 panZoom 同族）：shake / glow / grain / chroma。
// 全部确定性（无随机）：shake 用分层正弦（与 cinematic-handheld 同纪律），grain 用
// 固定种子 SVG feTurbulence——Player 与固定 bundle 逐帧输出一致。

export interface CompositionVisualFx {
  /** 手持抖动；amplitudePx 为最大像素偏移（6=明显，3=轻微）。 */
  shake?: { amplitudePx: number };
  /** 暖调辉光；intensity 0..1（0.5=灵光/火光场景，0.25=暗夜氛围）。 */
  glow?: { intensity: number };
  /** 胶片颗粒；opacity 0..1（0.05=全局质感，0.1=重颗粒）。 */
  grain?: { opacity: number };
  /** 色差（RGB 分离）；offsetPx 2-4 用于爆点/冲击瞬间。 */
  chroma?: { offsetPx: number };
  /** 残影/拖影（08-19 第二批动画手法）：copies 层重影,offsetPx 逐层递增偏移。 */
  afterimage?: { copies: number; offsetPx: number; opacity: number };
  /** 速度剪影：暗色模糊条带在镜头前段快速掠过（direction 左→右/右→左）。 */
  speedSilhouette?: { direction: "ltr" | "rtl" };
  /** 神光/God Rays：多层斜向光柱 + screen 混合,intensity 0..1。 */
  godRays?: { intensity: number; hue?: number };
}

/** 确定性手持抖动偏移：三层不同频率正弦叠加，无随机项。 */
export function fxShakeOffset(
  frame: number,
  fx: CompositionVisualFx,
): { x: number; y: number } {
  const amp = fx.shake?.amplitudePx ?? 0;
  if (amp <= 0) return { x: 0, y: 0 };
  const t = frame;
  const x = (Math.sin(t * 0.71) + Math.sin(t * 1.13) * 0.5) * amp;
  const y = (Math.cos(t * 0.83) + Math.sin(t * 1.31) * 0.5) * amp * 0.8;
  return { x: round2(x), y: round2(y) };
}

/** glow 的滤镜串（亮度/饱和/对比轻推，暖辉由叠加层提供）。 */
export function fxFilter(fx: CompositionVisualFx): string | undefined {
  if (!fx.glow) return undefined;
  const i = Math.min(1, Math.max(0, fx.glow.intensity));
  return `brightness(${round2(1 + 0.12 * i)}) saturate(${round2(1 + 0.3 * i)}) contrast(${round2(1 + 0.06 * i)})`;
}

/** glow 暖色辉光叠加层样式（径向渐变 + screen 混合）。 */
export function fxGlowOverlayStyle(
  fx: CompositionVisualFx,
): React.CSSProperties | undefined {
  if (!fx.glow) return undefined;
  const i = Math.min(1, Math.max(0, fx.glow.intensity));
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background: `radial-gradient(ellipse at 50% 42%, rgba(255, 196, 110, ${round2(0.32 * i)}) 0%, rgba(255, 170, 90, ${round2(0.12 * i)}) 45%, transparent 72%)`,
    mixBlendMode: "screen",
  };
}

// 固定种子 feTurbulence：同 seed 同参数 → 浏览器渲染确定；平铺 240px 覆盖全帧。
const GRAIN_DATA_URI = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

/** 胶片颗粒叠加层样式（overlay 混合吃画面明暗）。 */
export function fxGrainOverlayStyle(
  fx: CompositionVisualFx,
): React.CSSProperties | undefined {
  if (!fx.grain) return undefined;
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    backgroundImage: GRAIN_DATA_URI,
    backgroundRepeat: "repeat",
    backgroundSize: "240px 240px",
    mixBlendMode: "overlay",
    opacity: Math.min(1, Math.max(0, fx.grain.opacity)),
  };
}

/** 色差偏移层的 tint（红/青一对，screen 混合叠在原画面上）。 */
export function fxChromaLayerStyle(
  fx: CompositionVisualFx,
  channel: "red" | "cyan",
): React.CSSProperties | undefined {
  const offset = fx.chroma?.offsetPx ?? 0;
  if (offset <= 0) return undefined;
  const dx = channel === "red" ? offset : -offset;
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    transform: `translateX(${dx}px)`,
    filter: channel === "red"
      ? "sepia(1) hue-rotate(-40deg) saturate(4)"
      : "sepia(1) hue-rotate(140deg) saturate(4)",
    mixBlendMode: "screen",
    opacity: 0.55,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}


// ---------------------------------------------------------------------------
// 第二批动画手法（08-19）：残影 / 速度剪影 / 神光
// ---------------------------------------------------------------------------

/** 残影层样式：第 i 层（1..copies）按方向偏移 i×offsetPx,透明度指数衰减。 */
export function fxAliasingLayerStyle(
  fx: CompositionVisualFx,
  index: number,
): React.CSSProperties | undefined {
  const a = fx.afterimage;
  if (!a) return undefined;
  const opacity = Math.min(1, Math.max(0, a.opacity * Math.pow(0.6, index)));
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    opacity,
    transform: `translateX(${(index * a.offsetPx).toFixed(1)}px) scaleX(${1 + index * 0.015})`,
    filter: `blur(${Math.min(8, index * 1.2).toFixed(1)}px)`,
  };
}

/** 速度剪影：镜头前 0.9s 内一条暗色模糊条带横掠全屏（确定性,无随机）。
 * 返回条带本体样式（外层容器 overflow:hidden 由调用方提供）。 */
export function fxSpeedSilhouetteStyle(
  frame: number,
  fps: number,
  fx: CompositionVisualFx,
): React.CSSProperties | undefined {
  if (!fx.speedSilhouette) return undefined;
  const sweepS = 0.9;
  const p = frame / (fps * sweepS);
  if (p < 0 || p > 1) return { display: "none" };
  const eased = p * p * (3 - 2 * p);
  const dir = fx.speedSilhouette.direction === "ltr" ? 1 : -1;
  const travel = dir > 0 ? eased * 130 - 15 : 15 - eased * 130;
  // 条带倾斜 8deg 强化速度感;透明度进出各 15% 渐变
  const fade = p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1;
  return {
    position: "absolute",
    top: "-10%",
    height: "120%",
    width: "26%",
    left: `${travel}%`,
    pointerEvents: "none",
    opacity: Math.round(fade * 100) / 100,
    transform: "rotate(8deg) skewX(-12deg)",
    filter: "blur(18px)",
    background:
      "linear-gradient(90deg, transparent 0%, rgba(10, 8, 18, 0.55) 45%, rgba(10, 8, 18, 0.55) 60%, transparent 100%)",
  };
}

/** 神光叠加层：三条斜向渐变光柱 + screen 混合,随帧缓慢摆动（确定性 sin）。 */
export function fxGodRaysOverlayStyle(
  frame: number,
  fx: CompositionVisualFx,
): React.CSSProperties | undefined {
  const g = fx.godRays;
  if (!g) return undefined;
  const i = Math.min(1, Math.max(0, g.intensity));
  const hue = g.hue ?? 45;
  const sway = Math.sin(frame * 0.02) * 2.5;
  const beam = (angle: number, alpha: number, width: number): string =>
    `linear-gradient(${angle}deg, hsla(${hue}, 80%, 80%, 0) 0%, hsla(${hue}, 80%, 82%, ${alpha}) ${width}%, hsla(${hue}, 80%, 80%, 0) ${width + 14}%)`;
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    mixBlendMode: "screen",
    background: [
      beam(105 + sway, round2(0.28 * i), 18),
      beam(112 - sway, round2(0.2 * i), 42),
      beam(98 + sway * 0.6, round2(0.16 * i), 64),
    ].join(","),
    filter: `blur(${(6 + Math.abs(sway)).toFixed(1)}px)`,
  };
}
