// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import { VisualContinuityReviewPanel } from "./VisualContinuityReviewPanel";

afterEach(cleanup);

function storyboard(index: number): StoryboardItem {
  return {
    id: `sb-${index}`,
    episodeId: "chapter-001",
    index,
    trackKey: "dock",
    trackId: "track-dock",
    duration: 4,
    prompt: `镜头 ${index}`,
    videoDesc: `码头动作 ${index}`,
    assetIds: ["character:dugu", "scene:dock"],
    mediaRef: { kind: "image", path: `/frames/sb-${index}.png` },
    state: "ready",
    continuityState: {
      groupId: "chapter-001:dock:1-3",
      previousStoryboardId: index > 1 ? `sb-${index - 1}` : undefined,
      sceneVersionId: "dock:morning",
      sceneViewpointId: "dock-main-axis",
      lighting: "冷青晨雾",
      palette: "墨青灰蓝",
      actionIn: index > 1 ? "承接上一镜" : "建立场景",
      actionOut: "继续向右",
      characters: [{
        characterId: "dugu",
        versionId: "dugu:base",
        position: "中景",
        orientation: "朝右",
        actionIn: "迈步",
        actionOut: "继续迈步",
      }],
      inputFingerprint: `fingerprint-${index}`,
    },
  };
}

describe("VisualContinuityReviewPanel", () => {
  it("shows previous/current/next evidence and requires every current-shot check before approval", () => {
    const onReview = vi.fn();
    render(<VisualContinuityReviewPanel storyboards={[storyboard(1), storyboard(2), storyboard(3)]} onReview={onReview} />);

    expect(screen.getByRole("img", { name: "当前镜第 1 镜画面" }).getAttribute("src")).toBe("file:///frames/sb-1.png");
    expect(screen.getByRole("img", { name: "下一镜第 2 镜画面" })).toBeTruthy();
    const approve = screen.getByRole("button", { name: "批准第 1 镜" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /角色 dugu/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /场景 dock:morning/ }));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);

    expect(onReview).toHaveBeenCalledWith("sb-1", expect.objectContaining({
      status: "approved",
      evidencePaths: ["/frames/sb-1.png"],
      characterChecks: [{ characterId: "dugu", passed: true }],
      sceneChecks: [{ sceneVersionId: "dock:morning", passed: true }],
      transitionChecks: [],
    }));
  });

  it("requires a reason for rejection and resets checks when navigating", () => {
    const onReview = vi.fn();
    render(<VisualContinuityReviewPanel storyboards={[storyboard(1), storyboard(2)]} onReview={onReview} />);

    const rejectFirst = screen.getByRole("button", { name: "驳回第 1 镜" }) as HTMLButtonElement;
    expect(rejectFirst.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "独孤剑尘服装颜色变化" } });
    fireEvent.click(rejectFirst);
    expect(onReview).toHaveBeenCalledWith("sb-1", expect.objectContaining({
      status: "rejected",
      reasons: ["独孤剑尘服装颜色变化"],
    }));

    fireEvent.click(screen.getByRole("button", { name: "审核下一镜" }));
    expect((screen.getByRole("button", { name: "批准第 2 镜" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("checkbox", { name: /与上一镜 sb-1/ }).getAttribute("data-state")).toBe("unchecked");
    expect((screen.getByLabelText("驳回原因") as HTMLTextAreaElement).value).toBe("");
  });
});
