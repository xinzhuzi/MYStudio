// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageWorkflowCanvas } from "./ImageWorkflowCanvas";
import { createAssetImageWorkflowGraph } from "@/lib/studio/image-workflow";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
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
const initialCharacterState = useCharacterLibraryStore.getState();

afterEach(() => {
  cleanup();
  useStudioStore.setState(initialStudioState, true);
  useProjectStore.setState(initialProjectState, true);
  useCharacterLibraryStore.setState(initialCharacterState, true);
  delete (window as any).studioAssets;
  delete (window as any).projectFiles;
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

    expect(screen.getByRole("button", { name: "返回" })).toBeTruthy();
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

  it("uses the linked prompt node as the only full prompt editor in scoped derived asset workflows", () => {
    const graph = createAssetImageWorkflowGraph(
      {
        target: {
          kind: "asset",
          assetType: "character",
          parentId: "char-parent",
          id: "char-derived",
        },
        title: "灰衫入镇态",
        prompt: "水墨国风角色衍生三视图设定图",
        sourceImagePath: "project-file://dao/assets/char-parent.png",
        resultImagePath: "project-file://dao/assets/char-derived.png",
        imageWorkflowId: "flow-char-derived",
        sourceStageLabel: "分镜视频生成",
        sourceLabel: "衍生资产 · 灰衫入镇态",
      },
      "道劫",
    );

    useProjectStore.setState({ activeProjectId: "dao-project" });
    useStudioStore.setState({
      ...initialStudioState,
      imageWorkflows: [graph],
      materials: [],
      storyboards: [],
      createImageWorkflow: vi.fn(() => "unused-global-flow"),
      upsertImageWorkflow: vi.fn(),
    }, true);

    const { container } = render(
      <ImageWorkflowCanvas
        projectName="道劫"
        onBack={vi.fn()}
        initialAssetContext={{
          target: {
            kind: "asset",
            assetType: "character",
            parentId: "char-parent",
            id: "char-derived",
          },
          title: "灰衫入镇态",
          prompt: "水墨国风角色衍生三视图设定图",
          sourceImagePath: "project-file://dao/assets/char-parent.png",
          resultImagePath: "project-file://dao/assets/char-derived.png",
          imageWorkflowId: "flow-char-derived",
          sourceStageLabel: "分镜视频生成",
          sourceLabel: "衍生资产 · 灰衫入镇态",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "返回" })).toBeTruthy();
    expect(screen.getByDisplayValue("水墨国风角色衍生三视图设定图")).toBeTruthy();
    expect(container.querySelector("[data-toonflow-generated-prompt-panel]")).toBeNull();
  });

  it("stores a scoped derived asset generated image in the asset library from the image workflow", async () => {
    const graph = createAssetImageWorkflowGraph(
      {
        target: {
          kind: "asset",
          assetType: "character",
          parentId: "char-parent",
          id: "char-derived",
        },
        title: "灰衫入镇态",
        prompt: "水墨国风角色衍生三视图设定图",
        sourceImagePath: "project-file://dao/assets/char-parent.png",
        resultImagePath: "project-file://dao/assets/char-derived.png",
        imageWorkflowId: "flow-char-derived",
        sourceStageLabel: "分镜视频生成",
        sourceLabel: "衍生资产 · 灰衫入镇态",
      },
      "道劫",
    );
    const getAbsolutePath = vi.fn(async () => "/tmp/char-derived.png");
    const addAsset = vi.fn(async (payload: { type: string; name: string }) => ({
      id: "asset-1",
      source: "manying-local",
      type: payload.type,
      name: payload.name,
      filePath: "role/asset-1.png",
    }));
    const getByName = vi.fn(async () => null);

    (window as any).projectFiles = { getAbsolutePath };
    (window as any).studioAssets = {
      add: addAsset,
      getByName,
    };
    useProjectStore.setState({ activeProjectId: "dao-project" });
    useCharacterLibraryStore.setState((state) => ({
      ...state,
      characters: [
        {
          id: "char-parent",
          name: "独孤剑尘",
          description: "灰衣剑修，入镇时收敛锋芒。",
          visualTraits: "宣纸淡彩工笔角色四视图",
          views: [],
          variations: [
            {
              id: "char-derived",
              name: "灰衫入镇态",
              visualPrompt: "灰衫入镇态四视图",
              visualPromptZh: "灰衫入镇态，四视图角色设定",
              referenceImage: "project-file://dao/assets/char-derived.png",
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }));
    useStudioStore.setState({
      ...initialStudioState,
      imageWorkflows: [graph],
      materials: [],
      storyboards: [],
      createImageWorkflow: vi.fn(() => "unused-global-flow"),
      upsertImageWorkflow: vi.fn(),
    }, true);

    render(
      <ImageWorkflowCanvas
        projectName="道劫"
        onBack={vi.fn()}
        initialAssetContext={{
          target: {
            kind: "asset",
            assetType: "character",
            parentId: "char-parent",
            id: "char-derived",
          },
          title: "灰衫入镇态",
          prompt: "水墨国风角色衍生三视图设定图",
          sourceImagePath: "project-file://dao/assets/char-parent.png",
          resultImagePath: "project-file://dao/assets/char-derived.png",
          imageWorkflowId: "flow-char-derived",
          sourceStageLabel: "分镜视频生成",
          sourceLabel: "衍生资产 · 灰衫入镇态",
        }}
      />,
    );

    const storeButton = await screen.findByRole("button", { name: "放入资产库" });
    await waitFor(() => expect((storeButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(storeButton);

    await waitFor(() => expect(addAsset).toHaveBeenCalledTimes(1));
    expect(getAbsolutePath).toHaveBeenCalledWith("project-file://dao/assets/char-derived.png");
    expect(getByName).toHaveBeenCalledWith({
      type: "role",
      name: "独孤剑尘 · 灰衫入镇态",
    });
    expect(addAsset).toHaveBeenCalledWith(expect.objectContaining({
      type: "role",
      name: "独孤剑尘 · 灰衫入镇态",
      sourceFilePath: "/tmp/char-derived.png",
      description: expect.stringContaining("灰衣剑修"),
      prompt: "灰衫入镇态，四视图角色设定",
    }));
  });
});
