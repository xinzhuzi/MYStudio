// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";
import { ImageWorkflowCanvasToolbar } from "./image-workflow-canvas-toolbar";

const storyboards = [
  { id: "sb-1", index: 1, prompt: "矿奴队列", videoDesc: "矿奴队列", episodeId: "ep-1" },
  { id: "sb-2", index: 2, prompt: "夜课灯下", videoDesc: "夜课灯下", episodeId: "ep-1" },
] as never[] as StoryboardItem[];

const flows = [
  { id: "wf-sb1", name: "道劫 · 分镜 1 图片工作流", target: { kind: "storyboard", id: "sb-1" }, nodes: [], edges: [], createdAt: 0, updatedAt: 0 },
  { id: "wf-free", name: "自由生图流", target: { kind: "free" }, nodes: [], edges: [], createdAt: 0, updatedAt: 0 },
  { id: "wf-asset", name: "资产流", target: { kind: "asset", assetType: "scene", id: "scene-1" }, nodes: [], edges: [], createdAt: 0, updatedAt: 0 },
] as unknown[] as ImageWorkflowGraph[];

function renderToolbar(overrides: Partial<Parameters<typeof ImageWorkflowCanvasToolbar>[0]> = {}) {
  // 默认 storyboards 为空 ⇒ storyboard 域只剩兜底项;用例按需覆写 scope/storyboards
  return render(
    <ImageWorkflowCanvasToolbar
      activeGraph={flows[0]}
      chromeReady
      styleTraceChips={[]}
      scope="library"
      canUseGlobalWorkflowControls
      imageWorkflows={flows}
      storyboards={storyboards}
      onSelectStoryboard={vi.fn()}
      onSelectorChange={vi.fn()}
      onCreateNewFlow={vi.fn()}
      onUploadReferenceClick={vi.fn()}
      onAddGeneratedNode={vi.fn()}
      onAddStoryboardLayeredPair={vi.fn()}
      workflowWritebackTargetLabel="分镜 1"
      selectedGenerationBusy={false}
      onGenerate={vi.fn()}
      onApplyToStoryboard={vi.fn()}
      upscalableCount={0}
      upscaleRunning={false}
      onOpenBatchUpscale={vi.fn()}
      onStoreInAssetLibrary={vi.fn()}
      showStoreInAssetLibrary={false}
      selectedEdgeId={null}
      onDeleteSelectedEdge={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("scope-isolated workflow switcher (2026-08-30 强隔离裁定)", () => {
  it("library 域只列资产/自由工作流,不列分镜组,分镜流不按 id 出现", () => {
    renderToolbar({ scope: "library", activeGraph: flows[1] });
    const select = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toContain("wf-free");
    expect(values).toContain("wf-asset");
    expect(values).not.toContain("sb:sb-1");
    expect(values).not.toContain("wf-sb1");
    expect(Array.from(select.querySelectorAll("optgroup")).map((group) => group.label)).toEqual(["资产工作流", "自由工作流"]);
  });

  it("storyboard 域只列本章分镜,不列资产/自由组", () => {
    renderToolbar({ scope: "storyboard", activeGraph: flows[0] });
    const select = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toContain("sb:sb-1");
    expect(values).toContain("sb:sb-2");
    expect(values).not.toContain("wf-free");
    expect(values).not.toContain("wf-asset");
    expect(Array.from(select.querySelectorAll("optgroup")).map((group) => group.label)).toEqual(["本章分镜"]);
  });

  it("分镜域选中分镜项,library 域选中流 id;分派各走各链", () => {
    const onSelectStoryboard = vi.fn();
    const onSelectorChange = vi.fn();
    const first = renderToolbar({ scope: "storyboard", activeGraph: flows[0], onSelectStoryboard, onSelectorChange });
    const scopedSelect = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    expect(scopedSelect.value).toBe("sb:sb-1");
    fireEvent.change(scopedSelect, { target: { value: "sb:sb-2" } });
    expect(onSelectStoryboard).toHaveBeenCalledWith(expect.objectContaining({ id: "sb-2" }));
    expect(onSelectorChange).not.toHaveBeenCalled();
    first.unmount();

    renderToolbar({ scope: "library", activeGraph: flows[1], onSelectStoryboard, onSelectorChange });
    const librarySelect = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    expect(librarySelect.value).toBe("wf-free");
    fireEvent.change(librarySelect, { target: { value: "wf-asset" } });
    expect(onSelectorChange).toHaveBeenCalledWith("wf-asset");
  });

  it("collapses style trace chips behind a trigger and hides low-frequency actions in 更多 (08-30 精简)", () => {
    const { unmount } = renderToolbar({ styleTraceChips: ["视觉手册 daojie", "阵营配色 人族", "负面约束(五类)"] });
    expect(screen.getByRole("button", { name: /风格依据 3 项/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "更多操作" })).toBeTruthy();
    // 独立按钮已收进菜单:一级栏不再有 写回目标/批量超分/分层节点对/适配画布
    expect(screen.queryByRole("button", { name: "写回目标" })).toBeNull();
    expect(screen.queryByRole("button", { name: /批量超分/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /分层节点对/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "适配画布" })).toBeNull();
    // 运行生成主按钮保留
    expect(screen.getByRole("button", { name: "运行生成" })).toBeTruthy();
    unmount();
  });

  it("renders in scoped mode too and falls back to a labelled option for cross-chapter storyboard flows", () => {
    renderToolbar({
      scope: "storyboard",
      canUseGlobalWorkflowControls: false,
      activeGraph: { ...flows[0], id: "wf-other-chapter", target: { kind: "storyboard", id: "sb-x" } } as ImageWorkflowGraph,
    });
    const select = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("sb:sb-x");
    const fallback = Array.from(select.options).find((option) => option.value === "sb:sb-x");
    expect(fallback?.textContent).toContain("其他章节");
  });
});
