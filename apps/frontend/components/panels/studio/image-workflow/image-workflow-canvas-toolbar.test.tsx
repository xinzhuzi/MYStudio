// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageWorkflowGraph } from "@/types/studio";
import { ImageWorkflowCanvasToolbar } from "./image-workflow-canvas-toolbar";

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
      canUseGlobalWorkflowControls
      onTidyLayout={vi.fn()}
      onCreateNewFlow={vi.fn()}
      onUploadReferenceClick={vi.fn()}
      onAddGeneratedNode={vi.fn()}
      onAddStoryboardLayeredPair={vi.fn()}
      workflowWritebackTargetLabel="分镜 1"
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

describe("toolbar after switcher moved to sidebar (08-30)", () => {
  it("collapses style trace chips behind a trigger and hides low-frequency actions in 更多 (08-30 精简)", () => {
    const { unmount } = renderToolbar({ styleTraceChips: ["视觉手册 daojie", "阵营配色 人族", "负面约束(五类)"] });
    expect(screen.getByRole("button", { name: /风格依据 3 项/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "更多操作" })).toBeTruthy();
    // 独立按钮已收进菜单:一级栏不再有 写回目标/批量超分/分层节点对/适配画布
    expect(screen.queryByRole("button", { name: "写回目标" })).toBeNull();
    expect(screen.queryByRole("button", { name: /批量超分/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /分层节点对/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "适配画布" })).toBeNull();
    // 08-30 用户裁定:运行生成从工具条移除,用户直接在节点卡上点生成
    expect(screen.queryByRole("button", { name: "运行生成" })).toBeNull();
    unmount();
  });
});
