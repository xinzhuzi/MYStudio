// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useScriptCrudActions } from "./use-script-crud-actions";

function createOptions(selectedItemId: string | null = null) {
  return {
    projectId: "project-1",
    episodes: [{ id: "episode-1", index: 1, title: "第一集", sceneIds: [] }],
    onRequestChapterDeletion: vi.fn().mockResolvedValue(undefined),
    onRequestArtifactDeletion: vi.fn().mockResolvedValue(undefined),
    selectedItemId,
    setSelectedItemId: vi.fn(),
    setSelectedItemType: vi.fn(),
    addEpisodeBundle: vi.fn(),
    updateEpisodeBundle: vi.fn(),
    addScene: vi.fn(),
    updateScene: vi.fn(),
    deleteScene: vi.fn(),
    addCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    updateShot: vi.fn(),
    deleteShot: vi.fn(),
  };
}

describe("useScriptCrudActions", () => {
  it("passes the stable project id through CRUD actions", () => {
    const options = createOptions();
    const { result } = renderHook(() => useScriptCrudActions(options));
    const scene = {
      id: "scene-1",
      name: "街道",
      location: "城中",
      time: "白天",
      atmosphere: "平静",
    };
    const character = { id: "character-1", name: "张三" };

    result.current.handleAddEpisodeBundle("标题", "摘要");
    result.current.handleAddScene(scene, "episode-1");
    result.current.handleAddCharacter(character);
    result.current.handleUpdateShot("shot-1", { dialogue: "台词" });

    expect(options.addEpisodeBundle).toHaveBeenCalledWith("project-1", "标题", "摘要");
    expect(options.addScene).toHaveBeenCalledWith("project-1", scene, "episode-1");
    expect(options.addCharacter).toHaveBeenCalledWith("project-1", character);
    expect(options.updateShot).toHaveBeenCalledWith("project-1", "shot-1", { dialogue: "台词" });
  });

  it("does not bypass the shared chapter deletion controller", async () => {
    const options = createOptions("episode-1");
    const { result, rerender } = renderHook(
      ({ current }) => useScriptCrudActions(current),
      { initialProps: { current: options } },
    );

    await result.current.handleDeleteEpisodeBundle(1);
    expect(options.onRequestChapterDeletion).toHaveBeenCalledWith("episode-1");

    const selectedSceneOptions = createOptions("scene-1");
    rerender({ current: selectedSceneOptions });
    await result.current.handleDeleteScene("scene-1");
    expect(selectedSceneOptions.onRequestArtifactDeletion).toHaveBeenCalledWith(
      "script:script-scene:scene-1",
    );
    expect(selectedSceneOptions.deleteScene).not.toHaveBeenCalled();
    expect(selectedSceneOptions.setSelectedItemId).toHaveBeenCalledWith(null);
  });

  it("fails closed for entities without a stable artifact projection", () => {
    const options = createOptions("scene-1");
    const { result } = renderHook(() => useScriptCrudActions(options));

    result.current.handleDeleteCharacter("character-2");
    result.current.handleDeleteShot("shot-2");

    expect(options.deleteCharacter).not.toHaveBeenCalled();
    expect(options.deleteShot).not.toHaveBeenCalled();
    expect(options.onRequestArtifactDeletion).not.toHaveBeenCalled();
    expect(options.setSelectedItemId).not.toHaveBeenCalled();
    expect(options.setSelectedItemType).not.toHaveBeenCalled();
  });
});
