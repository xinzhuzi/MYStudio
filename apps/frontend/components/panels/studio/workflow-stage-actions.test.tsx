// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AssetsTab,
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

  it("exposes script asset management inside the generation stage", () => {
    const { container } = render(
      <AssetsTab
        mode="manage"
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

    expect(screen.getByText("剧本资产管理")).toBeTruthy();
    expect(screen.getByText("管理从剧本抽取出的角色、场景、道具，并检查资产库制作状态。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /生成图片/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /生成视频预览/ })).toBeNull();
    expect(screen.queryByText("全部润色提示词")).toBeNull();
    expect(screen.getByText("角色：")).toBeTruthy();
    expect(screen.getByText("场景：")).toBeTruthy();
    expect(screen.getByText("道具：")).toBeTruthy();
    expect(screen.getByText("独孤剑尘")).toBeTruthy();
    expect(screen.getByText("道口镇")).toBeTruthy();
    expect(screen.getByText("断剑")).toBeTruthy();
    expect(screen.queryByText("运行导演计划")).toBeNull();
    expect(screen.queryByText("锁定剧集圣经")).toBeNull();
    expect(container.querySelector(".workflow-node-canvas")).toBeNull();
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
