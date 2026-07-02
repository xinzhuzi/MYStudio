// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AssetsTab } from "./AssetsTab";
import { ScriptAssetManagementTab } from "./ScriptAssetManagementTab";
import { ScriptAssetGenerationTab } from "./ScriptAssetGenerationTab";
import { WorkbenchTab } from "./WorkbenchTab";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useTtsStore } from "@/stores/tts-store";
import {
  formatScriptPlanContext,
  resolveProductionEpisodeId,
  resolveScriptPlanEpisodeId,
  resolveScriptTextForEpisode,
} from "./workflow-helpers";

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
  delete (window as any).studioAssets;
  delete (window as any).imageStorage;
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
    expect(moduleSource).toContain("全部润色提示词");
    expect(moduleSource).toContain("useScriptAssetGenerationActions");
    expect(moduleSource).not.toContain("batchGenerateAssets");
    expect(moduleSource).not.toContain("polishAssetsAndUpdateStore");
    expect(moduleSource).toContain("onClick={handleGenerateImages}");
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
    expect(screen.getByText("缺少场景资产 1")).toBeTruthy();
    expect(screen.getByText("缺少场景资产")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /道具/ }));
    expect(screen.getByText("缺少道具资产 1")).toBeTruthy();
    expect(screen.getByText("缺少道具资产")).toBeTruthy();
  });

  it("reuses matched scene and prop assets from the studio asset library", async () => {
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
    (window as any).studioAssets = {
      batchMatch: vi.fn(async ({ type, names }: { type: string; names: string[] }) =>
        names.map((name) => ({
          name,
          asset:
            type === "scene"
              ? {
                  id: "asset-scene-1",
                  source: "manying-local",
                  type: "scene",
                  name: "悦来客栈",
                  description: "已有客栈场景",
                  thumbnailUrl: "file:///tmp/scene.png",
                  previewUrl: "file:///tmp/scene.png",
                  filePath: "scene/scene.png",
                }
              : type === "tool"
                ? {
                    id: "asset-tool-1",
                    source: "manying-local",
                    type: "tool",
                    name: "铜钱;绿锈铜钱",
                    description: "已有铜钱道具",
                    thumbnailUrl: "file:///tmp/coin.png",
                    previewUrl: "file:///tmp/coin.png",
                    filePath: "tool/coin.png",
                  }
                : null,
        })),
      ),
    };

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /场景/ }));
    await waitFor(() => expect(screen.getByText("资产库已存在")).toBeTruthy());
    expect(screen.queryByText("缺少场景资产")).toBeNull();
    expect(screen.getByText("已有客栈场景")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /道具/ }));
    await waitFor(() => expect(screen.getByText("已有铜钱道具")).toBeTruthy());
    expect(screen.queryByText("缺少道具资产")).toBeNull();
    expect(screen.queryByRole("button", { name: "放入资产库" })).toBeNull();
    expect(screen.getByText("资产库已存在")).toBeTruthy();
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

  it("updates the missing asset count after storing an extracted script asset in the asset library", async () => {
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
    expect(await screen.findByText("缺少场景资产 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "放入资产库" }));

    await waitFor(() => expect(screen.queryByText("缺少场景资产 1")).toBeNull());
    expect(screen.getByText("资产库已存在")).toBeTruthy();
  });

  it("recognizes role voice bindings written with the asset-library role id", async () => {
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
    (window as any).studioAssets = {
      batchMatch: vi.fn(async () => [
        {
          name: "独孤剑尘",
          asset: {
            id: "asset-role-1",
            source: "manying-local",
            type: "role",
            name: "独孤剑尘",
          },
        },
      ]),
    };

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    await waitFor(() => expect(screen.getByText("参考音频 1/1")).toBeTruthy());
    expect(screen.getByText("参考音频")).toBeTruthy();
    expect(screen.queryByText("未分配音色")).toBeNull();
  });

  it("marks an asset-library role id binding with a missing profile as broken", async () => {
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
    (window as any).studioAssets = {
      batchMatch: vi.fn(async () => [
        {
          name: "独孤剑尘",
          asset: {
            id: "asset-role-1",
            source: "manying-local",
            type: "role",
            name: "独孤剑尘",
          },
        },
      ]),
    };

    render(
      <ScriptAssetGenerationTab
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
      />,
    );

    await waitFor(() => expect(screen.getByText("音色异常")).toBeTruthy());
    expect(screen.queryByText("未分配音色")).toBeNull();
    expect(screen.queryByRole("button", { name: /试听音色/ })).toBeNull();
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
