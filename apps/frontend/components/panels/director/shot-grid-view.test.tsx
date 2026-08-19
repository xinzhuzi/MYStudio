// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Shot } from "@/types/script";
import { ShotGridView } from "./shot-grid-view";

const mocks = vi.hoisted(() => ({
  updateShot: vi.fn(),
  getCharacterById: vi.fn(),
  shots: [] as Shot[],
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: () => ({ activeProjectId: "project-1" }),
}));

vi.mock("@/stores/script/script-store", () => ({
  useScriptStore: () => ({ updateShot: mocks.updateShot }),
  useActiveScriptProject: () => ({
    shots: mocks.shots,
    scriptData: { scenes: [] },
  }),
}));

vi.mock("@/stores/library/character-library-store", () => ({
  useCharacterLibraryStore: () => ({
    characters: [],
    getCharacterById: mocks.getCharacterById,
  }),
}));

vi.mock("@/components/BatchProgressOverlay", () => ({
  BatchProgressOverlay: () => null,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/features/storyboard/angle-switch", () => ({
  AngleSwitchDialog: () => null,
  AngleSwitchResultDialog: () => null,
}));

function makeShot(overrides: Partial<Shot>): Shot {
  return {
    id: "shot-1",
    index: 0,
    sceneRefId: "scene-1",
    actionSummary: "镜头动作",
    characterIds: [],
    characterVariations: {},
    imageStatus: "idle",
    imageProgress: 0,
    videoStatus: "idle",
    videoProgress: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.shots = [
    makeShot({
      id: "shot-1",
      index: 0,
      shotSize: "近景",
      actionSummary: "角色拔剑",
      imageUrl: "media://legacy-start",
      keyframes: [
        {
          id: "kf-1",
          type: "start",
          visualPrompt: "start",
          imageUrl: "media://keyframe-start",
          status: "completed",
        },
      ],
      interval: {
        videoUrl: "media://video-1",
        status: "completed",
      },
    }),
    makeShot({
      id: "shot-2",
      index: 1,
      shotSize: "全景",
      actionSummary: "群山显现",
      imageUrl: "media://legacy-second",
    }),
    makeShot({
      id: "shot-3",
      index: 2,
      shotSize: "特写",
      actionSummary: "无图占位",
    }),
  ];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ShotGridView cards", () => {
  it("renders card media/status details and selects the clicked shot", () => {
    const { container } = render(<ShotGridView />);

    expect(screen.getByText("SHOT 01")).toBeTruthy();
    expect(screen.getByText("SHOT 02")).toBeTruthy();
    expect(screen.getByText("SHOT 03")).toBeTruthy();
    expect(screen.getByText("近景")).toBeTruthy();
    expect(screen.getByText("角色拔剑")).toBeTruthy();

    expect(screen.getByAltText("Shot 1").getAttribute("src")).toBe(
      "media://keyframe-start",
    );
    expect(screen.getByAltText("Shot 2").getAttribute("src")).toBe(
      "media://legacy-second",
    );
    expect(screen.queryByAltText("Shot 3")).toBeNull();
    expect(container.querySelectorAll(".lucide-video")).toHaveLength(1);

    fireEvent.click(screen.getByText("SHOT 02"));

    expect(screen.getByText("镜头详情")).toBeTruthy();
    expect(screen.getAllByText("群山显现")).toHaveLength(2);
    expect(screen.getByText("SHOT 02").closest(".group")?.className).toContain(
      "border-primary",
    );
  });

  it("routes detail navigation, generation controls, and close behavior", async () => {
    const onGenerateImage = vi.fn(async (_shot: Shot, type: "start" | "end") =>
      `media://generated-${type}`,
    );
    const onGenerateVideo = vi.fn(async () => "media://generated-video");
    const { container } = render(
      <ShotGridView
        onGenerateImage={onGenerateImage}
        onGenerateVideo={onGenerateVideo}
      />,
    );

    fireEvent.click(screen.getByText("SHOT 02"));
    const previousButton = container.querySelector(".lucide-chevron-left")?.closest("button");
    const nextButton = container.querySelector(".lucide-chevron-right")?.closest("button");
    expect(previousButton).toBeTruthy();
    expect(nextButton).toBeTruthy();
    expect(previousButton?.hasAttribute("disabled")).toBe(false);
    expect(nextButton?.hasAttribute("disabled")).toBe(false);

    fireEvent.click(previousButton!);
    expect(screen.getByText("SHOT 01").closest(".group")?.className).toContain(
      "border-primary",
    );
    expect(previousButton?.hasAttribute("disabled")).toBe(true);
    expect(nextButton?.hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    await waitFor(() => {
      expect(onGenerateImage).toHaveBeenCalledWith(mocks.shots[0], "start");
      expect(mocks.updateShot).toHaveBeenCalledWith(
        "project-1",
        "shot-1",
        expect.objectContaining({
          imageUrl: "media://generated-start",
          imageStatus: "completed",
          keyframes: expect.arrayContaining([
            expect.objectContaining({
              type: "start",
              imageUrl: "media://generated-start",
              status: "completed",
            }),
          ]),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await waitFor(() => {
      expect(onGenerateImage).toHaveBeenCalledWith(mocks.shots[0], "end");
      expect(mocks.updateShot).toHaveBeenCalledWith(
        "project-1",
        "shot-1",
        expect.objectContaining({
          keyframes: expect.arrayContaining([
            expect.objectContaining({
              type: "end",
              imageUrl: "media://generated-end",
              status: "completed",
            }),
          ]),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "重新生成视频" }));
    await waitFor(() => {
      expect(onGenerateVideo).toHaveBeenCalledWith(
        mocks.shots[0],
        "media://keyframe-start",
        undefined,
      );
      expect(mocks.updateShot).toHaveBeenCalledWith("project-1", "shot-1", {
        videoUrl: "media://generated-video",
        videoStatus: "completed",
        interval: {
          videoUrl: "media://generated-video",
          duration: 3,
          status: "completed",
        },
      });
    });

    fireEvent.click(nextButton!);
    expect(screen.getByText("SHOT 02").closest(".group")?.className).toContain(
      "border-primary",
    );

    fireEvent.click(screen.getByText("SHOT 03"));
    expect(nextButton?.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "生成视频" }).hasAttribute("disabled")).toBe(
      true,
    );

    const closeButton = container.querySelector(".lucide-x")?.closest("button");
    expect(closeButton).toBeTruthy();
    fireEvent.click(closeButton!);
    expect(screen.queryByText("镜头详情")).toBeNull();
  });
});
