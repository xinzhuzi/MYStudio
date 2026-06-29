// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AssetsTab } from "./AssetsTab";
import { ScriptAssetManagementTab } from "./ScriptAssetManagementTab";
import { ScriptAssetGenerationTab } from "./ScriptAssetGenerationTab";
import { WorkbenchTab } from "./WorkbenchTab";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useTtsStore } from "@/stores/tts-store";
import {
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

afterEach(cleanup);

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
    expect(moduleSource).toContain("音频样本");
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
    expect(moduleSource).toContain("RoleVoiceAssignDialog");
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
    expect(screen.getByText("音频样本 0/1")).toBeTruthy();
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
    expect(screen.getByText("音频样本 0/1")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /自动分配音频/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^分配音频$/ })).toBeTruthy();
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
            mediaRef: { kind: "image", path: "/tmp/shot.png" },
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
