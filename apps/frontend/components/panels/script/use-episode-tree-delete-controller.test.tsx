// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Episode } from "@/types/script";
import { useEpisodeTreeDeleteController } from "./use-episode-tree-delete-controller";

const episodes: Episode[] = [{
  id: "episode-1",
  index: 7,
  title: "第七集",
  sceneIds: [],
}];

function useDeleteController(overrides: Partial<Parameters<typeof useEpisodeTreeDeleteController>[0]> = {}) {
  return useEpisodeTreeDeleteController({
    episodes,
    onDeleteEpisodeBundle: vi.fn(),
    onDeleteScene: vi.fn(),
    onDeleteCharacter: vi.fn(),
    onDeleteShot: vi.fn(),
    ...overrides,
  });
}

describe("useEpisodeTreeDeleteController", () => {
  it("opens with the selected payload and routes each entity type only after confirmation", () => {
    const onDeleteEpisodeBundle = vi.fn();
    const onDeleteScene = vi.fn();
    const onDeleteCharacter = vi.fn();
    const onDeleteShot = vi.fn();
    const { result } = renderHook(() => useDeleteController({
      onDeleteEpisodeBundle,
      onDeleteScene,
      onDeleteCharacter,
      onDeleteShot,
    }));

    act(() => result.current.handleDelete("episode", "episode-1", "第七集"));
    expect(result.current.deleteDialogOpen).toBe(true);
    expect(result.current.deleteItem).toEqual({ type: "episode", id: "episode-1", name: "第七集" });
    expect(onDeleteEpisodeBundle).not.toHaveBeenCalled();
    act(() => result.current.confirmDelete());

    act(() => result.current.handleDelete("scene", "scene-1", "山门"));
    act(() => result.current.confirmDelete());
    act(() => result.current.handleDelete("character", "character-1", "阿青"));
    act(() => result.current.confirmDelete());
    act(() => result.current.handleDelete("shot", "shot-1", "镜头 1"));
    act(() => result.current.confirmDelete());

    expect(onDeleteEpisodeBundle).toHaveBeenCalledWith(7);
    expect(onDeleteScene).toHaveBeenCalledWith("scene-1");
    expect(onDeleteCharacter).toHaveBeenCalledWith("character-1");
    expect(onDeleteShot).toHaveBeenCalledWith("shot-1");
    expect(result.current.deleteDialogOpen).toBe(false);
    expect(result.current.deleteItem).toBeNull();
  });

  it("closes and clears a missing episode request without dispatching a delete", () => {
    const onDeleteEpisodeBundle = vi.fn();
    const { result } = renderHook(() => useDeleteController({ onDeleteEpisodeBundle }));

    act(() => result.current.handleDelete("episode", "missing", "不存在的集"));
    act(() => result.current.confirmDelete());

    expect(onDeleteEpisodeBundle).not.toHaveBeenCalled();
    expect(result.current.deleteDialogOpen).toBe(false);
    expect(result.current.deleteItem).toBeNull();
  });

  it("does nothing when confirmation has no pending item", () => {
    const { result } = renderHook(() => useDeleteController());

    act(() => result.current.confirmDelete());

    expect(result.current.deleteDialogOpen).toBe(false);
    expect(result.current.deleteItem).toBeNull();
  });
});
