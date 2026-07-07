// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { polishAssetPrompt } from "@/lib/ai/prompt-polisher";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { useProjectStore } from "@/stores/project-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useStudioStore } from "@/stores/studio-store";
import {
  applyMatchedAssets,
  generateAsset,
  type AssetGenerationProgress,
} from "./asset-generation-orchestrator";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    image: vi.fn().mockResolvedValue({ imageUrl: "https://example.com/prop.png" }),
  },
}));

vi.mock("@/lib/ai/prompt-polisher", () => ({
  polishAssetPrompt: vi.fn().mockResolvedValue({
    status: "success",
    prompt: "polished prop prompt",
    negativePrompt: "avoid modern plastic",
  }),
}));

vi.mock("@/lib/image-storage", () => ({
  saveImageToLocal: vi
    .fn()
    .mockResolvedValue("local-image://props/prop-1.png"),
}));

beforeEach(() => {
  vi.clearAllMocks();
  delete (window as any).projectFiles;
  useStudioStore.getState().resetStudioWorkflow();
  useProjectStore.setState({
    activeProjectId: "dao-project",
    activeProject: {
      id: "dao-project",
      name: "道劫",
      createdAt: 1,
      updatedAt: 1,
    },
  });
  vi.mocked(aiManager.image).mockResolvedValue({ imageUrl: "https://example.com/prop.png" });
  (usePropsLibraryStore as any).persist?.setOptions({
    storage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
  usePropsLibraryStore.setState({
    items: [
      {
        id: "prop-1",
        name: "断剑",
        description: "一柄断裂的古剑",
        imageUrl: "",
        folderId: null,
        createdAt: 1,
      },
    ],
    folders: [],
    selectedFolderId: "all",
  });
  useCharacterLibraryStore.setState({
    characters: [
      {
        id: "char-1",
        name: "独孤剑尘",
        description: "白衣剑修",
        visualTraits: "",
        views: [],
        variations: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    folders: [],
    currentFolderId: null,
  });
  useSceneStore.setState({
    scenes: [
      {
        id: "scene-1",
        name: "矿场",
        location: "山谷",
        time: "夜",
        atmosphere: "冷雨",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    folders: [],
    currentFolderId: null,
  });
  useAppSettingsStore.getState().setImageGenerationSettings({
    defaultAspectRatio: "16:9",
    defaultResolution: "2K",
    compatibilityRetryEnabled: true,
    compatibilityRetryAspectRatio: "1:1",
    compatibilityRetryResolution: "1K",
  });
});

describe("asset-generation-orchestrator", () => {
  it("writes generated prop prompt and image back to the props store", async () => {
    const result = await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: false,
      visualManualId: "ink",
    });

    expect(result.phase).toBe("done");
    const prop = usePropsLibraryStore
      .getState()
      .items.find((item) => item.id === "prop-1");
    expect(prop?.visualPrompt).toBe("polished prop prompt");
    expect(prop?.promptState).toBe("ready");
    expect(prop?.imageUrl).toBe("local-image://props/prop-1.png");
  });

  it("saves generated workflow assets inside the active project when projectId is provided", async () => {
    usePropsLibraryStore.setState({
      items: [
        {
          id: "prop-parent",
          name: "断剑",
          description: "一柄断裂的古剑",
          imageUrl: "project-file://dao-project/workflow-images/assets/prop-parent.png",
          folderId: null,
          projectId: "dao-project",
          createdAt: 1,
        },
        {
          id: "prop-1",
          name: "断剑",
          category: "雨夜湿剑",
          description: "雨夜状态",
          imageUrl: "",
          folderId: null,
          parentId: "prop-parent",
          isDerivative: true,
          projectId: "dao-project",
          createdAt: 2,
        },
      ],
      folders: [],
      selectedFolderId: "all",
    });
    (window as any).projectFiles = {
      saveImage: vi.fn().mockResolvedValue({
        success: true,
        url: "project-file://dao-project/workflow-images/assets/prop-1.png",
        size: 1234,
      }),
    };

    const result = await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      projectId: "dao-project",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: true,
      visualManualId: "ink",
      referenceImages: ["project-file://dao-project/workflow-images/assets/prop-parent.png"],
      imageWorkflowId: "flow-existing-prop-derivative",
    });

    expect(result.phase).toBe("done");
    expect(aiManager.image).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: ["project-file://dao-project/workflow-images/assets/prop-parent.png"],
      }),
      "prop",
    );
    expect(window.projectFiles?.saveImage).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "dao-project",
      relativePath: expect.stringMatching(/^workflow-images\/assets\/prop\/prop-1-/),
      source: "https://example.com/prop.png",
    }));
    const prop = usePropsLibraryStore.getState().getPropById("prop-1");
    expect(prop?.imageUrl).toBe("project-file://dao-project/workflow-images/assets/prop-1.png");
    expect(prop?.imageWorkflowId).toBe("flow-existing-prop-derivative");
    expect(prop?.imageWorkflowNodeId).toBeTruthy();
    const graph = useStudioStore
      .getState()
      .imageWorkflows.find((item) => item.id === prop?.imageWorkflowId);
    expect(graph).toMatchObject({
      name: expect.stringContaining("道劫"),
      target: {
        kind: "asset",
        assetType: "prop",
        parentId: "prop-parent",
        id: "prop-1",
      },
    });
    expect(graph?.id).toBe("flow-existing-prop-derivative");
    expect(graph?.nodes.some((node) => node.type === "reference")).toBe(true);
    expect(graph?.nodes.some((node) => node.type === "generated")).toBe(true);
  });

  it("does not save derivative workflow assets to the global local-image library without projectId", async () => {
    const result = await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: true,
      visualManualId: "ink",
    });

    expect(result).toMatchObject({
      phase: "failed",
      error: "衍生资产图片必须保存到当前项目",
    });
    const prop = usePropsLibraryStore.getState().getPropById("prop-1");
    expect(prop?.imageUrl).toBe("");
  });

  it("reuses asset-library file URLs without rewriting them as local media paths", () => {
    const characterUrl = "file:///tmp/mystudio-assets/role/char.png";
    const sceneUrl = "file:///tmp/mystudio-assets/scene/mine.png";
    const propUrl = "file:///tmp/mystudio-assets/tool/sword.png";

    expect(applyMatchedAssets("character", [
      {
        id: "char-1",
        name: "独孤剑尘",
        assetDbData: { filePath: "role/char.png", thumbnailUrl: characterUrl },
      },
    ])).toBe(1);
    expect(applyMatchedAssets("scene", [
      {
        id: "scene-1",
        name: "矿场",
        assetDbData: { filePath: "scene/mine.png", thumbnailUrl: sceneUrl },
      },
    ])).toBe(1);
    expect(applyMatchedAssets("prop", [
      {
        id: "prop-1",
        name: "断剑",
        assetDbData: { filePath: "tool/sword.png", thumbnailUrl: propUrl },
      },
    ])).toBe(1);

    expect(useCharacterLibraryStore.getState().characters[0].thumbnailUrl).toBe(characterUrl);
    expect(useCharacterLibraryStore.getState().characters[0].views[0]?.imageUrl).toBe(characterUrl);
    expect(useSceneStore.getState().scenes[0].referenceImage).toBe(sceneUrl);
    expect(usePropsLibraryStore.getState().getPropById("prop-1")?.imageUrl).toBe(propUrl);
  });

  it("returns the polished prompt when image generation fails", async () => {
    vi.mocked(aiManager.image).mockRejectedValueOnce(new Error("Failed to fetch"));
    const progress: AssetGenerationProgress[] = [];

    const result = await generateAsset(
      {
        assetId: "prop-1",
        assetType: "prop",
        name: "断剑",
        description: "一柄断裂的古剑",
        isDerivative: false,
        visualManualId: "ink",
      },
      (item) => progress.push(item),
    );

    expect(result.phase).toBe("failed");
    expect(result.error).toBe("Failed to fetch");
    expect(result.polishResult?.prompt).toBe("polished prop prompt");
    expect(progress).toContainEqual(expect.objectContaining({
      phase: "generating",
      polishResult: expect.objectContaining({ prompt: "polished prop prompt" }),
    }));
  });

  it("uses the existing prompt directly when image generation skips polishing", async () => {
    const progress: AssetGenerationProgress[] = [];

    const result = await generateAsset(
      {
        assetId: "prop-1",
        assetType: "prop",
        name: "断剑",
        description: "一柄断裂的古剑",
        isDerivative: false,
        visualManualId: "ink",
        skipPolish: true,
        existingPrompt: "existing prop image prompt",
      },
      (item) => progress.push(item),
    );

    expect(result.phase).toBe("done");
    expect(polishAssetPrompt).not.toHaveBeenCalled();
    expect(aiManager.image).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "existing prop image prompt" }),
      "prop",
    );
    expect(progress.some((item) => item.phase === "polishing")).toBe(false);
  });

  it("uses global image size settings when an asset task omits size options", async () => {
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "3:2",
      defaultResolution: "2K",
    });

    await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: false,
      visualManualId: "ink",
    });

    expect(aiManager.image).toHaveBeenCalledWith(
      expect.objectContaining({
        aspectRatio: "3:2",
        resolution: "2K",
      }),
      "prop",
    );
  });
});
