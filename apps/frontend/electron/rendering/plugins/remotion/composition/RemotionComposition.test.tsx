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
  OffthreadVideo: ({ src }: { src: string }) => <video src={src} />,
  useCurrentFrame: () => 2,
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
});
