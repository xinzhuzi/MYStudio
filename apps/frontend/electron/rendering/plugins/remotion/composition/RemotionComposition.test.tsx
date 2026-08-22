// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompositionProps } from "./composition-props";

const sequenceLog = vi.hoisted(() => ({
  items: [] as Array<{ from?: number; durationInFrames?: number; layout?: string }>,
}));

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={style}>{children}</div>
  ),
  Sequence: ({
    children,
    from,
    durationInFrames,
    layout,
  }: {
    children?: React.ReactNode;
    from?: number;
    durationInFrames?: number;
    layout?: string;
  }) => {
    sequenceLog.items.push({ from, durationInFrames, layout });
    return <>{children}</>;
  },
  Img: ({ src }: { src: string }) => <img src={src} alt="" />,
  OffthreadVideo: ({ src, transparent }: { src: string; transparent?: boolean }) => (
    <video src={src} data-transparent={String(transparent)} />
  ),
  useCurrentFrame: () => 2,
  // GLTransitionLayer 渲染期专用：测试（非渲染环境）下 isRendering=false 直接短路。
  useRemotionEnvironment: () => ({ isRendering: false, isClientSideRendering: false }),
  useVideoConfig: () => ({ width: 1920, height: 1080, fps: 30, durationInFrames: 90 }),
  delayRender: () => 0,
  continueRender: () => undefined,
}));

vi.mock("@remotion/media", () => ({
  Audio: ({ src }: { src: string }) => <div data-audio-src={src} />,
}));

const { RemotionComposition } = await import("./RemotionComposition");

const transform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

function composition(): CompositionProps {
  return {
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 15,
    visualClips: [
      { clipId: "a", kind: "image", src: "http://127.0.0.1:1/t/a", from: 0, durationInFrames: 10, transform },
      { clipId: "b", kind: "video", src: "http://127.0.0.1:1/t/b", from: 5, durationInFrames: 10, transform },
    ],
    transitions: [
      { fromClipId: "a", toClipId: "b", effectId: "flash", overlapFrames: 5 },
    ],
    audioClips: [
      { clipId: "voice", kind: "voice", src: "http://127.0.0.1:1/t/voice", from: 2, durationInFrames: 8, volume: 1 },
    ],
    subtitles: [
      { cueId: "cue", text: "字幕", from: 3, durationInFrames: 4 },
    ],
    overlayClips: [
      { clipId: "hyperframes-overlay", src: "http://127.0.0.1:1/t/overlay", from: 0, durationInFrames: 12 },
    ],
  };
}

describe("RemotionComposition", () => {
  afterEach(() => {
    cleanup();
    sequenceLog.items.length = 0;
  });

  it("mounts visual, transition, audio and subtitle ranges on one frame grid", () => {
    const rendered = render(<RemotionComposition {...composition()} />);
    expect(sequenceLog.items).toEqual(expect.arrayContaining([
      { from: 0, durationInFrames: 10, layout: "none" },
      { from: 5, durationInFrames: 10, layout: "none" },
      { from: 5, durationInFrames: 5, layout: "none" },
      { from: 2, durationInFrames: 8, layout: "none" },
      { from: 3, durationInFrames: 4, layout: "none" },
      { from: 0, durationInFrames: 12, layout: "none" },
    ]));
    expect(screen.getByText("字幕")).toBeTruthy();
    expect(rendered.container.querySelector('video[src="http://127.0.0.1:1/t/overlay"]')).toBeTruthy();
  });

  it("renders HyperFrames overlays with alpha preserved (transparent=true)", () => {
    // Regression: ProRes 4444 overlays lose their alpha channel without the
    // `transparent` prop, turning the mostly-transparent effect layer into an
    // opaque black cover over the entire chapter video.
    const rendered = render(<RemotionComposition {...composition()} />);
    const overlay = rendered.container.querySelector('video[src="http://127.0.0.1:1/t/overlay"]');
    expect(overlay?.getAttribute("data-transparent")).toBe("true");
    // Visual clips must NOT opt into per-pixel alpha extraction.
    const visual = rendered.container.querySelector('video[src="http://127.0.0.1:1/t/b"]');
    expect(visual?.getAttribute("data-transparent")).toBe("undefined");
  });

  it("keeps the subtitle layer above the GL transition canvas (zIndex > 2)", () => {
    // Regression (08-23): GLTransitionLayer mounts its ThreeCanvas with
    // zIndex: 2. The subtitle track rendered after it in DOM order but
    // without a z-index, so gl:* transition quads covered burned-in
    // subtitles for the whole overlap window (render only — the Player's
    // DOM-crossfade preview showed the cue, masking the bug).
    const props = composition();
    props.transitions = [
      { fromClipId: "a", toClipId: "b", effectId: "gl:swap", overlapFrames: 5 },
    ];
    render(<RemotionComposition {...props} />);
    const cue = screen.getByText("字幕");
    const wrapperWithZ = (cue.parentElement as HTMLElement | null)?.closest<HTMLElement>("div[style*='z-index']");
    expect(wrapperWithZ).not.toBeNull();
    const zIndex = Number(wrapperWithZ?.style.zIndex);
    expect(Number.isFinite(zIndex)).toBe(true);
    expect(zIndex).toBeGreaterThan(2);
  });

  it("keeps the HyperFrames overlay above the GL transition canvas but below subtitles", () => {
    // Regression (08-23 follow-up): the decorative HyperFrames overlay was
    // also buried under the GL transition canvas (zIndex: 2), so decorative
    // windows blinked out during gl:* overlaps. The overlay must restore its
    // DOM-order position — above transitions, below the subtitle track.
    const props = composition();
    props.transitions = [
      { fromClipId: "a", toClipId: "b", effectId: "gl:swap", overlapFrames: 5 },
    ];
    const rendered = render(<RemotionComposition {...props} />);
    const overlay = rendered.container.querySelector('video[src="http://127.0.0.1:1/t/overlay"]');
    expect(overlay).not.toBeNull();
    const overlayZ = (overlay as HTMLElement).closest<HTMLElement>("div[style*='z-index']");
    expect(overlayZ).not.toBeNull();
    const overlayZIndex = Number(overlayZ?.style.zIndex);
    expect(Number.isFinite(overlayZIndex)).toBe(true);
    expect(overlayZIndex).toBeGreaterThan(2);
    const cue = screen.getByText("字幕");
    const subtitleZ = (cue.parentElement as HTMLElement | null)?.closest<HTMLElement>("div[style*='z-index']");
    const subtitleZIndex = Number(subtitleZ?.style.zIndex);
    expect(subtitleZIndex).toBeGreaterThan(overlayZIndex);
  });
});
