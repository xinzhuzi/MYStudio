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
