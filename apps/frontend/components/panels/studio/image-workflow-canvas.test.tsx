// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageWorkflowCanvas } from "./ImageWorkflowCanvas";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";

(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

(globalThis as any).matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

const initialStudioState = useStudioStore.getState();
const initialProjectState = useProjectStore.getState();

afterEach(() => {
  cleanup();
  useStudioStore.setState(initialStudioState, true);
  useProjectStore.setState(initialProjectState, true);
});

describe("ImageWorkflowCanvas", () => {
  it("keeps scoped drill-down chrome visible while the opened graph is being created", () => {
    const onBack = vi.fn();

    useProjectStore.setState({ activeProjectId: "dao-project" });
    useStudioStore.setState({
      ...initialStudioState,
      imageWorkflows: [],
      materials: [],
      storyboards: [],
      createImageWorkflow: vi.fn(() => "unused-global-flow"),
      upsertImageWorkflow: vi.fn(),
    }, true);

    const { container } = render(
      <ImageWorkflowCanvas
        projectName="道劫"
        onBack={onBack}
        initialAssetContext={{
          target: {
            kind: "asset",
            assetType: "scene",
            parentId: "scene-parent",
            id: "scene-night",
          },
          title: "雨夜版",
          prompt: "水墨国风雨夜街口",
          sourceImagePath: "project-file://dao/assets/source.png",
          resultImagePath: "project-file://dao/assets/night.png",
          imageWorkflowId: "missing-flow",
          sourceStage: "storyboard",
          sourceStageLabel: "分镜视频生成",
          sourceLabel: "衍生资产 · 雨夜版",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /返回工作流/ })).toBeTruthy();
    expect(screen.getByText("正在打开当前图片工作流")).toBeTruthy();
    expect(screen.getAllByText("来源").length).toBeGreaterThan(0);
    expect(screen.getAllByText("回写目标").length).toBeGreaterThan(0);
    expect(screen.getAllByText("分镜视频生成 / 衍生资产 · 雨夜版").length).toBeGreaterThan(0);
    expect(screen.getAllByText("场景衍生 · 雨夜版").length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "运行生成" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "写回目标" }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector("[data-scoped-image-workflow-summary]")).toBeTruthy();
    expect(container.querySelector("[data-image-workflow-selector]")).toBeNull();
    expect(container.querySelector("[data-image-workflow-global-action]")).toBeNull();
    expect(screen.queryByText("新建图像工作流")).toBeNull();
  });
});
