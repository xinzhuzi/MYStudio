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

describe("vsc depth 层锚渲染（10-10 批B,parallax-glide/dolly-zoom 层系数消费）", () => {
  it("背景层 blur+saturate 滤镜按进度插值,主体层无锚(高清)", () => {
    const stack: CompositionLayerSpec[] = [
      { role: "background", src: "http://127.0.0.1:1/bg.png", panZoomDamp: 0.35, opacity: 0.85, depthAnchor: { blurFromPx: 2, blurToPx: 2, saturate: 0.92 } },
      { role: "subject", src: "http://127.0.0.1:1/subj.png", panZoomDamp: 0.7 },
    ];
    currentFrame.value = 30; // 90f 中点:cubic 进度 0.5
    const { container } = render(
      <LayeredVisualClip
        layerStack={stack}
        durationInFrames={90}
        panZoom={{ fromScale: 1.04, toScale: 1.1, originX: 0.68, originY: 0.5 }}
      />,
    );
    const layers = container.querySelectorAll('[data-testid="absolute-fill"]');
    const bgStyle = JSON.parse(layers[1]?.getAttribute("data-style") ?? "{}");
    expect(bgStyle.filter).toBe("blur(2.000px) saturate(0.92)");
    expect(bgStyle.opacity).toBe(0.85);
    const subjectStyle = JSON.parse(layers[2]?.getAttribute("data-style") ?? "{}");
    expect(subjectStyle.filter).toBeUndefined();
  });

  it("dolly 背景膨胀 blur 0→3.5 渐深(帧 0=0px,末帧=3.5px);主体 damp 0 恒 scale 1", () => {
    const stack: CompositionLayerSpec[] = [
      { role: "background", src: "http://127.0.0.1:1/bg.png", panZoomDamp: 1, depthAnchor: { blurFromPx: 0, blurToPx: 3.5 } },
      { role: "subject", src: "http://127.0.0.1:1/subj.png", panZoomDamp: 0 },
    ];
    const pan = { fromScale: 1, toScale: 2.25, originX: 0.5, originY: 0.5 };
    currentFrame.value = 0;
    const first = render(
      <LayeredVisualClip layerStack={stack} durationInFrames={90} panZoom={pan} />,
    );
    const firstLayers = first.container.querySelectorAll('[data-testid="absolute-fill"]');
    expect(JSON.parse(firstLayers[1]?.getAttribute("data-style") ?? "{}").filter).toBe("blur(0.000px)");
    cleanup();

    currentFrame.value = 89;
    const last = render(
      <LayeredVisualClip layerStack={stack} durationInFrames={90} panZoom={pan} />,
    );
    const lastLayers = last.container.querySelectorAll('[data-testid="absolute-fill"]');
    const bgTransform = JSON.parse(lastLayers[1]?.getAttribute("data-style") ?? "{}").transform;
    expect(bgTransform).toContain("scale(2.2"); // 背景吃满膨胀(89/89≈1, cubic→2.25)
    const subjectTransform = JSON.parse(lastLayers[2]?.getAttribute("data-style") ?? "{}").transform;
    expect(subjectTransform).toContain("scale(1.0"); // damp 0:钉死 1→1,不随背景膨胀
  });

  it("无锚层不产生 filter 键(存量 layerStack 逐字节不变)", () => {
    const { container } = render(
      <LayeredVisualClip
        layerStack={atmoStack}
        durationInFrames={90}
        baseSrc="http://127.0.0.1:1/base.mp4"
        baseKind="video"
      />,
    );
    const layers = container.querySelectorAll('[data-testid="absolute-fill"]');
    for (const layer of layers) {
      expect(JSON.parse(layer.getAttribute("data-style") ?? "{}").filter).toBeUndefined();
    }
  });
});
