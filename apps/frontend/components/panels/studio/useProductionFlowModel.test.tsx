// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useEditingStore } from "@/stores/editing/editing-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useProductionFlowModel } from "./useProductionFlowModel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as any).studioAssets;
  useCharacterLibraryStore.getState().reset();
  useSceneStore.getState().reset();
  usePropsLibraryStore.getState().reset();
  useProjectStore.setState({ activeProjectId: "default-project" });
  useAppSettingsStore.setState({ renderingSettings: { renderer: "ffmpeg" } });
  useEditingStore.setState({
    activeProjectId: "default-project",
    editingProjects: {},
    currentEditingProjectIdByEpisode: {},
    timelineRenderRecordsByEditingProjectId: {},
  });
});

describe("useProductionFlowModel", () => {
  it("uses only render evidence matching the active project, episode, editing project, and revision", () => {
    useProjectStore.setState({ activeProjectId: "project-1" });
    useAppSettingsStore.setState({ renderingSettings: { renderer: "remotion" } });
    const project = {
      schemaVersion: 1 as const,
      id: "editing-1",
      projectId: "project-1",
      episodeId: "episode-1",
      name: "剪辑工程",
      revision: 3,
      sourceSnapshotHash: "snapshot-1",
      createdBy: "manual" as const,
      manuallyEdited: false,
      stale: false,
      renderSettings: { width: 1080, height: 1920, fps: 30, codec: "h264" as const, subtitleMode: "burn-in" as const, loudnessLufs: -14, truePeakDbtp: -1.5 },
      tracks: [], clips: [], transitions: [], effects: [], proposals: [],
      createdAt: 1, updatedAt: 2,
    };
    const record = {
      projectId: "project-1",
      episodeId: "episode-1",
      editingProjectId: "editing-1",
      editingRevision: 3,
      sourceSnapshotHash: "snapshot-1",
      completedAt: 3,
      evidence: {
        jobId: "job-1", path: "/tmp/final.mp4", sizeBytes: 1, mtimeMs: 3,
        sha256: "a".repeat(64), duration: 4, width: 1080, height: 1920,
        streams: ["video", "audio"], snapshotHash: "snapshot-1", snapshotPath: "/tmp/snapshot.json",
        renderer: { requested: "remotion" as const, actual: "ffmpeg" as const, fallback: { code: "unsupported-effects" as const, effectIds: ["glitch" as const], message: "unsupported" } },
      },
    };
    useEditingStore.setState({
      activeProjectId: "project-1",
      editingProjects: { "editing-1": project },
      currentEditingProjectIdByEpisode: { "episode-1": "editing-1" },
      timelineRenderRecordsByEditingProjectId: { "editing-1": record },
    });

    const emptyInput = {
      agentWorkData: [], entityExtractions: [], scriptPlans: [], storyboards: [],
      productionTracks: [], videoCandidates: [],
    };
    const renderModel = (episodeId: string) => renderHook(() => useProductionFlowModel({
      productionEpisodeId: episodeId,
      ...emptyInput,
    }));
    const rejectedFallback = renderModel("episode-1");
    expect(rejectedFallback.result.current.nodes.find((node) => node.id === "workbench")?.rendererSummary).toEqual({
      requested: "remotion",
    });
    rejectedFallback.unmount();

    const remotionRecord = {
      ...record,
      evidence: {
        ...record.evidence,
        renderer: { requested: "remotion" as const, actual: "remotion" as const },
      },
    };
    useEditingStore.setState({
      timelineRenderRecordsByEditingProjectId: { "editing-1": remotionRecord },
    });
    const current = renderModel("episode-1");
    expect(current.result.current.nodes.find((node) => node.id === "workbench")?.rendererSummary).toMatchObject({
      requested: "remotion",
      actual: "remotion",
      lastJobId: "job-1",
      outputPath: "/tmp/final.mp4",
    });
    current.unmount();

    for (const mismatched of [
      { projectId: "project-2" },
      { episodeId: "episode-2" },
      { editingProjectId: "editing-2" },
      { editingRevision: 2 },
    ]) {
      useEditingStore.setState({ timelineRenderRecordsByEditingProjectId: { "editing-1": { ...remotionRecord, ...mismatched } } });
      const stale = renderModel("episode-1");
      expect(stale.result.current.nodes.find((node) => node.id === "workbench")?.rendererSummary).toEqual({ requested: "remotion" });
      stale.unmount();
    }
  });

  it("links independent asset-library batch matches into the derived asset node", async () => {
    useProjectStore.setState({ activeProjectId: "default-project" });
    const batchMatch = vi.fn(async ({ names }: { type: string; names: string[] }) =>
      names.map((name) => ({
        name,
        asset: {
          id: `asset-${name}`,
          source: "manying-local",
          type: "role",
          name,
          thumbnailUrl:
            name === "独孤剑尘"
              ? "project-file://assets/dugu-source.png"
              : undefined,
          previewUrl:
            name === "雨夜破衣"
              ? "project-file://assets/dugu-rain.png"
              : undefined,
          prompt: `${name} 图像提示`,
          imageWorkflowId:
            name === "雨夜破衣" ? "asset-flow-dugu-rain" : undefined,
        },
      })),
    );
    (window as any).studioAssets = {
      batchMatch,
      add: vi.fn(),
      addImage: vi.fn(),
      saveMaterial: vi.fn(),
    };

    const { result } = renderHook(() =>
      useProductionFlowModel({
        productionEpisodeId: "chapter-001",
        agentWorkData: [],
        entityExtractions: [
          {
            id: "extract-1",
            episodeId: "chapter-001",
            characters: [
              { characterId: "char-1", name: "独孤剑尘", aliases: [] },
            ],
            scenes: [],
            props: [],
          },
        ],
        scriptPlans: [
          {
            id: "plan-1",
            episodeId: "chapter-001",
            theme: "",
            visualStyle: "",
            narrativeRhythm: "",
            sceneIntents: [],
            soundDirection: "",
            transitions: "",
            derivedAssetPlan: [
              {
                parentAssetId: "char-1",
                state: "雨夜破衣",
                reason: "剧本资产管理中已有衍生图",
              },
            ],
          },
        ],
        storyboards: [],
        productionTracks: [],
        videoCandidates: [],
      }),
    );

    await waitFor(() =>
      expect(batchMatch).toHaveBeenCalledWith({
        type: "role",
        names: ["独孤剑尘", "雨夜破衣"],
      }),
    );
    await waitFor(() => {
      const assetNode = result.current.nodes.find((node) => node.id === "assets");
      const sourceGroup = assetNode?.assetGroups?.find(
        (group) => group.source.id === "char-1",
      );
      expect(sourceGroup?.source.mediaPath).toBe(
        "project-file://assets/dugu-source.png",
      );
      expect(sourceGroup?.derived[0]).toMatchObject({
        name: "雨夜破衣",
        mediaPath: "project-file://assets/dugu-rain.png",
        sourceImagePath: "project-file://assets/dugu-source.png",
        imageWorkflowId: "asset-flow-dugu-rain",
        imageWorkflowTarget: {
          kind: "asset",
          assetType: "character",
          parentId: "char-1",
          id: "asset-雨夜破衣",
        },
      });
    });
    expect(window.studioAssets?.add).not.toHaveBeenCalled();
    expect(window.studioAssets?.addImage).not.toHaveBeenCalled();
    expect(window.studioAssets?.saveMaterial).not.toHaveBeenCalled();
  });
});
