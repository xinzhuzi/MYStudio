// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  GenerationTab,
  StoryboardTab,
  WorkbenchTab,
  resolveProductionEpisodeId,
  resolveScriptPlanEpisodeId,
  resolveScriptTextForEpisode,
} from "./index";

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
        { id: "work-1", key: "scriptDraft", episodeId: "chapter-1", data: "第一章剧本", createdAt: 1, updatedAt: 1 },
        { id: "work-2", key: "scriptDraft", episodeId: "chapter-2", data: "第二章剧本", createdAt: 2, updatedAt: 2 },
      ],
      novelChapters: [
        { id: "chapter-1", index: 1, title: "第一章", sourceText: "第一章正文", createdAt: 1, updatedAt: 1 },
        { id: "chapter-2", index: 2, title: "第二章", sourceText: "第二章正文", createdAt: 2, updatedAt: 2 },
      ],
      scriptPlans: [{ id: "plan-1", episodeId: "chapter-1" }],
    } as unknown as ReturnType<typeof import("@/stores/studio-store").useStudioStore.getState>;

    expect(resolveProductionEpisodeId(store)).toBe("chapter-2");
    expect(resolveScriptTextForEpisode(store, "chapter-2")).toBe("第二章剧本");
    expect(resolveScriptPlanEpisodeId(store)).toBe("chapter-1");
  });

  it("exposes director planning actions inside the generation stage", () => {
    render(
      <GenerationTab
        runDirectorPlan={vi.fn()}
        deriveAssets={vi.fn()}
        buildSeriesBible={vi.fn()}
        productionEpisodeId="chapter-001"
        scriptPlanCount={0}
        hasSeriesBible={false}
        projectName="测试项目"
      />,
    );

    expect(screen.getByText("ProductionAgent：导演规划与衍生资产")).toBeTruthy();
    expect(screen.getByText("运行导演计划")).toBeTruthy();
    expect(screen.getByText("落地衍生资产")).toBeTruthy();
    expect(screen.getByText("锁定剧集圣经")).toBeTruthy();
    expect(screen.getByRole("button", { name: /生成图片/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /生成视频预览/ })).toBeTruthy();
    expect(screen.getByText("按 Toonflow 的 ProductionAgent 顺序推进：导演规划、衍生资产分析/生成、分镜表、分镜面板、分镜图，再进入视频工作台。")).toBeTruthy();
  });

  it("passes the resolved chapter id to generation actions", () => {
    const runDirectorPlan = vi.fn();
    const deriveAssets = vi.fn();
    render(
      <GenerationTab
        runDirectorPlan={runDirectorPlan}
        deriveAssets={deriveAssets}
        buildSeriesBible={vi.fn()}
        productionEpisodeId="chapter-001"
        scriptPlanCount={1}
        hasSeriesBible={false}
        projectName="测试项目"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /运行导演计划/ }));
    fireEvent.click(screen.getByRole("button", { name: /落地衍生资产/ }));

    expect(runDirectorPlan).toHaveBeenCalledWith("chapter-001");
    expect(deriveAssets).toHaveBeenCalledWith("chapter-001");
  });

  it("exposes AI storyboard generation inside the storyboard stage", () => {
    render(
      <StoryboardTab
        storyboards={[]}
        materials={[]}
        importMaterials={vi.fn()}
        deleteMaterial={vi.fn()}
        bindMaterialToStoryboard={vi.fn()}
        addStoryboard={vi.fn()}
        updateStoryboard={vi.fn()}
        createStoryboardsFromChapters={vi.fn()}
        generateStoryboardTable={vi.fn()}
      />,
    );

    expect(screen.getByText("分镜表与分镜面板")).toBeTruthy();
    expect(screen.getByText("运行 AI 分镜计划")).toBeTruthy();
    expect(screen.getByRole("button", { name: /生成配音/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /试听配音/ })).toBeTruthy();
    expect(screen.getByText("分镜表落地后进入分镜面板，绑定画面素材并生成分镜图/配音。")).toBeTruthy();
  });

  it("uses candidate-video wording in the editing stage", () => {
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

    expect(screen.getByText("生成候选片段")).toBeTruthy();
    expect(screen.getByRole("button", { name: /导出成片/ })).toBeTruthy();
    expect(screen.queryByText("本地合成")).toBeNull();
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

    expect(screen.getByRole("button", { name: /导出成片/ })).toHaveProperty("disabled", true);
  });

});
