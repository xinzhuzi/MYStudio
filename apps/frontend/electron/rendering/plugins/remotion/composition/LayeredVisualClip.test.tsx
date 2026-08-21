// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CompositionLayerSpec } from "./composition-props";
import type { CompositionVisualFx } from "./visual-fx";

// 同 VisualClip.test：mock remotion 模块边界（受控帧 + 占位媒体组件），
// 只测 LayeredVisualClip 自己的接线（氛围-only 栈=垫底媒体+氛围层+fx 叠层）。
const currentFrame = { value: 0 };

vi.mock("remotion", () => ({
  useCurrentFrame: () => currentFrame.value,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 90 }),
  useRemotionEnvironment: () => ({ isRendering: false, isClientSideRendering: false }),
  AbsoluteFill: ({ children, style }: { children?: unknown; style?: unknown }) =>
    <div data-testid="absolute-fill" data-style={JSON.stringify(style)}>
      {children as never}
    </div>,
  Img: ({ src, style }: { src: string; style?: unknown }) => (
    <img data-testid="img" data-src={src} data-style={JSON.stringify(style)} src={src} alt="" />
  ),
  OffthreadVideo: (props: { src: string; muted?: boolean; style?: unknown }) =>
    <div
      data-testid="offthread-video"
      data-src={props.src}
      data-muted={String(props.muted)}
      data-style={JSON.stringify(props.style)}
    />,
}));

const { LayeredVisualClip } = await import("./LayeredVisualClip");

/** 氛围-only 栈（视频镜典型，08-21 回归守护对象）。 */
const atmoStack: CompositionLayerSpec[] = [
  {
    role: "atmosphere",
    template: { id: "atmo:fog-band", params: { y: 0.55, height: 0.3, speed: 1.5, blur: 26, opacity: 0.2 } },
    blendMode: "screen",
  },
];

afterEach(() => {
  cleanup();
  currentFrame.value = 0;
});

describe("LayeredVisualClip 氛围-only 栈（08-21 fx/panZoom 透传修复）", () => {
  it("垫底视频 + 氛围层 + godRays fx 叠层共存（fx 不再被丢弃）", () => {
    const fx: CompositionVisualFx = { godRays: { intensity: 0.6, hue: 45 } };
    const { container } = render(
      <LayeredVisualClip
        layerStack={atmoStack}
        durationInFrames={90}
        baseSrc="http://127.0.0.1:1/tok/shot"
        baseKind="video"
        fx={fx}
      />,
    );
    // 垫底视频在场（黑底回归守护）
    expect(screen.getAllByTestId("offthread-video").length).toBeGreaterThan(0);
    // godRays 叠层在场：hsla(45,...) 渐变样式出现在某个 absolute-fill 上
    const godRaysLayer = [...container.querySelectorAll('[data-testid="absolute-fill"]')]
      .some((el) => (el.getAttribute("data-style") ?? "").includes("hsla(45"));
    expect(godRaysLayer).toBe(true);
  });

  it("glow fx 提供容器 filter（brightness/saturate）+ 叠加层", () => {
    const fx: CompositionVisualFx = { glow: { intensity: 0.5 } };
    const { container } = render(
      <LayeredVisualClip
        layerStack={atmoStack}
        durationInFrames={90}
        baseSrc="http://127.0.0.1:1/tok/shot"
        baseKind="video"
        fx={fx}
      />,
    );
    const styles = [...container.querySelectorAll('[data-testid="absolute-fill"]')].map((el) => el.getAttribute("data-style") ?? "");
    expect(styles.some((s) => s.includes("brightness"))).toBe(true);
    expect(styles.some((s) => s.includes("radial-gradient"))).toBe(true);
  });

  it("panZoom 作用于垫底媒体容器（scale 不再丢失）", () => {
    const { container } = render(
      <LayeredVisualClip
        layerStack={atmoStack}
        durationInFrames={90}
        baseSrc="http://127.0.0.1:1/tok/shot"
        baseKind="video"
        panZoom={{ fromScale: 1.0, toScale: 1.08, originX: 0.5, originY: 0.5 }}
      />,
    );
    // frame=0 → scale=fromScale=1.0；任何帧都应有 transformOrigin 注入容器
    const root = container.querySelector('[data-testid="absolute-fill"]');
    expect((root?.getAttribute("data-style") ?? "")).toContain("transformOrigin");
  });

  it("无 fx 时渲染回归零变化（无 filter/叠层注入）", () => {
    const { container } = render(
      <LayeredVisualClip
        layerStack={atmoStack}
        durationInFrames={90}
        baseSrc="http://127.0.0.1:1/tok/shot"
        baseKind="video"
      />,
    );
    const styles = [...container.querySelectorAll('[data-testid="absolute-fill"]')].map((el) => el.getAttribute("data-style") ?? "");
    expect(styles.some((s) => s.includes("brightness") || s.includes("hsla"))).toBe(false);
  });
});
