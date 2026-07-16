// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { SplitSceneVideoActionBar } from "./split-scene-video-action-bar";

afterEach(cleanup);

function scene(id: number, imageDataUrl: string, videoStatus: SplitScene["videoStatus"]): SplitScene {
  return { id, imageDataUrl, videoStatus } as SplitScene;
}

describe("SplitSceneVideoActionBar", () => {
  it("counts eligible video scenes and calls the existing batch action", () => {
    const onGenerateVideos = vi.fn();
    render(
      <SplitSceneVideoActionBar
        scenes={[
          scene(1, "image-1", "idle"),
          scene(2, "image-2", "completed"),
          scene(3, "", "idle"),
        ]}
        isGenerating={false}
        onGenerateVideos={onGenerateVideos}
      />,
    );

    const action = screen.getByRole("button", { name: "生成视频 (1/3)" });
    expect((action as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(action);
    expect(onGenerateVideos).toHaveBeenCalledOnce();
  });

  it("disables the action until at least one scene has an image", () => {
    render(
      <SplitSceneVideoActionBar
        scenes={[scene(1, "", "idle"), scene(2, "", "failed")]}
        isGenerating={false}
        onGenerateVideos={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "生成视频 (0/2)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the existing generation state and blocks duplicate batch actions", () => {
    render(
      <SplitSceneVideoActionBar
        scenes={[scene(1, "image-1", "idle")]}
        isGenerating
        onGenerateVideos={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "生成中..." }) as HTMLButtonElement).disabled).toBe(true);
  });
});
