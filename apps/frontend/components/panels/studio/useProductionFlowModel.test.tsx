// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useProductionFlowModel } from "./useProductionFlowModel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as any).studioAssets;
  useCharacterLibraryStore.getState().reset();
  useSceneStore.getState().reset();
  usePropsLibraryStore.getState().reset();
  useProjectStore.setState({ activeProjectId: "default-project" });
});

describe("useProductionFlowModel", () => {
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
