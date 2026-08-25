// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoryboardPanelTab } from "./StoryboardPanelTab";
import type { StoryboardItem } from "@/types/studio";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() }) }));

function shot(index: number, path: string | undefined): StoryboardItem {
  return {
    id: `sb-${index}`,
    index,
    trackKey: `001-${index}`,
    episodeId: "chapter-001",
    duration: 4,
    prompt: `镜 ${index} 正文`,
    videoDesc: `镜 ${index} 画面`,
    associateAssetsNames: [],
    mediaRef: path ? ({ kind: "image", path } as StoryboardItem["mediaRef"]) : undefined,
  } as unknown as StoryboardItem;
}

describe("StoryboardPanelTab 4K 超分角标", () => {
  afterEach(cleanup);

  it("up4x- 产物的瓦片显示 4K 徽章替代「已生成」", () => {
    render(
      <StoryboardPanelTab
        storyboards={[
          shot(1, "project-file://p/workflow-images/chapter-001/f/up4x-gen-1.png"),
          shot(2, "project-file://p/workflow-images/chapter-001/f/gen-2.png"),
        ]}
        onOpenImageWorkflow={() => undefined}
      />,
    );
    expect(screen.getByText("4K")).toBeTruthy();
    expect(screen.getByText("已生成")).toBeTruthy();
    expect(screen.queryAllByText("4K")).toHaveLength(1);
    expect(screen.queryAllByText("已生成")).toHaveLength(1);
  });

  it("未超分与未生成的镜不显示 4K 徽章", () => {
    render(
      <StoryboardPanelTab
        storyboards={[shot(3, "project-file://p/gen-3.png"), shot(4, undefined)]}
        onOpenImageWorkflow={() => undefined}
      />,
    );
    expect(screen.queryByText("4K")).toBeNull();
  });
});
