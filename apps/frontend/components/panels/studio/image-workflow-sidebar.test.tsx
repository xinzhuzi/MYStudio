// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageWorkflowGraph, StoryboardItem, StudioMaterial } from "@/types/studio";
import { ImageWorkflowSidebar } from "./image-workflow-sidebar";

const graph = {
  id: "workflow-1",
  name: "主图工作流",
  target: { kind: "free" },
  nodes: [],
  edges: [],
  createdAt: 1,
  updatedAt: 1,
} as ImageWorkflowGraph;

const material = { id: "material-1", name: "角色参考", localPath: "local-image://material.png" } as StudioMaterial;
const storyboard = {
  id: "storyboard-1",
  index: 1,
  prompt: "雨夜街口",
  mediaRef: { kind: "image", path: "local-image://storyboard.png" },
} as StoryboardItem;

afterEach(cleanup);

describe("ImageWorkflowSidebar", () => {
  it("keeps binding and palette actions in the extracted boundary", () => {
    const onTargetStoryboardChange = vi.fn();
    const onBindTargetStoryboard = vi.fn();
    const onAddReferenceFromMaterial = vi.fn();
    const onAddReferenceFromStoryboard = vi.fn();

    render(
      <ImageWorkflowSidebar
        activeGraph={graph}
        projectName="道劫"
        isScopedWorkflowDetail={false}
        sourceLabel="当前图片工作流"
        workflowWritebackTargetLabel="未绑定目标"
        storyboards={[storyboard]}
        targetStoryboardId="storyboard-1"
        onTargetStoryboardChange={onTargetStoryboardChange}
        onBindTargetStoryboard={onBindTargetStoryboard}
        canUseGlobalWorkflowControls
        imageMaterials={[material]}
        storyboardImages={[storyboard]}
        onAddReferenceFromMaterial={onAddReferenceFromMaterial}
        onAddReferenceFromStoryboard={onAddReferenceFromStoryboard}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "storyboard-1" } });
    fireEvent.click(screen.getByRole("button", { name: "绑定当前图" }));
    fireEvent.click(screen.getByRole("button", { name: /角色参考/ }));
    fireEvent.click(screen.getByRole("button", { name: /分镜 1/ }));

    expect(onTargetStoryboardChange).toHaveBeenCalledWith("storyboard-1");
    expect(onBindTargetStoryboard).toHaveBeenCalledTimes(1);
    expect(onAddReferenceFromMaterial).toHaveBeenCalledWith(material);
    expect(onAddReferenceFromStoryboard).toHaveBeenCalledWith(storyboard);
  });

  it("hides global palette controls for scoped workflows", () => {
    const { container } = render(
      <ImageWorkflowSidebar
        activeGraph={{ ...graph, target: { kind: "asset", assetType: "scene", id: "scene-1" } }}
        projectName="道劫"
        isScopedWorkflowDetail
        sourceLabel="衍生资产"
        sourceStageLabel="分镜视频生成"
        workflowWritebackTargetLabel="场景衍生"
        storyboards={[]}
        targetStoryboardId=""
        onTargetStoryboardChange={vi.fn()}
        onBindTargetStoryboard={vi.fn()}
        canUseGlobalWorkflowControls={false}
        imageMaterials={[material]}
        storyboardImages={[storyboard]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
      />,
    );

    expect(screen.getByText("分镜视频生成 / 衍生资产")).toBeTruthy();
    expect(container.querySelector("[data-scoped-image-workflow-summary]")).toBeTruthy();
    expect(screen.queryByText("项目参考图")).toBeNull();
  });
});
