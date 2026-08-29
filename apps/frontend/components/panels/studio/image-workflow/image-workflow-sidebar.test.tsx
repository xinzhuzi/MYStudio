// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
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
  videoDesc: "雨夜街口,灯下人影匆匆",
  mediaRef: { kind: "image", path: "local-image://storyboard.png" },
} as StoryboardItem;

const switcherBase = {
  scope: "library" as const,
  storyboards: [storyboard],
  imageWorkflows: [graph],
  chromeReady: true,
  onSelectStoryboard: vi.fn(),
  onSelectWorkflow: vi.fn(),
};

afterEach(cleanup);

describe("ImageWorkflowSidebar (08-30 切换器入驻+去小标题)", () => {
  it("顶部就是切换器;不再有 来源/回写目标/项目名 小标题", () => {
    render(
      <ImageWorkflowSidebar
        activeGraph={graph}
        canUseGlobalWorkflowControls
        imageMaterials={[material]}
        storyboardImages={[storyboard]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
        {...switcherBase}
      />,
    );
    expect(document.querySelector("[data-image-workflow-selector]")).toBeTruthy();
    expect(document.body.textContent).not.toContain("来源");
    expect(document.body.textContent).not.toContain("回写目标");
    expect(document.body.textContent).not.toContain("道劫");
  });

  it("分镜域切换器在侧栏可用并分派切镜链", () => {
    const onSelectStoryboard = vi.fn();
    render(
      <ImageWorkflowSidebar
        activeGraph={{ ...graph, target: { kind: "storyboard", id: "storyboard-1" } } as ImageWorkflowGraph}
        canUseGlobalWorkflowControls={false}
        imageMaterials={[]}
        storyboardImages={[]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
        {...switcherBase}
        scope="storyboard"
        onSelectStoryboard={onSelectStoryboard}
      />,
    );
    const select = document.querySelector("[data-image-workflow-selector]") as HTMLSelectElement;
    expect(select.value).toBe("sb:storyboard-1");
    // 单条分镜选自身不动作;切换分镜走链
    fireEvent.change(select, { target: { value: "sb:storyboard-1" } });
    expect(onSelectStoryboard).not.toHaveBeenCalled();
  });

  it("分镜域显示当前分镜的背景故事(纯文本无标题);library 域不显示", () => {
    const first = render(
      <ImageWorkflowSidebar
        activeGraph={{ ...graph, target: { kind: "storyboard", id: "storyboard-1" } } as ImageWorkflowGraph}
        canUseGlobalWorkflowControls={false}
        imageMaterials={[]}
        storyboardImages={[]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
        {...switcherBase}
        scope="storyboard"
      />,
    );
    expect(document.body.textContent).toContain("雨夜街口");
    first.unmount();

    render(
      <ImageWorkflowSidebar
        activeGraph={graph}
        canUseGlobalWorkflowControls
        imageMaterials={[]}
        storyboardImages={[]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
        {...switcherBase}
      />,
    );
    expect(document.body.textContent).not.toContain("雨夜街口");
  });

  it("keeps palette actions with counts", () => {
    const onAddReferenceFromMaterial = vi.fn();
    const onAddReferenceFromStoryboard = vi.fn();
    render(
      <ImageWorkflowSidebar
        activeGraph={graph}
        canUseGlobalWorkflowControls
        imageMaterials={[material]}
        storyboardImages={[storyboard]}
        onAddReferenceFromMaterial={onAddReferenceFromMaterial}
        onAddReferenceFromStoryboard={onAddReferenceFromStoryboard}
        {...switcherBase}
      />,
    );
    expect(document.querySelector("[data-image-workflow-reference-palette]")).toBeTruthy();
    const paletteButton = Array.from(
      document.querySelectorAll("[data-image-workflow-reference-palette] button"),
    ).find((button) => button.textContent?.includes("角色参考")) as HTMLElement;
    fireEvent.click(paletteButton);
    expect(onAddReferenceFromMaterial).toHaveBeenCalledWith(material);
  });

  it("scoped 分镜域不带参考面板", () => {
    render(
      <ImageWorkflowSidebar
        activeGraph={{ ...graph, target: { kind: "storyboard", id: "storyboard-1" } } as ImageWorkflowGraph}
        canUseGlobalWorkflowControls={false}
        imageMaterials={[material]}
        storyboardImages={[storyboard]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
        {...switcherBase}
        scope="storyboard"
      />,
    );
    expect(document.querySelector("[data-image-workflow-reference-palette]")).toBeNull();
  });
});
