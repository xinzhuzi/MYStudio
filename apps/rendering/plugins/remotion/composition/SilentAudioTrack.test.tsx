// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const audioProps = vi.hoisted(() => ({
  value: undefined as { src: string; loop?: boolean } | undefined,
}));
const sequenceProps = vi.hoisted(() => ({
  value: undefined as { durationInFrames?: number; layout?: string } | undefined,
}));

vi.mock("@remotion/media", () => ({
  Audio: (props: { src: string; loop?: boolean }) => {
    audioProps.value = props;
    return <div data-testid="silent-audio" />;
  },
}));

vi.mock("remotion", () => ({
  Sequence: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    durationInFrames?: number;
    layout?: string;
  }) => {
    sequenceProps.value = props;
    return <>{children}</>;
  },
}));

const { SilentAudioTrack } = await import("./SilentAudioTrack");

describe("SilentAudioTrack", () => {
  afterEach(() => {
    cleanup();
    audioProps.value = undefined;
    sequenceProps.value = undefined;
  });

  it("loops a generated 48kHz stereo WAV for the full composition", () => {
    render(<SilentAudioTrack durationInFrames={90} />);
    expect(sequenceProps.value).toEqual({ durationInFrames: 90, layout: "none" });
    expect(audioProps.value?.loop).toBe(true);
    expect(audioProps.value?.src).toMatch(/^data:audio\/wav;base64,/);
    const header = atob(audioProps.value!.src.split(",", 2)[1]).slice(0, 12);
    expect(header).toBe("RIFF\x24K\x00\x00WAVE");
  });
});
