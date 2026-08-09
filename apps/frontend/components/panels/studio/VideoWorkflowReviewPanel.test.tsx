// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { VideoWorkflowReviewPanel } from "./VideoWorkflowReviewPanel";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "videoWorkflowPlugins");
});

describe("VideoWorkflowReviewPanel", () => {
  it("confirms the exact project/chapter/revision through the narrow bridge", async () => {
    const review = vi.fn(async () => ({
      schemaVersion: 1 as const,
      success: true,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 3,
      status: "accepted" as const,
      artifactPath: "/tmp/video-use-artifact.json",
    }));
    Object.defineProperty(window, "videoWorkflowPlugins", { configurable: true, value: { review } });
    render(<VideoWorkflowReviewPanel projectId="project-1" chapterId="chapter-1" revision={3} />);
    expect(screen.getByRole("region", { name: "video-use 用户确认" }).getAttribute("data-video-use-review-pending")).toBe("true");
    expect(screen.getByRole("button", { name: "确认当前预览" }).hasAttribute("data-video-use-review-confirm")).toBe(true);
    expect(screen.getByLabelText("video-use revision").getAttribute("data-video-use-review-revision")).toBe("3");
    fireEvent.change(screen.getByRole("textbox", { name: "video-use 确认人" }), { target: { value: "张三" } });
    fireEvent.click(screen.getByRole("button", { name: "确认当前预览" }));
    await waitFor(() => expect(review).toHaveBeenCalledWith({ projectId: "project-1", chapterId: "chapter-1", revision: 3, reviewer: "张三" }));
    expect(await screen.findByText("已确认")).toBeTruthy();
    expect(screen.getByRole("region", { name: "video-use 用户确认" }).getAttribute("data-video-use-review-result")).toBe("accepted");
  });

  it("keeps the action disabled until a reviewer and project are present", () => {
    render(<VideoWorkflowReviewPanel chapterId="chapter-1" />);
    expect(screen.getByRole("button", { name: "确认当前预览" })).toHaveProperty("disabled", true);
  });

  it("locks confirmation to the current preview revision", () => {
    render(<VideoWorkflowReviewPanel projectId="project-1" chapterId="chapter-1" revision={7} />);
    expect(screen.getByLabelText("video-use revision").textContent).toBe("7");
    expect(screen.queryByRole("spinbutton", { name: "video-use revision" })).toBeNull();
  });

  it("applies HyperFrames and the EditingProject only after review succeeds", async () => {
    const review = vi.fn(async () => ({
      schemaVersion: 1 as const,
      success: true,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 2,
      status: "accepted" as const,
    }));
    const onAccepted = vi.fn(async () => undefined);
    Object.defineProperty(window, "videoWorkflowPlugins", { configurable: true, value: { review } });
    render(<VideoWorkflowReviewPanel projectId="project-1" chapterId="chapter-1" revision={2} onAccepted={onAccepted} />);
    fireEvent.change(screen.getByRole("textbox", { name: "video-use 确认人" }), { target: { value: "张三" } });
    fireEvent.click(screen.getByRole("button", { name: "确认当前预览" }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(review).toHaveBeenCalledWith({ projectId: "project-1", chapterId: "chapter-1", revision: 2, reviewer: "张三" });
  });
});
