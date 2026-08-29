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
  it("keeps palette actions and drops the two-step rebind control", () => {
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
        canUseGlobalWorkflowControls
        imageMaterials={[material]}
        storyboardImages={[storyboard]}
        onAddReferenceFromMaterial={onAddReferenceFromMaterial}
        onAddReferenceFromStoryboard={onAddReferenceFromStoryboard}
      />,
    );

    // 改绑回写分镜+绑定按钮已删(2026-08-23 三次误用实证):全局分镜切换走「切换分镜工作流…」
    expect(screen.queryByRole("button", { name: "绑定当前图" })).toBeNull();
    expect((document.body.textContent || "").includes("改绑回写分镜")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /角色参考/ }));
    fireEvent.click(screen.getByRole("button", { name: /分镜 1/ }));

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

describe("storyboard switcher moved to toolbar (2026-08-30 merge)", () => {
  const scopedGraph = {
    id: "wf-1",
    name: "道劫 · 分镜 5 图片工作流",
    target: { kind: "storyboard" as const, id: "sb-5" },
    nodes: [],
    edges: [],
    createdAt: 0,
    updatedAt: 0,
  };

  it("renders no storyboard switcher in scoped view (merged into toolbar selector)", () => {
    render(
      <ImageWorkflowSidebar
        activeGraph={scopedGraph}
        projectName="道劫"
        initialAssetContext={{ target: { kind: "storyboard", id: "sb-5" }, title: "分镜 5" }}
        isScopedWorkflowDetail
        sourceLabel="分镜成图 · 分镜 5"
        workflowWritebackTargetLabel="分镜 5 · 矿奴队列"
        storyboards={[{ id: "sb-7", index: 7, prompt: "夜课灯下" } as never]}
        canUseGlobalWorkflowControls={false}
        imageMaterials={[]}
        storyboardImages={[]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
      />,
    );
    expect(container2ComboboxCount()).toBe(0);
    expect(document.querySelector("[data-scoped-storyboard-switcher]")).toBeNull();
    expect(document.querySelector("[data-storyboard-workflow-switcher]")).toBeNull();
  });

  it("renders no storyboard switcher in global view either", () => {
    render(
      <ImageWorkflowSidebar
        activeGraph={scopedGraph}
        projectName="道劫"
        isScopedWorkflowDetail={false}
        sourceLabel="分镜 5"
        workflowWritebackTargetLabel="分镜 5"
        storyboards={[{ id: "sb-7", index: 7, prompt: "夜课灯下" } as never]}
        canUseGlobalWorkflowControls
        imageMaterials={[]}
        storyboardImages={[]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
      />,
    );
    expect(container2ComboboxCount()).toBe(0);
    expect(document.querySelector("[data-storyboard-workflow-switcher]")).toBeNull();
  });

  function container2ComboboxCount(): number {
    return document.querySelectorAll("select").length;
  }
});

describe("reference palette completeness", () => {
  it("renders every material and storyboard image beyond the old 24 cap with counts", () => {
    const materials = Array.from({ length: 30 }, (_, i) => ({
      id: `m-${i}`, name: `素材${i}.png`, localPath: `p://m${i}.png`, kind: "image" as const,
    }));
    const storyboards = Array.from({ length: 39 }, (_, i) => ({
      id: `sb-${i}`, index: i + 1, prompt: `镜${i}`,
      mediaRef: { kind: "image" as const, path: `p://s${i}.png` },
    }));
    render(
      <ImageWorkflowSidebar
        activeGraph={{ id: "g", name: "G", target: { kind: "free" }, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as never}
        projectName="道劫"
        isScopedWorkflowDetail={false}
        sourceLabel="s"
        workflowWritebackTargetLabel="t"
        storyboards={storyboards as never}
        canUseGlobalWorkflowControls
        imageMaterials={materials as never}
        storyboardImages={storyboards as never}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
      />,
    );
    // T3 语义分组:无 gen-/up4x- 前缀的材料全归资产设定图
    expect(screen.getByText("资产设定图 · 30")).toBeTruthy();
    expect(screen.getByText("分镜成图 · 39")).toBeTruthy();
    // 第 25/39 号(旧截断线之外)也渲染
    expect(screen.getByText("素材24.png")).toBeTruthy();
    expect(screen.getByText("素材29.png")).toBeTruthy();
    expect(screen.getByText("分镜 39")).toBeTruthy();
  });

  it("splits palette materials into asset references vs workflow outputs (T3 分组)", () => {
    const genMaterial = { id: "m-gen", name: "成图A.png", localPath: "p://workflow-images/gen-abc-1.png", kind: "image" as const };
    const upMaterial = { id: "m-up", name: "超分B.png", localPath: "p://workflow-images/up4x-abc-2.png", kind: "image" as const };
    const refMaterial = { id: "m-ref", name: "设定C.png", localPath: "p://workflow-images/ref-abc-3.png", kind: "image" as const };
    render(
      <ImageWorkflowSidebar
        activeGraph={{ id: "g", name: "G", target: { kind: "free" }, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as never}
        projectName="道劫"
        isScopedWorkflowDetail={false}
        sourceLabel="s"
        workflowWritebackTargetLabel="t"
        storyboards={[]}
        canUseGlobalWorkflowControls
        imageMaterials={[genMaterial, upMaterial, refMaterial] as never}
        storyboardImages={[]}
        onAddReferenceFromMaterial={vi.fn()}
        onAddReferenceFromStoryboard={vi.fn()}
      />,
    );
    expect(screen.getByText("资产设定图 · 1")).toBeTruthy();
    expect(screen.getByText("工作流成图 · 2")).toBeTruthy();
    expect(screen.getByText("设定C.png")).toBeTruthy();
    expect(screen.getByText("成图A.png")).toBeTruthy();
  });
});
