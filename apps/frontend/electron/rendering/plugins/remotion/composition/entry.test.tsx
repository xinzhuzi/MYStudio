import { describe, expect, it, vi } from "vitest";
import type { CompositionProps } from "./composition-props";

const remotionMocks = vi.hoisted(() => ({ registerRoot: vi.fn() }));

vi.mock("remotion", () => ({
  registerRoot: remotionMocks.registerRoot,
  Composition: () => null,
  AbsoluteFill: () => null,
  Sequence: () => null,
  Img: () => null,
  OffthreadVideo: () => null,
  useCurrentFrame: () => 0,
}));

vi.mock("@remotion/media", () => ({ Audio: () => null }));

const entry = await import("./entry");

const props: CompositionProps = {
  width: 720,
  height: 1280,
  fps: 24,
  durationInFrames: 240,
  visualClips: [],
  transitions: [],
  audioClips: [],
  subtitles: [],
};

function metadataArgs(value: CompositionProps) {
  return {
    defaultProps: entry.defaultCompositionProps,
    props: value,
    abortSignal: new AbortController().signal,
    compositionId: entry.REMOTION_COMPOSITION_ID,
    isRendering: true,
  };
}

describe("fixed composition entry", () => {
  it("registers exactly one stable Remotion root", () => {
    expect(remotionMocks.registerRoot).toHaveBeenCalledOnce();
    expect(remotionMocks.registerRoot).toHaveBeenCalledWith(entry.RemotionRoot);
  });

  it("derives render metadata from validated input props", async () => {
    expect(await entry.calculateCompositionMetadata(metadataArgs(props))).toEqual({
      durationInFrames: 240,
      fps: 24,
      width: 720,
      height: 1280,
      props,
    });
  });

  it("rejects invalid bundle input before rendering", () => {
    expect(() => entry.calculateCompositionMetadata(
      metadataArgs({ ...props, durationInFrames: 0 }),
    )).toThrow("durationInFrames");
  });
});
