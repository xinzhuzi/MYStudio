// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompositionProps } from "./composition-props";

const playerProps = vi.hoisted(() => ({ value: undefined as Record<string, unknown> | undefined }));

vi.mock("@remotion/player", () => ({
  Player: (props: Record<string, unknown>) => {
    playerProps.value = props;
    return <div data-testid="remotion-player" />;
  },
}));

const { RemotionPlayer } = await import("./RemotionPlayer");

const props: CompositionProps = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 30,
  visualClips: [],
  transitions: [],
  audioClips: [],
  subtitles: [],
};

describe("RemotionPlayer", () => {
  afterEach(() => {
    cleanup();
    playerProps.value = undefined;
  });

  it("mounts and releases the injected preview session exactly once", () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    const { unmount: dispose } = render(
      <RemotionPlayer composition={props} session={{ mount, unmount }} />,
    );
    expect(mount).toHaveBeenCalledOnce();
    dispose();
    expect(unmount).toHaveBeenCalledOnce();
  });

  it("passes validated dimensions and timing to Player", () => {
    render(<RemotionPlayer composition={props} className="preview" />);
    expect(screen.getByTestId("remotion-player")).toBeTruthy();
    expect(playerProps.value).toMatchObject({
      className: "preview",
      inputProps: props,
      durationInFrames: 30,
      fps: 30,
      compositionWidth: 1080,
      compositionHeight: 1920,
      controls: true,
    });
  });

  it("rejects invalid props before mounting Player or a media session", () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    const { container } = render(
      <RemotionPlayer
        composition={{ ...props, width: 0 }}
        session={{ mount, unmount }}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(mount).not.toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
    expect(playerProps.value).toBeUndefined();
  });
});
