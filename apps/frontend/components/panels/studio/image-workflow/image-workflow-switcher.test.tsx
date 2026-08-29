// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";
import { ImageWorkflowSwitcher } from "./image-workflow-switcher";

const storyboards = [
  { id: "sb-1", index: 1, prompt: "老苦力拖筐", videoDesc: "老苦力拖筐", episodeId: "ep-1" },
  { id: "sb-2", index: 2, prompt: "夜课灯下", videoDesc: "夜课灯下", episodeId: "ep-1" },
] as never[] as StoryboardItem[];

const flows = [
  { id: "wf-sb1", name: "道劫 · 分镜 1 图片工作流", target: { kind: "storyboard", id: "sb-1" }, nodes: [], edges: [], createdAt: 0, updatedAt: 0 },
  { id: "wf-free", name: "自由生图流", target: { kind: "free" }, nodes: [], edges: [], createdAt: 0, updatedAt: 0 },
  { id: "wf-asset", name: "资产流", target: { kind: "asset", assetType: "scene", id: "scene-1" }, nodes: [], edges: [], createdAt: 0, updatedAt: 0 },
] as unknown[] as ImageWorkflowGraph[];

function renderSwitcher(overrides: Partial<Parameters<typeof ImageWorkflowSwitcher>[0]> = {}) {
  return render(
    <ImageWorkflowSwitcher
      scope="storyboard"
      activeGraph={flows[0]}
      storyboards={storyboards}
      imageWorkflows={flows}
      chromeReady
      onSelectStoryboard={vi.fn()}
      onSelectWorkflow={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("scope-isolated switcher in sidebar (08-30 入驻侧栏+纯序号标签)", () => {
  it("分镜域:选项只有「分镜 N」纯序号,无描述尾巴;不含资产/自由流", () => {
    renderSwitcher();
    const select = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    const texts = Array.from(select.options).map((option) => option.textContent);
    expect(texts).toEqual(["分镜 1", "分镜 2"]);
    expect(Array.from(select.querySelectorAll("optgroup")).map((g) => g.label)).toEqual(["本章分镜"]);
  });

  it("library 域:只列资产/自由流,不列分镜组", () => {
    renderSwitcher({ scope: "library", activeGraph: flows[1] });
    const select = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toContain("wf-free");
    expect(values).toContain("wf-asset");
    expect(values).not.toContain("sb:sb-1");
  });

  it("两域分派各走各链;跨章分镜流兜底项保留", () => {
    const onSelectStoryboard = vi.fn();
    const onSelectWorkflow = vi.fn();
    const first = renderSwitcher({ onSelectStoryboard, onSelectWorkflow });
    const scopedSelect = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    expect(scopedSelect.value).toBe("sb:sb-1");
    fireEvent.change(scopedSelect, { target: { value: "sb:sb-2" } });
    expect(onSelectStoryboard).toHaveBeenCalledWith(expect.objectContaining({ id: "sb-2" }));
    first.unmount();

    renderSwitcher({ scope: "library", activeGraph: flows[1], onSelectStoryboard, onSelectWorkflow });
    const librarySelect = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    fireEvent.change(librarySelect, { target: { value: "wf-asset" } });
    expect(onSelectWorkflow).toHaveBeenCalledWith("wf-asset");
    cleanup();

    const third = renderSwitcher({
      activeGraph: { ...flows[0], id: "wf-x", target: { kind: "storyboard", id: "sb-x" } } as ImageWorkflowGraph,
    });
    const fallbackSelect = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    expect(fallbackSelect.value).toBe("sb:sb-x");
    expect(Array.from(fallbackSelect.options).find((o) => o.value === "sb:sb-x")?.textContent).toContain("其他章节");
    third.unmount();
  });
});
