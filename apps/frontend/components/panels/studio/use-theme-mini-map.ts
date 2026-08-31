import { useLayoutEffect, useState } from "react";
import { useThemeStore } from "@/stores/app/theme-store";
import type { CanvasMiniMapToken } from "@/lib/studio/canvas-node-registry";

/**
 * 小地图主题调色板(08-31-canvas-minimap 主题跟随补):
 * 注册表存语义 token 名,本 hook 在主题预设/明暗切换时把 CSS 变量
 * (裸 HSL 三元组)解析成具体色串——SVG fill 属性不解析 var(),必须
 * 运行时取值。MiniMap 的遮罩/描边/节点色全部由此供给。
 */
export interface ThemeMiniMapPalette {
  node: Record<CanvasMiniMapToken, string>;
  border: string;
  mask: string;
  ready: boolean;
}

const FALLBACK: ThemeMiniMapPalette = {
  node: { primary: "#0091ff", info: "#0ea5e9", success: "#22c55e", warning: "#f59e0b", accent: "#d97706" },
  border: "rgba(128,128,128,0.6)",
  mask: "rgba(0,0,0,0.4)",
  ready: false,
};

const TOKENS: CanvasMiniMapToken[] = ["primary", "info", "success", "warning", "accent"];

export function useThemeMiniMapPalette(): ThemeMiniMapPalette {
  const theme = useThemeStore((state) => state.theme);
  const colorPreset = useThemeStore((state) => state.colorPreset);
  const [palette, setPalette] = useState<ThemeMiniMapPalette>(FALLBACK);

  useLayoutEffect(() => {
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
    setPalette({ node: nodeColors, border, mask, ready: true });
  }, [theme, colorPreset]);

  return palette;
}
