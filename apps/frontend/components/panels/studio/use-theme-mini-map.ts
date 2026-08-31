import { useEffect, useRef, useState } from "react";
import { useThemeStore } from "@/stores/app/theme-store";
import type { CanvasMiniMapToken } from "@/lib/studio/canvas-node-registry";

/**
 * 小地图主题调色板(08-31-canvas-minimap 主题跟随补):
 * 注册表存语义 token 名,本 hook 把 CSS 变量(裸 HSL 三元组)解析成
 * 具体色串——SVG fill 属性不解析 var(),必须运行时取值。
 *
 * 竞态兜底:主题类(.dark/.theme-preset-*)由 ThemeProvider 在挂载期
 * 挂到 <html>,与画布首帧同帧竞争——首读可能拿到 :root 浅色默认值
 * (实弹症状=深色主题下小地图白底+中灰遮罩)。三重防线:
 * ①挂载后 rAF 重读一次;②MutationObserver 监听 html class 变更即重读;
 * ③theme/colorPreset store 变更触发重读。
 */
export interface ThemeMiniMapPalette {
  node: Record<CanvasMiniMapToken, string>;
  border: string;
  mask: string;
  card: string;
  ready: boolean;
}

const FALLBACK: ThemeMiniMapPalette = {
  node: { primary: "#0091ff", info: "#0ea5e9", success: "#22c55e", warning: "#f59e0b", accent: "#d97706" },
  border: "rgba(128,128,128,0.6)",
  mask: "rgba(0,0,0,0.4)",
  card: "#1c1c22",
  ready: false,
};

const TOKENS: CanvasMiniMapToken[] = ["primary", "info", "success", "warning", "accent"];

function readPalette(): ThemeMiniMapPalette {
  const styles = getComputedStyle(document.documentElement);
  const raw = (token: string) => styles.getPropertyValue(`--${token}`).trim();
  const nodeColors = Object.fromEntries(
    TOKENS.map((token) => {
      const value = raw(token);
      return [token, value ? `hsl(${value})` : FALLBACK.node[token]];
    }),
  ) as Record<CanvasMiniMapToken, string>;
  const border = raw("border") ? `hsl(${raw("border")})` : FALLBACK.border;
  const background = raw("background");
  const mask = background ? `hsl(${background} / 0.6)` : FALLBACK.mask;
  const card = raw("card") ? `hsl(${raw("card")})` : FALLBACK.card;
  return { node: nodeColors, border, mask, card, ready: true };
}

export function useThemeMiniMapPalette(): ThemeMiniMapPalette {
  const theme = useThemeStore((state) => state.theme);
  const colorPreset = useThemeStore((state) => state.colorPreset);
  const [palette, setPalette] = useState<ThemeMiniMapPalette>(FALLBACK);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const resolve = () => setPalette(readPalette());
    resolve();
    // ①挂载帧后重读(主题类同帧挂载的竞态兜底)
    rafRef.current = window.requestAnimationFrame(resolve);
    // ②html class 变更(主题预设/明暗切换挂 class)即重读
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      observer.disconnect();
    };
    // ③theme/colorPreset 变更(依赖数组)触发重跑
  }, [theme, colorPreset]);

  return palette;
}
