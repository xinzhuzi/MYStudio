// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { CompositionVisualClipProps } from "./composition-props";

// useCurrentFrame requires Remotion's internal timeline context, so we mock the
// remotion module boundary: a controlled frame plus inspectable placeholders for
// the media components. This tests the wiring VisualClip owns (Img vs
// OffthreadVideo, capability src, per-frame panZoom -> style) without depending
// on Remotion's undocumented internal providers.
const currentFrame = { value: 0 };

vi.mock("remotion", () => ({
  useCurrentFrame: () => currentFrame.value,
  // GLGradeMedia 渲染期专用：测试（非渲染环境）下 isRendering=false 走原媒体分支。
  useRemotionEnvironment: () => ({ isRendering: false, isClientSideRendering: false }),
  AbsoluteFill: ({ children, style }: { children?: unknown; style?: unknown }) =>
    <div data-testid="absolute-fill" data-style={JSON.stringify(style)}>
      {children as never}
    </div>,
  Img: ({ src, style }: { src: string; style?: unknown }) => (
    <img data-testid="img" data-style={JSON.stringify(style)} src={src} alt="" />
  ),
  OffthreadVideo: (props: { src: string; trimBefore?: number; playbackRate?: number; muted?: boolean; style?: unknown }) =>
    <div
      data-testid="offthread-video"
      data-src={props.src}
      data-trim={String(props.trimBefore)}
      data-rate={String(props.playbackRate)}
      data-muted={String(props.muted)}
      data-style={JSON.stringify(props.style)}
    />,
}));

const { VisualClip } = await import("./VisualClip");

function imageClip(overrides: Partial<CompositionVisualClipProps> = {}): CompositionVisualClipProps {
  return {
    clipId: "a",
    kind: "image",
    src: "http://127.0.0.1:1/tok/a",
    from: 0,
    durationInFrames: 30,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    ...overrides,
  };
}

describe("VisualClip", () => {
  afterEach(() => cleanup());

  it("renders an Img with the capability src for an image clip", () => {
    currentFrame.value = 0;
    const { getByTestId, queryByTestId } = render(<VisualClip {...imageClip()} />);
    expect(getByTestId("img").getAttribute("src")).toBe("http://127.0.0.1:1/tok/a");
    expect(JSON.parse(getByTestId("img").getAttribute("data-style") ?? "{}").objectFit).toBe("cover");
    expect(queryByTestId("offthread-video")).toBeNull();
  });

  it("uses contain only when the visual clip requests it", () => {
    const { getByTestId } = render(<VisualClip {...imageClip({ fit: "contain" })} />);
    expect(JSON.parse(getByTestId("img").getAttribute("data-style") ?? "{}").objectFit).toBe("contain");
  });

  it("renders OffthreadVideo with frame trim, rate and muted for a video clip", () => {
    currentFrame.value = 0;
    const { getByTestId } = render(
      <VisualClip
        {...imageClip({
          kind: "video",
          src: "http://127.0.0.1:1/tok/v",
          trimStartFrames: 12,
          playbackRate: 2,
          muted: false,
        })}
      />,
    );
    const video = getByTestId("offthread-video");
    expect(video.getAttribute("data-src")).toBe("http://127.0.0.1:1/tok/v");
    expect(video.getAttribute("data-trim")).toBe("12");
    expect(video.getAttribute("data-rate")).toBe("2");
    expect(video.getAttribute("data-muted")).toBe("false");
  });

  it("samples panZoom at the current frame into the fill style", () => {
    // panZoom from 1 -> 2 over 30 frames; at the last frame scale is 2.
    currentFrame.value = 29;
    const { getByTestId } = render(
      <VisualClip
        {...imageClip({
          panZoom: { fromScale: 1, toScale: 2, originX: 0.5, originY: 0.5 },
        })}
      />,
    );
    const style = JSON.parse(getByTestId("absolute-fill").getAttribute("data-style") ?? "{}");
    expect(style.transform).toContain("scale(2, 2)");
    expect(style.transformOrigin).toBe("50% 50%");
  });
});
