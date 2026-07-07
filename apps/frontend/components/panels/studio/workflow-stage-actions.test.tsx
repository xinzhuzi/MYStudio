// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AssetsTab } from "./AssetsTab";
import { ScriptAssetManagementTab } from "./ScriptAssetManagementTab";
import { ScriptAssetGenerationTab } from "./ScriptAssetGenerationTab";
import { WorkbenchTab } from "./WorkbenchTab";
import { collectDerivedAssetGenerationTasks, useProductionPlanningActions } from "./useProductionPlanningActions";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useTtsStore } from "@/stores/tts-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { useFreedomStore } from "@/stores/freedom-store";
import {
  formatScriptPlanContext,
  resolveProductionEpisodeId,
  resolveScriptPlanEpisodeId,
  resolveScriptTextForEpisode,
} from "./workflow-helpers";

const assetOrchestratorMocks = vi.hoisted(() => ({
  generateAsset: vi.fn(),
}));

const aiManagerMocks = vi.hoisted(() => ({
  freedomImage: vi.fn(),
}));

vi.mock("@/lib/studio/asset-generation-orchestrator", () => ({
  generateAsset: assetOrchestratorMocks.generateAsset,
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    freedomImage: aiManagerMocks.freedomImage,
    text: vi.fn(),
  },
}));

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as any).studioAssets;
  delete (window as any).imageStorage;
  delete (window as any).projectFiles;
});

describe("workflow stage action surfaces", () => {
  it("resolves production steps to the chapter-scoped script instead of a stale default episode", () => {
    const store = {
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          episodeId: "chapter-1",
          data: "第一章剧本",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "work-2",
          key: "scriptDraft",
          episodeId: "chapter-2",
          data: "第二章剧本",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      novelChapters: [
        {
          id: "chapter-1",
          index: 1,
          title: "第一章",
          sourceText: "第一章正文",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "chapter-2",
          index: 2,
          title: "第二章",
          sourceText: "第二章正文",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      scriptPlans: [{ id: "plan-1", episodeId: "chapter-1" }],
    } as unknown as ReturnType<
      typeof import("@/stores/studio-store").useStudioStore.getState
    >;

    expect(resolveProductionEpisodeId(store)).toBe("chapter-2");
    expect(resolveScriptTextForEpisode(store, "chapter-2")).toBe("第二章剧本");
    expect(resolveScriptPlanEpisodeId(store)).toBe("chapter-1");
  });

  it("keeps scene intents and derived assets in the director plan context", () => {
    const context = formatScriptPlanContext({
      id: "plan-1",
      episodeId: "chapter-1",
      theme: "夜访道口镇",
      visualStyle: "水墨暗夜",
      narrativeRhythm: "缓慢压迫",
      sceneIntents: [
        {
          sceneId: "Sc1",
          emotion: "压迫→隐忍",
          shotIntent: "低机位推进独孤剑尘入场",
          spatial: "道口镇街巷纵深",
        },
      ],
      soundDirection: "低频雨声",
      transitions: "雨声转场",
      derivedAssetPlan: [
        {
          parentAssetId: "c1",
          state: "雨夜湿衣",
          reason: "夜访道口镇多镜复用",
        },
      ],
    });

    expect(context).toContain("低机位推进独孤剑尘入场");
    expect(context).toContain("雨夜湿衣");
  });

  it("passes parent asset images and existing flow ids into derivative generation tasks", () => {
    useCharacterLibraryStore.setState({
      characters: [
        {
          id: "char-parent",
          name: "独孤剑尘",
          description: "父角色",
          visualTraits: "",
          thumbnailUrl: "project-file://dao/workflow-images/assets/char-parent.png",
          views: [
            {
              viewType: "front",
              imageUrl: "project-file://dao/workflow-images/assets/char-parent-front.png",
              generatedAt: 1,
            },
          ],
          variations: [
            {
              id: "char-derived",
              name: "雨夜湿衣",
              visualPrompt: "雨夜湿衣提示词",
              imageWorkflowId: "flow-char-derived",
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      folders: [],
      currentFolderId: null,
      selectedCharacterId: null,
      generationStatus: "idle",
      generationError: null,
      generatingCharacterId: null,
    });
    useSceneStore.setState({
      scenes: [
        {
          id: "scene-parent",
          name: "道口镇",
          location: "道口镇",
          time: "夜",
          atmosphere: "雨夜",
          referenceImage: "project-file://dao/workflow-images/assets/scene-parent.png",
          projectId: "dao-project",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "scene-derived",
          name: "道口镇",
          location: "道口镇",
          time: "夜",
          atmosphere: "湿冷",
          parentSceneId: "scene-parent",
          viewpointName: "雨夜街口",
          visualPrompt: "雨夜街口提示词",
          imageWorkflowId: "flow-scene-derived",
          projectId: "dao-project",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      folders: [],
      currentFolderId: null,
      selectedSceneId: null,
      generationStatus: "idle",
      generationError: null,
      generatingSceneId: null,
      contactSheetTasks: {},
    });
    usePropsLibraryStore.setState({
      items: [
        {
          id: "prop-parent",
          name: "断剑",
          description: "父道具",
          imageUrl: "project-file://dao/workflow-images/assets/prop-parent.png",
          folderId: null,
          projectId: "dao-project",
          createdAt: 1,
        },
        {
          id: "prop-derived",
          name: "断剑",
          category: "雨夜湿剑",
          description: "雨夜状态",
          imageUrl: "",
          folderId: null,
          parentId: "prop-parent",
          visualPrompt: "雨夜湿剑提示词",
          imageWorkflowId: "flow-prop-derived",
          projectId: "dao-project",
          createdAt: 2,
        },
      ],
      folders: [],
      selectedFolderId: "all",
    });

    const tasks = collectDerivedAssetGenerationTasks(
      [
        { parentAssetId: "char-parent", state: "雨夜湿衣", reason: "雨夜镜头复用" },
        { parentAssetId: "scene-parent", state: "雨夜街口", reason: "雨夜镜头复用" },
        { parentAssetId: "prop-parent", state: "雨夜湿剑", reason: "特写复用" },
      ],
      (id) =>
        id === "char-parent"
          ? { kind: "character", id }
          : id === "scene-parent"
          ? { kind: "scene", id }
          : id === "prop-parent"
            ? { kind: "prop", id }
            : null,
      "manual-1",
      "dao-project",
    );

    expect(tasks.characterVariationTasks).toEqual([
      expect.objectContaining({
        characterId: "char-parent",
        variationId: "char-derived",
        referenceImages: [
          "project-file://dao/workflow-images/assets/char-parent.png",
          "project-file://dao/workflow-images/assets/char-parent-front.png",
        ],
        imageWorkflowId: "flow-char-derived",
      }),
    ]);
    expect(tasks.storeTasks).toEqual([
      expect.objectContaining({
        assetId: "scene-derived",
        assetType: "scene",
        referenceImages: ["project-file://dao/workflow-images/assets/scene-parent.png"],
        imageWorkflowId: "flow-scene-derived",
      }),
      expect.objectContaining({
        assetId: "prop-derived",
        assetType: "prop",
        referenceImages: ["project-file://dao/workflow-images/assets/prop-parent.png"],
        imageWorkflowId: "flow-prop-derived",
      }),
    ]);
  });

  it("records storyboard image generation as an image workflow result, not only a media path", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useProductionPlanningActions.ts",
      ),
      "utf8",
    );
    const start = source.indexOf("const handleGenerateStoryboardImages = useCallback");
    const end = source.indexOf("const handleRebuildWorkbenchTracks", start);
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(handler).toContain("createStoryboardImageWorkflowGraph");
    expect(handler).toContain("workflowStore.upsertImageWorkflow(graph)");
    expect(handler).toContain("workflowStore.applyImageWorkflowResultToStoryboard");
    expect(handler).not.toContain('mediaRef: { kind: "image", path: saved.url }');
  });

  it("keeps Toonflow storyboard image generation opt-out when collecting targets", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useProductionPlanningActions.ts",
      ),
      "utf8",
    );
    const start = source.indexOf("function collectStoryboardsNeedingImages");
    const end = source.indexOf("function buildStoryboardImagePrompt", start);
    const collector = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(collector).toContain("item.shouldGenerateImage !== false");
  });

  it("generates storyboard images with ordered asset reference images in the current project", async () => {
    const project = { id: "dao-project", name: "道劫", createdAt: 1, updatedAt: 1 };
    useProjectStore.setState({
      projects: [project],
      activeProjectId: project.id,
      activeProject: project,
    });
    useAppSettingsStore.setState({
      imageGenerationSettings: {
        defaultAspectRatio: "16:9",
        defaultResolution: "2K",
        compatibilityRetryEnabled: true,
        compatibilityRetryAspectRatio: "1:1",
        compatibilityRetryResolution: "1K",
      },
    });
    useFreedomStore.setState({
      selectedImageModel: "gpt-image-2",
      imageAspectRatio: "9:16",
      imageResolution: "1K",
    });
    useCharacterLibraryStore.setState({
      characters: [
        {
          id: "char-1",
          name: "独孤剑尘",
          description: "主角",
          visualTraits: "black robe",
          projectId: project.id,
          thumbnailUrl: "project-file://dao/assets/char-thumb.png",
          variations: [
            {
              id: "char-1-rain",
              name: "雨夜湿衣",
              visualPrompt: "wet robe",
              referenceImage: "project-file://dao/assets/char-rain.png",
            },
          ],
          views: [
            {
              viewType: "front",
              imageUrl: "https://cdn.test/char-front.png",
              generatedAt: 1,
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    useSceneStore.setState({
      scenes: [
        {
          id: "scene-1",
          name: "悦来客栈",
          location: "客栈",
          time: "夜",
          atmosphere: "雨夜",
          projectId: project.id,
          referenceImage: "project-file://dao/assets/scene.png",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    usePropsLibraryStore.setState({
      items: [
        {
          id: "prop-1",
          name: "归元断剑",
          description: "断剑",
          imageUrl: "https://cdn.test/prop.png",
          projectId: project.id,
          folderId: null,
          createdAt: 1,
        },
      ],
    });
    useStudioStore.setState({
      materials: [],
      imageWorkflows: [],
      agentWorkData: [],
      workflowConfig: { visualManualId: "manual-1" },
      storyboards: [
        {
          id: "shot-1",
          episodeId: "episode-1",
          index: 1,
          trackKey: "track-1",
          trackId: "",
          duration: 4,
          prompt: "雨夜低机位推进",
          videoDesc: "独孤剑尘走进客栈",
          assetIds: ["char-1", "scene-1", "prop-1"],
          state: "idle",
        },
        {
          id: "shot-skip",
          episodeId: "episode-1",
          index: 2,
          trackKey: "track-1",
          trackId: "",
          duration: 4,
          prompt: "仅声音过场",
          videoDesc: "黑场听雨",
          assetIds: ["char-1"],
          shouldGenerateImage: false,
          state: "idle",
        },
      ],
    });
    (window as any).projectFiles = {
      readAsBase64: vi.fn(async (url: string) => ({
        success: true,
        base64: `data:image/png;base64,${url.split("/").pop()?.replace(".png", "").toUpperCase()}`,
      })),
      saveImage: vi.fn(async () => ({
        success: true,
        url: "project-file://dao-project/workflow-images/storyboards/episode-1/shot-001.png",
        size: 123,
      })),
    };
    (window as any).studioAssets = {
      add: vi.fn(),
      addImage: vi.fn(),
      saveMaterial: vi.fn(),
    };
    aiManagerMocks.freedomImage.mockResolvedValue({
      url: "https://model.test/generated-shot.png",
    });

    const { result } = renderHook(() =>
      useProductionPlanningActions({
        activeProjectId: project.id,
        productionEpisodeId: "episode-1",
        manualCatalog: {
          visual: [
            {
              id: "manual-1",
              kind: "visual",
              name: "水墨手册",
              modules: { README: "水墨", prefix: "国风", art_storyboard_video: "横版分镜" },
              images: [],
              builtin: true,
              source: "bundled",
              completenessScore: 1,
              moduleCount: 3,
              imageCount: 0,
            },
          ],
        },
        handleStageChange: vi.fn(),
        saveAgentWorkData: useStudioStore.getState().saveAgentWorkData,
        saveScriptPlan: vi.fn(),
        saveSeriesBible: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleProductionNodeAction({
        id: "generate-storyboard-images",
        targetStage: "storyboard",
        userInstruction: "保持角色和场景连续",
      });
    });

    expect(aiManagerMocks.freedomImage).toHaveBeenCalledTimes(1);
    expect(aiManagerMocks.freedomImage).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-image-2",
      aspectRatio: "16:9",
      resolution: "2K",
      referenceImages: [
        "data:image/png;base64,CHAR-THUMB",
        "data:image/png;base64,CHAR-RAIN",
        "https://cdn.test/char-front.png",
        "data:image/png;base64,SCENE",
        "https://cdn.test/prop.png",
      ],
    }));
    expect(window.projectFiles?.saveImage).toHaveBeenCalledWith(expect.objectContaining({
      projectId: project.id,
      relativePath: expect.stringMatching(/^workflow-images\/storyboards\/episode-1\/shot-001-shot-1-/),
      source: "https://model.test/generated-shot.png",
    }));
    expect(window.studioAssets?.add).not.toHaveBeenCalled();
    expect(window.studioAssets?.addImage).not.toHaveBeenCalled();
    expect(window.studioAssets?.saveMaterial).not.toHaveBeenCalled();
    expect(useStudioStore.getState().storyboards.find((item) => item.id === "shot-1")).toMatchObject({
      state: "ready",
      mediaRef: {
        kind: "image",
        path: "project-file://dao-project/workflow-images/storyboards/episode-1/shot-001.png",
      },
    });
    const skippedStoryboard = useStudioStore.getState().storyboards.find((item) => item.id === "shot-skip");
    expect(skippedStoryboard).toMatchObject({ state: "idle" });
    expect(skippedStoryboard?.mediaRef).toBeUndefined();
  });

  it("routes script asset management to extraction first and manual generation second", () => {
    const indexSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/index.tsx",
      ),
      "utf8",
    );
    const viewModelSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useStudioViewModel.ts",
      ),
      "utf8",
    );
    const managementSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/ScriptAssetManagementTab.tsx",
      ),
      "utf8",
    );
    const moduleSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/ScriptAssetGenerationTab.tsx",
      ),
      "utf8",
    );
    const assetsStart = indexSource.indexOf('value="assets"');
    const assetsEnd = indexSource.indexOf('<TabsContent\n              value="storyboard"');
    const assetsTabSource = indexSource.slice(assetsStart, assetsEnd);

    expect(indexSource).toContain("ScriptAssetManagementTab");
    expect(indexSource).not.toContain('TabsContent value="generation"');
    expect(assetsTabSource).toContain("<ScriptAssetManagementTab");
    expect(assetsTabSource).not.toContain("<ScriptAssetGenerationTab");
    expect(managementSource).toContain("<AssetsTab");
    expect(managementSource).toContain("<ScriptAssetGenerationTab");
    expect(managementSource.indexOf("<AssetsTab")).toBeLessThan(
      managementSource.indexOf("<ScriptAssetGenerationTab"),
    );
    expect(moduleSource).toContain("资产生成");
    expect(moduleSource).toContain("角色");
    expect(moduleSource).toContain("场景");
    expect(moduleSource).toContain("道具");
    expect(moduleSource).toContain("参考音频");
    expect(moduleSource).toContain("自动分配音频");
    expect(moduleSource).not.toContain("全部润色提示词");
    expect(moduleSource).not.toContain("生成图片 (");
    expect(moduleSource).not.toContain("缺少{typeLabel(activeType)}资产");
    expect(moduleSource).toContain("useScriptAssetGenerationActions");
    expect(moduleSource).not.toContain("batchGenerateAssets");
    expect(moduleSource).not.toContain("polishAssetsAndUpdateStore");
    expect(moduleSource).not.toContain("onClick={handleGenerateImages}");
    expect(moduleSource).toContain('from "./ScriptAssetGenerationRow"');
    expect(moduleSource).toContain('from "./script-asset-generation-model"');
    expect(moduleSource).toContain('from "./useScriptAssetGenerationData"');
    expect(moduleSource).toContain('from "./useScriptAssetGenerationActions"');
    expect(moduleSource).toContain("handleAutoAssignAudio");
    expect(moduleSource).not.toContain("function AssetGenerationRow");
    expect(moduleSource).not.toContain("function summarizeRows");
    expect(moduleSource).not.toContain("function getRowImage");
    expect(moduleSource).not.toContain("生成视频预览");
    expect(moduleSource).not.toContain("运行导演计划");
    expect(moduleSource).not.toContain("锁定剧集圣经");
    expect(assetsTabSource).not.toContain("runDirectorPlan");
    expect(assetsTabSource).not.toContain("buildSeriesBible");
    expect(moduleSource).not.toContain("RoleVoiceAssignDialog");
    expect(moduleSource).toContain("StudioAssetDetailDialog");
  });

  it("renders extraction and generation in one script asset management stage", () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    useProjectStore.setState({
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useTtsStore.setState({
      activeProjectId: "default-project",
      projects: { "default-project": { bindings: {}, voiceLines: {} } },
      voiceProfiles: {},
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [
            {
              characterId: "char-1",
              name: "独孤剑尘",
              aliases: [],
              note: "性别：男。年龄：青年。冷静克制。",
            },
          ],
          scenes: [{ sceneId: "scene-1", name: "道口镇" }],
          props: [{ assetId: "prop-1", name: "断剑" }],
        },
      ],
    });

    render(
      <ScriptAssetManagementTab
        novelChapters={[
          {
            id: "chapter-001",
            index: 1,
            title: "第一章",
            sourceText: "原文",
            importedAt: 1,
          },
        ]}
        agentWorkData={[
          {
            id: "work-script",
            key: "scriptDraft",
            episodeId: "chapter-001",
            data: "第一章剧本",
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        entityExtractions={[
          {
            id: "extract-1",
            episodeId: "chapter-001",
            characters: [
              {
                characterId: "char-1",
                name: "独孤剑尘",
                aliases: [],
                note: "性别：男。年龄：青年。冷静克制。",
              },
            ],
            scenes: [{ sceneId: "scene-1", name: "道口镇" }],
            props: [{ assetId: "prop-1", name: "断剑" }],
          },
        ]}
        extractAssets={vi.fn()}
        updateExtraction={vi.fn()}
        setHeaderActions={vi.fn()}
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    expect(screen.getByText("资产提取")).toBeTruthy();
    expect(screen.getByText("资产生成")).toBeTruthy();
    expect(screen.getAllByText("独孤剑尘").length).toBeGreaterThan(0);
    expect(screen.getByText("参考音频 0/1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /自动分配音频/ })).toBeTruthy();
  });

  it("renders extracted script assets from the split AssetsTab module", () => {
    render(
      <AssetsTab
        novelChapters={[
          {
            id: "chapter-001",
            index: 1,
            title: "第一章",
            sourceText: "原文",
            importedAt: 1,
          },
        ]}
        agentWorkData={[
          {
            id: "work-script",
            key: "scriptDraft",
            episodeId: "chapter-001",
            data: "第一章剧本",
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        entityExtractions={[
          {
            id: "extract-1",
            episodeId: "chapter-001",
            characters: [{ characterId: "char-1", name: "独孤剑尘", aliases: [] }],
            scenes: [{ sceneId: "scene-1", name: "道口镇" }],
            props: [{ assetId: "prop-1", name: "断剑" }],
          },
        ]}
        extractAssets={vi.fn()}
        updateExtraction={vi.fn()}
        setHeaderActions={vi.fn()}
      />,
    );

    expect(screen.getByText("角色：")).toBeTruthy();
    expect(screen.getByText("场景：")).toBeTruthy();
    expect(screen.getByText("道具：")).toBeTruthy();
    expect(screen.getByText("独孤剑尘")).toBeTruthy();
    expect(screen.getByText("道口镇")).toBeTruthy();
    expect(screen.getByText("断剑")).toBeTruthy();
    expect(screen.getByText("剧本内容")).toBeTruthy();
  });

  it("does not initialize the independent asset library while rendering workflow extraction assets", async () => {
    const list = vi.fn(async () => ({ items: [] }));
    (window as any).studioAssets = { list };

    render(
      <AssetsTab
        novelChapters={[]}
        agentWorkData={[]}
        entityExtractions={[
          {
            id: "extract-1",
            episodeId: "chapter-001",
            characters: [{ characterId: "char-1", name: "独孤剑尘", aliases: [] }],
            scenes: [{ sceneId: "scene-1", name: "道口镇" }],
            props: [{ assetId: "prop-1", name: "断剑" }],
          },
        ]}
        extractAssets={vi.fn()}
        updateExtraction={vi.fn()}
        setHeaderActions={vi.fn()}
      />,
    );

    await Promise.resolve();
    expect(list).not.toHaveBeenCalled();
  });

  it("allows explicit asset-library management mode to list asset center records", async () => {
    const list = vi.fn(async () => ({ items: [] }));
    (window as any).studioAssets = { list };

    render(
      <AssetsTab
        mode="manage"
        novelChapters={[]}
        agentWorkData={[]}
        entityExtractions={[]}
        extractAssets={vi.fn()}
        updateExtraction={vi.fn()}
        setHeaderActions={vi.fn()}
      />,
    );

    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(list).toHaveBeenCalledWith({ type: "role", limit: 99999 });
    expect(list).toHaveBeenCalledWith({ type: "scene", limit: 99999 });
    expect(list).toHaveBeenCalledWith({ type: "tool", limit: 99999 });
  });

  it("renders script asset generation voice actions inside the asset management stage", () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    useProjectStore.setState({
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useTtsStore.setState({
      activeProjectId: "default-project",
      projects: { "default-project": { bindings: {}, voiceLines: {} } },
      voiceProfiles: {},
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [
            {
              characterId: "char-1",
              name: "独孤剑尘",
              aliases: [],
              note: "性别：男。年龄：青年。冷静克制。",
            },
          ],
          scenes: [],
          props: [],
        },
      ],
    });

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    expect(screen.getByText("资产生成")).toBeTruthy();
    expect(screen.getByText("参考音频 0/1")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /自动分配音频/ }),
    ).toBeTruthy();
    const unassignedBadge = screen.getByText("未分配音色");
    expect(unassignedBadge).toBeTruthy();
    expect(unassignedBadge.className).toContain("border-destructive");
    expect(screen.queryByText("未分配")).toBeNull();
    expect(screen.queryByRole("button", { name: /^分配音频$/ })).toBeNull();
  });

  it("prompts when extracted scene and prop rows are missing asset-library records", () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    useSceneStore.getState().reset();
    usePropsLibraryStore.setState({
      items: [],
      folders: [],
      selectedFolderId: "all",
    });
    useProjectStore.setState({
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useTtsStore.setState({
      activeProjectId: "default-project",
      projects: { "default-project": { bindings: {}, voiceLines: {} } },
      voiceProfiles: {},
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [],
          scenes: [{ sceneId: "scene-1", name: "道口镇" }],
          props: [{ assetId: "prop-1", name: "断剑" }],
        },
      ],
    });

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /场景/ }));
    expect(screen.getByText((_, element) => element?.textContent === "缺少场景资产")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /道具/ }));
    expect(screen.getByText((_, element) => element?.textContent === "缺少道具资产")).toBeTruthy();
  });

  it("keeps workflow asset generation project-scoped instead of auto-matching the independent asset library", async () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    useSceneStore.getState().reset();
    usePropsLibraryStore.setState({
      items: [],
      folders: [],
      selectedFolderId: "all",
    });
    useProjectStore.setState({
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useTtsStore.setState({
      activeProjectId: "default-project",
      projects: { "default-project": { bindings: {}, voiceLines: {} } },
      voiceProfiles: {},
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [],
          scenes: [{ sceneId: "scene-1", name: "悦来客栈" }],
          props: [{ assetId: "prop-1", name: "绿锈铜钱" }],
        },
      ],
    });
    const batchMatch = vi.fn(async () => []);
    (window as any).studioAssets = { batchMatch };

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /场景/ }));
    expect(await screen.findByText((_, element) => element?.textContent === "缺少场景资产")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /道具/ }));
    expect(await screen.findByText((_, element) => element?.textContent === "缺少道具资产")).toBeTruthy();
    expect(batchMatch).not.toHaveBeenCalled();
  });

  it("shows a store-in-asset-library action only when the script asset is missing from the asset library", async () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    usePropsLibraryStore.setState({
      items: [],
      folders: [],
      selectedFolderId: "all",
    });
    useProjectStore.setState({
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useSceneStore.setState({
      scenes: [
        {
          id: "scene-local-1",
          name: "道口镇",
          location: "道口镇",
          time: "",
          atmosphere: "小镇街巷",
          visualPrompt: "小镇街巷视觉提示词",
          referenceImage: "local-image://scenes/daokou.png",
          projectId: "default-project",
          status: "linked",
          linkedEpisodeId: "chapter-001",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      folders: [],
      currentFolderId: null,
      selectedSceneId: null,
      generationStatus: "idle",
      generationError: null,
      generatingSceneId: null,
      contactSheetTasks: {},
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [],
          scenes: [{ sceneId: "scene-local-1", name: "道口镇", note: "小镇街巷" }],
          props: [],
        },
      ],
    });
    const add = vi.fn(async () => ({
      id: "asset-scene-created",
      source: "manying-local",
      type: "scene",
      name: "道口镇",
      description: "道口镇",
      prompt: "小镇街巷视觉提示词",
      filePath: "scene/daokou.png",
    }));
    (window as any).imageStorage = {
      getAbsolutePath: vi.fn(async () => "/tmp/daokou.png"),
    };
    (window as any).studioAssets = {
      batchMatch: vi.fn(async () => []),
      getByName: vi.fn(async () => null),
      add,
    };

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /场景/ }));
    const storeButton = await screen.findByRole("button", { name: "放入资产库" });
    fireEvent.click(storeButton);

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        type: "scene",
        name: "道口镇",
        sourceFilePath: "/tmp/daokou.png",
        description: "道口镇",
        prompt: "小镇街巷视觉提示词",
        setting: "小镇街巷",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "放入资产库" })).toBeNull(),
    );
    expect(screen.getByText("资产库已存在")).toBeTruthy();
  });

  it("keeps instant generation project-scoped instead of auto-storing in the asset library", async () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    useSceneStore.getState().reset();
    usePropsLibraryStore.setState({
      items: [],
      folders: [],
      selectedFolderId: "all",
    });
    useProjectStore.setState({
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [],
          scenes: [{ sceneId: "scene-extracted-1", name: "废弃祠堂", note: "破败祠堂" }],
          props: [],
        },
      ],
    });
    (window as any).studioAssets = {
      batchMatch: vi.fn(async () => []),
      getByName: vi.fn(async () => null),
      add: vi.fn(async () => ({
        id: "asset-scene-created",
        source: "manying-local",
        type: "scene",
        name: "废弃祠堂",
        description: "破败祠堂",
      })),
    };

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /场景/ }));
    expect(await screen.findByText((_, element) => element?.textContent === "缺少场景资产")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "放入资产库" }));

    await waitFor(() =>
      expect(screen.queryByText((_, element) => element?.textContent === "缺少场景资产")).toBeNull(),
    );
    expect(screen.getByText("资产库已存在")).toBeTruthy();
  });

  it("generates a missing extracted scene with a real local scene id before storing it in the asset library", async () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    useSceneStore.getState().reset();
    usePropsLibraryStore.setState({
      items: [],
      folders: [],
      selectedFolderId: "all",
    });
    useProjectStore.setState({
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [],
          scenes: [
            {
              sceneId: "scene-extracted-1",
              name: "悦来客栈斗室",
              note: "昏暗狭窄的客栈斗室",
            },
          ],
          props: [],
        },
      ],
    });
    (window as any).imageStorage = {
      getAbsolutePath: vi.fn(async () => "/tmp/yuelai.png"),
    };
    (window as any).studioAssets = {
      batchMatch: vi.fn(async () => []),
      getByName: vi.fn(async () => null),
      add: vi.fn(async () => ({
        id: "asset-scene-created",
        source: "manying-local",
        type: "scene",
        name: "悦来客栈斗室",
        description: "悦来客栈斗室",
        filePath: "scene/yuelai.png",
      })),
    };
    assetOrchestratorMocks.generateAsset.mockImplementation(async (task) => {
      useSceneStore.getState().updateScene(task.assetId, {
        visualPrompt: "悦来客栈斗室视觉提示词",
        promptState: "ready",
        referenceImage: "local-image://scenes/yuelai.png",
      });
      return {
        phase: "done",
        imageLocalPath: "local-image://scenes/yuelai.png",
      };
    });

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /场景/ }));
    fireEvent.click(await screen.findByRole("button", { name: "打开资产 悦来客栈斗室" }));
    expect(await screen.findByText("资产未找到")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "立即生成" }));

    await waitFor(() => expect(assetOrchestratorMocks.generateAsset).toHaveBeenCalled());
    const createdScene = useSceneStore
      .getState()
      .scenes.find((scene) => scene.name === "悦来客栈斗室");
    expect(createdScene).toBeTruthy();
    expect(assetOrchestratorMocks.generateAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: createdScene?.id,
        assetType: "scene",
        projectId: "default-project",
        name: "悦来客栈斗室",
        description: "昏暗狭窄的客栈斗室",
        visualManualId: "manual-1",
      }),
    );
    expect((window as any).studioAssets.add).not.toHaveBeenCalled();
    expect(screen.queryByText("资产库已存在")).toBeNull();
  });

  it("does not auto-resolve role voice bindings through independent asset-library ids", async () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    const localCharacterId = useCharacterLibraryStore.getState().addCharacter({
      name: "独孤剑尘",
      description: "冷静克制",
      visualTraits: "",
      views: [],
    });
    useProjectStore.setState({
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useTtsStore.setState({
      activeProjectId: "default-project",
      projects: {
        "default-project": {
          bindings: {
            "character:asset-role-1": {
              speakerId: "character:asset-role-1",
              profileId: "voice-profile-asset",
              defaultEngine: "qwen",
              defaultModelSize: "1.7B",
            },
          },
          voiceLines: {},
        },
      },
      voiceProfiles: {
        "voice-profile-asset": {
          id: "voice-profile-asset",
          name: "音色·独孤剑尘",
          type: "reference",
          language: "zh",
          defaultEngine: "qwen",
          defaultModelSize: "1.7B",
          referenceAudioPath: "/tmp/voice.wav",
          referenceText: "风雪已经等了你三年。",
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [
            {
              characterId: localCharacterId,
              name: "独孤剑尘",
              aliases: [],
              note: "性别：男。年龄：青年。冷静克制。",
            },
          ],
          scenes: [],
          props: [],
        },
      ],
    });
    const batchMatch = vi.fn(async () => []);
    (window as any).studioAssets = { batchMatch };

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    expect(await screen.findByText("未分配音色")).toBeTruthy();
    expect(screen.queryByText("参考音频")).toBeNull();
    expect(batchMatch).not.toHaveBeenCalled();
  });

  it("does not mark independent asset-library role id bindings as workflow voice errors", async () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    const localCharacterId = useCharacterLibraryStore.getState().addCharacter({
      name: "独孤剑尘",
      description: "冷静克制",
      visualTraits: "",
      views: [],
    });
    useProjectStore.setState({
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useTtsStore.setState({
      activeProjectId: "default-project",
      projects: {
        "default-project": {
          bindings: {
            "character:asset-role-1": {
              speakerId: "character:asset-role-1",
              profileId: "missing-profile",
              defaultEngine: "qwen",
              defaultModelSize: "1.7B",
            },
          },
          voiceLines: {},
        },
      },
      voiceProfiles: {},
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [
            {
              characterId: localCharacterId,
              name: "独孤剑尘",
              aliases: [],
              note: "性别：男。年龄：青年。冷静克制。",
            },
          ],
          scenes: [],
          props: [],
        },
      ],
    });
    const batchMatch = vi.fn(async () => []);
    (window as any).studioAssets = { batchMatch };

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    expect(await screen.findByText("未分配音色")).toBeTruthy();
    expect(screen.queryByText("音色异常")).toBeNull();
    expect(screen.queryByRole("button", { name: /试听音色/ })).toBeNull();
    expect(batchMatch).not.toHaveBeenCalled();
  });

  it("keeps voice badges stable when the active TTS project has not been created yet", async () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    const localCharacterId = useCharacterLibraryStore.getState().addCharacter({
      name: "独孤剑尘",
      description: "冷静克制",
      visualTraits: "",
      views: [],
    });
    useProjectStore.setState({
      activeProjectId: "daojie-project",
      activeProject: {
        id: "daojie-project",
        name: "道劫",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useTtsStore.setState({
      activeProjectId: "daojie-project",
      projects: {},
      voiceProfiles: {},
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [
            {
              characterId: localCharacterId,
              name: "独孤剑尘",
              aliases: [],
              note: "性别：男。年龄：青年。冷静克制。",
            },
          ],
          scenes: [],
          props: [],
        },
      ],
    });

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    expect(await screen.findByText("未分配音色")).toBeTruthy();
  });

  it("distinguishes a broken voice binding from an unassigned voice", () => {
    useStudioStore.getState().resetStudioWorkflow();
    useCharacterLibraryStore.getState().reset();
    useProjectStore.setState({
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    useTtsStore.setState({
      activeProjectId: "default-project",
      projects: {
        "default-project": {
          bindings: {
            "character:char-1": {
              speakerId: "character:char-1",
              profileId: "missing-profile",
              defaultEngine: "qwen",
              defaultModelSize: "1.7B",
            },
          },
          voiceLines: {},
        },
      },
      voiceProfiles: {},
    });
    useStudioStore.setState({
      workflowConfig: { visualManualId: "manual-1" },
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [
            {
              characterId: "char-1",
              name: "独孤剑尘",
              aliases: [],
              note: "性别：男。年龄：青年。冷静克制。",
            },
          ],
          scenes: [],
          props: [],
        },
      ],
    });

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    const brokenBadge = screen.getByText("音色异常");
    expect(brokenBadge).toBeTruthy();
    expect(brokenBadge.className).toContain("border-amber");
    expect(screen.queryByText("未分配音色")).toBeNull();
  });

  it("uses the shared role voice preview chain from script asset rows", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/ScriptAssetGenerationRow.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('from "../assets/RoleVoicePreviewButton"');
    expect(source).toContain('from "./script-asset-voice-binding"');
    expect(source).toContain("getRoleVoiceSpeakerIds(row)");
    expect(source).toContain("resolveRoleVoiceBinding");
    expect(source).toContain("<RoleVoicePreviewButton");
    expect(source).not.toContain("`character:${characterId}`");
  });

  it("keeps the storyboard video generation stage focused on the node canvas", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/index.tsx",
      ),
      "utf8",
    );
    const storyboardStart = source.indexOf('value="storyboard"');
    const storyboardEnd = source.indexOf('<TabsContent value="workbench"');
    const storyboardTabSource = source.slice(storyboardStart, storyboardEnd);

    expect(storyboardStart).toBeGreaterThan(-1);
    expect(storyboardEnd).toBeGreaterThan(storyboardStart);
    expect(storyboardTabSource).toContain("<WorkflowNodeCanvas");
    expect(storyboardTabSource).not.toContain("<StoryboardTab");
    expect(storyboardTabSource).not.toContain("运行 AI 分镜计划");
    expect(storyboardTabSource).not.toContain("生成配音");
    expect(storyboardTabSource).not.toContain("添加分镜");
  });

  it("routes production planning actions through the split hook", () => {
    const indexSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/index.tsx",
      ),
      "utf8",
    );
    const viewModelSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useStudioViewModel.ts",
      ),
      "utf8",
    );
    const hookSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useProductionPlanningActions.ts",
      ),
      "utf8",
    );

    expect(viewModelSource).toContain("useProductionPlanningActions");
    expect(indexSource).not.toContain("buildDirectorPlanMessages");
    expect(indexSource).not.toContain("buildStoryboardTableMessages");
    expect(indexSource).not.toContain('from "@/lib/studio/series-bible"');
    expect(indexSource).not.toContain("buildSeriesBible({");
    expect(hookSource).toContain("handleDirectorPlan");
    expect(hookSource).toContain("handleStoryboardTable");
    expect(hookSource).toContain("handleProductionNodeAction");
    expect(hookSource).toContain("handleBuildSeriesBible");
    expect(hookSource).toContain('saveAgentWorkData("directorPlan"');
    expect(hookSource).toContain('action.id === "sync-derived-assets"');
    expect(hookSource).toContain('action.id === "generate-derived-assets"');
    expect(hookSource).toContain('action.id === "generate-storyboard-images"');
    expect(hookSource).toContain('action.id === "rebuild-workbench-tracks"');
    expect(hookSource).toContain("【本次节点补充要求】");
  });

  it("routes script stage actions through the split hook", () => {
    const indexSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/index.tsx",
      ),
      "utf8",
    );
    const viewModelSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useStudioViewModel.ts",
      ),
      "utf8",
    );
    const hookSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useScriptStageActions.ts",
      ),
      "utf8",
    );

    expect(viewModelSource).toContain("useScriptStageActions");
    expect(indexSource).not.toContain("buildStageMessages");
    expect(indexSource).not.toContain("buildStageReviewMessages");
    expect(indexSource).not.toContain("parseStageOutput");
    expect(indexSource).not.toContain("textStream");
    expect(hookSource).toContain("handleScriptStage");
    expect(hookSource).toContain("handleStageReview");
    expect(hookSource).toContain("scriptStreaming");
    expect(hookSource).toContain("buildStudioManualContext");
    expect(hookSource).toContain("useReviewFeedback?: boolean");
    expect(hookSource).toContain("options?.useReviewFeedback");
    expect(hookSource).toContain("reviewFeedback: useReviewFeedback && hasReviewIssues(review) ? review : undefined");
  });

  it("routes production render actions through the split hook", () => {
    const indexSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/index.tsx",
      ),
      "utf8",
    );
    const viewModelSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useStudioViewModel.ts",
      ),
      "utf8",
    );
    const hookSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useProductionRenderActions.ts",
      ),
      "utf8",
    );

    expect(viewModelSource).toContain("useProductionRenderActions");
    expect(indexSource).not.toContain("createTrackRenderPlan");
    expect(indexSource).not.toContain("createEpisodeMergePlan");
    expect(indexSource).not.toContain("setRenderingTrackId");
    expect(hookSource).toContain("renderTrackCandidate");
    expect(hookSource).toContain("mergeEpisode");
    expect(hookSource).toContain("selectedCandidates");
  });

  it("routes novel analysis and asset extraction through the split hook", () => {
    const indexSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/index.tsx",
      ),
      "utf8",
    );
    const viewModelSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useStudioViewModel.ts",
      ),
      "utf8",
    );
    const hookSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useNovelPipelineActions.ts",
      ),
      "utf8",
    );

    expect(viewModelSource).toContain("useNovelPipelineActions");
    expect(indexSource).not.toContain("buildNovelEventAnalysisMessages");
    expect(indexSource).not.toContain("parseNovelEventAnalysisLine");
    expect(indexSource).not.toContain("buildEntityExtractionMessages");
    expect(indexSource).not.toContain("parseEntityExtraction(");
    expect(indexSource).not.toContain("syncExtractedEntities(");
    expect(hookSource).toContain("handleNovelEventAnalysis");
    expect(hookSource).toContain("handleEntityExtraction");
    expect(hookSource).toContain("buildNovelEventAnalysisMessages");
    expect(hookSource).toContain("buildEntityExtractionMessages");
    expect(hookSource).toContain("createMystudioSinks");
  });

  it("computes workflow readiness through the split hook", () => {
    const indexSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/index.tsx",
      ),
      "utf8",
    );
    const viewModelSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useStudioViewModel.ts",
      ),
      "utf8",
    );
    const hookSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useWorkflowReadiness.ts",
      ),
      "utf8",
    );

    expect(viewModelSource).toContain("useWorkflowReadiness");
    expect(indexSource).not.toContain("buildWorkflowReadiness");
    expect(indexSource).not.toContain("useTtsStore");
    expect(hookSource).toContain("buildWorkflowReadiness");
    expect(hookSource).toContain("useTtsStore");
    expect(hookSource).toContain("studioRenderer");
  });

  it("renders the Toonflow style workbench parameter bar and track actions", () => {
    render(
      <WorkbenchTab
        storyboards={[]}
        tracks={[
          {
            id: "track-1",
            episodeId: "episode-1",
            trackKey: "opening",
            storyboardIds: [],
            prompt: "opening prompt",
            duration: 4,
            candidateVideoIds: [],
            state: "idle",
          },
        ]}
        candidates={[]}
        renderingTrackId={null}
        merging={false}
        mergeOutput={null}
        rebuildTracks={vi.fn()}
        renderTrack={vi.fn()}
        selectVideoCandidate={vi.fn()}
        deleteVideoCandidate={vi.fn()}
        mergeEpisode={vi.fn()}
      />,
    );

    expect(screen.getByText("ffmpeg-local")).toBeTruthy();
    expect(screen.getByText("track-candidate")).toBeTruthy();
    expect(screen.getByText("16:9")).toBeTruthy();
    expect(screen.getByText("audio")).toBeTruthy();
    expect(screen.getByText("添加 track")).toBeTruthy();
    expect(screen.getByText("生成提示词")).toBeTruthy();
    expect(screen.getByText("生成视频")).toBeTruthy();
    expect(screen.getByRole("button", { name: /导出成片/ })).toBeTruthy();
    expect(screen.queryByText("本地合成")).toBeNull();
  });

  it("renders track medias and video candidates with selection actions", () => {
    const renderTrack = vi.fn();
    const selectVideoCandidate = vi.fn();
    const deleteVideoCandidate = vi.fn();
    render(
      <WorkbenchTab
        storyboards={[
          {
            id: "shot-1",
            episodeId: "episode-1",
            index: 1,
            trackKey: "opening",
            trackId: "track-1",
            duration: 4,
            prompt: "shot prompt",
            videoDesc: "雨夜推进",
            assetIds: [],
            state: "ready",
            mediaRef: {
              kind: "image",
              path: "project-file://daojie/workflow-images/shot.png",
            },
            audioRef: { kind: "audio", path: "/tmp/shot.wav" },
          },
        ]}
        tracks={[
          {
            id: "track-1",
            episodeId: "episode-1",
            trackKey: "opening",
            storyboardIds: ["shot-1"],
            prompt: "opening prompt",
            duration: 4,
            candidateVideoIds: ["video-1"],
            selectedVideoId: "video-1",
            state: "ready",
          },
        ]}
        candidates={[
          {
            id: "video-1",
            trackId: "track-1",
            provider: "ffmpeg-local",
            filePath: "/tmp/video.mp4",
            state: "ready",
            createdAt: 1,
          },
        ]}
        renderingTrackId={null}
        merging={false}
        mergeOutput={null}
        rebuildTracks={vi.fn()}
        renderTrack={renderTrack}
        selectVideoCandidate={selectVideoCandidate}
        deleteVideoCandidate={deleteVideoCandidate}
        mergeEpisode={vi.fn()}
      />,
    );

    expect(screen.getByText("storyboard/image")).toBeTruthy();
    expect(screen.getByText("storyboard/audio")).toBeTruthy();
    expect(screen.getByAltText("分镜 1").getAttribute("src")).toBe(
      "project-file://daojie/workflow-images/shot.png",
    );
    expect(screen.getAllByText("ready").length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole("button", { name: /生成视频/ }));
    fireEvent.click(screen.getByRole("button", { name: /选择/ }));
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));

    expect(renderTrack).toHaveBeenCalledWith("track-1");
    expect(selectVideoCandidate).toHaveBeenCalledWith("track-1", "video-1");
    expect(deleteVideoCandidate).toHaveBeenCalledWith("video-1");
  });

  it("disables final merge until a ready selected candidate exists", () => {
    render(
      <WorkbenchTab
        storyboards={[]}
        tracks={[
          {
            id: "track-1",
            episodeId: "episode-1",
            trackKey: "opening",
            storyboardIds: [],
            prompt: "opening prompt",
            duration: 4,
            candidateVideoIds: [],
            state: "idle",
          },
        ]}
        candidates={[]}
        renderingTrackId={null}
        merging={false}
        mergeOutput={null}
        rebuildTracks={vi.fn()}
        renderTrack={vi.fn()}
        selectVideoCandidate={vi.fn()}
        deleteVideoCandidate={vi.fn()}
        mergeEpisode={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /导出成片/ })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
