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

describe("scoped storyboard switcher", () => {
  const scopedGraph = {
    id: "wf-1",
    name: "道劫 · 分镜 5 图片工作流",
    target: { kind: "storyboard" as const, id: "sb-5" },
    nodes: [],
    edges: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const scopedContext = {
    target: { kind: "storyboard" as const, id: "sb-5" },
    title: "分镜 5",
  };
  const storyboards = [
    { id: "sb-5", index: 5, prompt: "矿奴队列", videoDesc: "矿奴队列", lines: "赵四：快些！" },
    { id: "sb-7", index: 7, prompt: "夜课灯下", videoDesc: "夜课灯下", lines: "旁白：灯亮。" },
  ] as never[];

  function renderScoped(onSwitch: ReturnType<typeof vi.fn>) {
    return render(
      <ImageWorkflowSidebar
        activeGraph={scopedGraph}
        projectName="道劫"
        initialAssetContext={scopedContext}
        isScopedWorkflowDetail
        sourceLabel="分镜成图 · 分镜 5"
        workflowWritebackTargetLabel="分镜 5 · 矿奴队列"
        storyboards={storyboards}
        targetStoryboardId=""
        onTargetStoryboardChange={vi.fn()}
        onBindTargetStoryboard={vi.fn()}
        canUseGlobalWorkflowControls={false}
        imageMaterials={[]}
        storyboardImages={[]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
        onSwitchScopedStoryboard={onSwitch}
      />,
    );
  }

  it("switches to another storyboard immediately from the scoped sidebar", () => {
    const onSwitch = vi.fn();
    renderScoped(onSwitch);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "sb-7" } });
    expect(onSwitch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sb-7", index: 7 }),
    );
  });

  it("does not re-open the same storyboard or render the switcher without a handler", () => {
    const onSwitch = vi.fn();
    const view = renderScoped(onSwitch);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sb-5" } });
    expect(onSwitch).not.toHaveBeenCalled();
    view.rerender(
      <ImageWorkflowSidebar
        activeGraph={scopedGraph}
        projectName="道劫"
        isScopedWorkflowDetail
        sourceLabel="分镜成图 · 分镜 5"
        workflowWritebackTargetLabel="分镜 5"
        storyboards={storyboards}
        targetStoryboardId=""
        onTargetStoryboardChange={vi.fn()}
        onBindTargetStoryboard={vi.fn()}
        canUseGlobalWorkflowControls={false}
        imageMaterials={[]}
        storyboardImages={[]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("global-mode storyboard workflow switcher", () => {
  const globalGraph = {
    id: "wf-global",
    name: "道劫 · 分镜 5 图片工作流",
    target: { kind: "storyboard" as const, id: "sb-5" },
    nodes: [],
    edges: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const storyboards = [
    { id: "sb-5", index: 5, prompt: "矿奴队列" },
    { id: "sb-7", index: 7, prompt: "夜课灯下" },
  ] as never[];

  it("opens another storyboard workflow immediately from the global sidebar", () => {
    const onSwitch = vi.fn();
    render(
      <ImageWorkflowSidebar
        activeGraph={globalGraph}
        projectName="道劫"
        isScopedWorkflowDetail={false}
        sourceLabel="分镜 5"
        workflowWritebackTargetLabel="分镜 5"
        storyboards={storyboards}
        targetStoryboardId=""
        onTargetStoryboardChange={vi.fn()}
        onBindTargetStoryboard={vi.fn()}
        canUseGlobalWorkflowControls
        imageMaterials={[]}
        storyboardImages={[]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
        onSwitchScopedStoryboard={onSwitch}
      />,
    );
    const switcher = document.querySelector("[data-storyboard-workflow-switcher]") as HTMLSelectElement;
    expect(switcher).toBeTruthy();
    fireEvent.change(switcher, { target: { value: "sb-7" } });
    expect(onSwitch).toHaveBeenCalledWith(expect.objectContaining({ id: "sb-7" }));
  });
});
