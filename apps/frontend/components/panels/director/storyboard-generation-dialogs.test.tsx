// @vitest-environment jsdom

import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryboardGenerationDialogs } from "./storyboard-generation-dialogs";
import { useStoryboardGenerationUi } from "./use-storyboard-generation-ui";

vi.mock("@/components/angle-switch", () => ({
  AngleSwitchDialog: (props: { open: boolean; previewUrl?: string; frameType: string }) => (
    <div data-testid="angle-input" data-open={props.open} data-preview={props.previewUrl} data-frame={props.frameType} />
  ),
  AngleSwitchResultDialog: (props: {
    open: boolean;
    history?: Array<{ imageUrl: string }>;
    onRegenerate: () => void;
  }) => (
    <div data-testid="angle-result" data-open={props.open} data-history={props.history?.map((item) => item.imageUrl).join(",")}>
      <button type="button" onClick={props.onRegenerate}>regenerate</button>
    </div>
  ),
}));

vi.mock("@/components/quad-grid", () => ({
  QuadGridDialog: (props: { previewUrl?: string; frameType: string }) => (
    <div data-testid="grid-input" data-preview={props.previewUrl} data-frame={props.frameType} />
  ),
  QuadGridResultDialog: (props: {
    availableScenes: Array<{ id: number; label: string }>;
    currentSceneId: number;
  }) => (
    <div
      data-testid="grid-result"
      data-scenes={props.availableScenes.map((scene) => `${scene.id}:${scene.label}`).join(",")}
      data-current-scene={props.currentSceneId}
    />
  ),
}));

const scenes = [
  {
    id: 0,
    imageDataUrl: "start-0",
    endFrameImageUrl: "end-0",
    startFrameAngleSwitchHistory: [{ imageUrl: "start-history", angleLabel: "start", timestamp: 1 }],
    endFrameAngleSwitchHistory: [{ imageUrl: "end-history", angleLabel: "end", timestamp: 2 }],
  },
  {
    id: 2,
    imageDataUrl: "start-2",
    endFrameImageUrl: "end-2",
    startFrameAngleSwitchHistory: [],
    endFrameAngleSwitchHistory: [],
  },
];

afterEach(cleanup);

function Harness({ frameType }: { frameType: "start" | "end" }) {
  const controller = useStoryboardGenerationUi({ defaultImageGenMode: "merged" });

  useEffect(() => {
    controller.setAngleSwitchTarget({ sceneId: 0, type: frameType });
    controller.setAngleSwitchOpen(true);
    controller.setAngleSwitchResultOpen(true);
    controller.setAngleSwitchResult({ originalImage: "original", newImage: "generated", angleLabel: "angle" });
    controller.setQuadGridTarget({ sceneId: 2, type: frameType });
    controller.setQuadGridOpen(true);
    controller.setQuadGridResultOpen(true);
  }, [frameType]);

  return (
    <StoryboardGenerationDialogs
      controller={controller}
      scenes={scenes}
      onGenerateAngle={vi.fn()}
      onApplyAngle={vi.fn()}
      onGenerateGrid={vi.fn()}
      onApplyGrid={vi.fn()}
      onCopyGridToScene={vi.fn()}
    />
  );
}

describe("StoryboardGenerationDialogs", () => {
  it("routes start and end frame previews, history, and scene labels", async () => {
    const { rerender } = render(<Harness frameType="end" />);

    await waitFor(() => expect(screen.getByTestId("angle-input").getAttribute("data-preview")).toBe("end-0"));
    expect(screen.getByTestId("angle-input").getAttribute("data-frame")).toBe("end");
    expect(screen.getByTestId("angle-result").getAttribute("data-history")).toBe("end-history");
    expect(screen.getByTestId("grid-input").getAttribute("data-preview")).toBe("end-2");
    expect(screen.getByTestId("grid-result").getAttribute("data-scenes")).toBe("0:分镜 1,2:分镜 3");
    expect(screen.getByTestId("grid-result").getAttribute("data-current-scene")).toBe("2");

    rerender(<Harness frameType="start" />);
    await waitFor(() => expect(screen.getByTestId("angle-input").getAttribute("data-preview")).toBe("start-0"));
    expect(screen.getByTestId("angle-result").getAttribute("data-history")).toBe("start-history");
    expect(screen.getByTestId("grid-input").getAttribute("data-preview")).toBe("start-2");
  });

  it("returns from the result view to the input dialog when regenerating", async () => {
    render(<Harness frameType="start" />);
    await waitFor(() => expect(screen.getByTestId("angle-input").getAttribute("data-preview")).toBe("start-0"));

    fireEvent.click(screen.getByRole("button", { name: "regenerate" }));

    await waitFor(() => expect(screen.getByTestId("angle-input").getAttribute("data-open")).toBe("true"));
    expect(screen.getByTestId("angle-result").getAttribute("data-open")).toBe("false");
  });
});
