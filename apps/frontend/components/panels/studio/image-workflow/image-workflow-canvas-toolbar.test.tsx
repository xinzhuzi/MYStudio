// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
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
  return render(
    <ImageWorkflowCanvasToolbar
      sourceLabel="分镜成图 · 分镜 1"
      activeGraph={flows[0]}
      chromeReady
      styleTraceChips={[]}
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
      onFitView={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("merged storyboard/workflow switcher (2026-08-30)", () => {
  it("lists chapter storyboards and non-storyboard workflows; storyboard flows are not listed by id", () => {
    renderToolbar();
    const select = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    expect(select).toBeTruthy();
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toContain("sb:sb-1");
    expect(values).toContain("sb:sb-2");
    expect(values).toContain("wf-free");
    expect(values).toContain("wf-asset");
    // storyboard 目标的流不再按流 id 出现(经分镜入口即达)
    expect(values).not.toContain("wf-sb1");
    // 无「上一代遗留」分组
    expect(Array.from(select.querySelectorAll("optgroup")).map((group) => group.label)).toEqual(["本章分镜", "资产工作流", "自由工作流"]);
  });

  it("shows the storyboard entry as selected when the active graph targets a storyboard", () => {
    renderToolbar();
    const select = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    expect(select.value).toBe("sb:sb-1");
  });

  it("dispatches onSelectStoryboard for storyboard entries and onSelectorChange for others", () => {
    const onSelectStoryboard = vi.fn();
    const onSelectorChange = vi.fn();
    renderToolbar({ onSelectStoryboard, onSelectorChange });
    const select = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "sb:sb-2" } });
    expect(onSelectStoryboard).toHaveBeenCalledWith(expect.objectContaining({ id: "sb-2" }));
    expect(onSelectorChange).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "wf-free" } });
    expect(onSelectorChange).toHaveBeenCalledWith("wf-free");
  });

  it("renders in scoped mode too and falls back to a labelled option for cross-chapter storyboard flows", () => {
    renderToolbar({
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
