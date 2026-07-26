// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { CompositionAudioClipProps } from "./composition-props";

// Mock the @remotion/media boundary so we can capture the props (especially the
// volume callback) AudioClip passes, without Remotion's timeline context.
const lastProps: {
  value?: {
    src: string;
    trimBefore?: number;
    playbackRate?: number;
    volume: (frame: number) => number;
  };
} = {};

vi.mock("@remotion/media", () => ({
  Audio: (props: {
    src: string;
    trimBefore?: number;
    playbackRate?: number;
    volume: (frame: number) => number;
  }) => {
    lastProps.value = props;
    return <div data-testid="audio" data-src={props.src} />;
  },
}));

const { AudioClip } = await import("./AudioClip");

function voiceClip(
  overrides: Partial<CompositionAudioClipProps> = {},
): CompositionAudioClipProps {
  return {
    clipId: "v1",
    kind: "voice",
    src: "http://127.0.0.1:1/tok/v1",
    from: 0,
    durationInFrames: 60,
    volume: 1,
    ...overrides,
  };
}

describe("AudioClip", () => {
  afterEach(() => cleanup());

  it("passes the capability src and frame-based trim to Audio", () => {
    render(<AudioClip {...voiceClip({ trimStartFrames: 12, playbackRate: 2 })} />);
    expect(lastProps.value?.src).toBe("http://127.0.0.1:1/tok/v1");
    expect(lastProps.value?.trimBefore).toBe(12);
    expect(lastProps.value?.playbackRate).toBe(2);
  });

  it("combines volume, fade and envelope in the volume callback", () => {
    render(
      <AudioClip
        {...voiceClip({
          volume: 0.5,
          fade: { fadeInFrames: 10, fadeOutFrames: 0 },
          envelope: [
            { frame: 0, gain: 1 },
            { frame: 60, gain: 0.5 },
          ],
        })}
      />,
    );
    const volume = lastProps.value?.volume;
    expect(volume).toBeTypeOf("function");
    // frame 5: 0.5 (volume) * 0.5 (fade-in halfway) * envelope(5).
    const envAt5 = 1 + (0.5 - 1) * (5 / 60);
    expect(volume?.(5)).toBeCloseTo(0.5 * 0.5 * envAt5);
  });

  it("defaults playbackRate to 1 when unset", () => {
    render(<AudioClip {...voiceClip()} />);
    expect(lastProps.value?.playbackRate).toBe(1);
  });

  it("holds the volume at the static value with no fade or envelope", () => {
    render(<AudioClip {...voiceClip({ volume: 0.8 })} />);
    expect(lastProps.value?.volume?.(30)).toBeCloseTo(0.8);
  });
});
