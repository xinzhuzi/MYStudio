import { useCallback } from "react";

import type { Episode, ScriptCharacter, ScriptScene, Shot } from "@/types/script";

type SelectedItemType = "character" | "scene" | "shot" | "episode" | null;

interface ScriptCrudActions {
  addEpisodeBundle: (projectId: string, title: string, synopsis?: string) => void;
  updateEpisodeBundle: (projectId: string, episodeIndex: number, updates: { title?: string; synopsis?: string }) => void;
  deleteEpisodeBundle: (projectId: string, episodeIndex: number) => void;
  addScene: (projectId: string, scene: ScriptScene, episodeId?: string) => void;
  updateScene: (projectId: string, sceneId: string, updates: Partial<ScriptScene>) => void;
  deleteScene: (projectId: string, sceneId: string) => void;
  addCharacter: (projectId: string, character: ScriptCharacter) => void;
  updateCharacter: (projectId: string, characterId: string, updates: Partial<ScriptCharacter>) => void;
  deleteCharacter: (projectId: string, characterId: string) => void;
  updateShot: (projectId: string, shotId: string, updates: Partial<Shot>) => void;
  deleteShot: (projectId: string, shotId: string) => void;
}

interface UseScriptCrudActionsOptions extends ScriptCrudActions {
  projectId: string;
  episodes?: Episode[];
  selectedItemId: string | null;
  setSelectedItemId: (id: string | null) => void;
  setSelectedItemType: (type: SelectedItemType) => void;
}

export function useScriptCrudActions({
  projectId,
  episodes,
  selectedItemId,
  setSelectedItemId,
  setSelectedItemType,
  addEpisodeBundle,
  updateEpisodeBundle,
  deleteEpisodeBundle,
  addScene,
  updateScene,
  deleteScene,
  addCharacter,
  updateCharacter,
  deleteCharacter,
  updateShot,
  deleteShot,
}: UseScriptCrudActionsOptions) {
  const clearSelectionIfDeleted = useCallback((id: string) => {
    if (selectedItemId !== id) return;
    setSelectedItemId(null);
    setSelectedItemType(null);
  }, [selectedItemId, setSelectedItemId, setSelectedItemType]);

  const handleAddEpisodeBundle = useCallback((title: string, synopsis: string) => {
    addEpisodeBundle(projectId, title, synopsis);
  }, [projectId, addEpisodeBundle]);

  const handleUpdateEpisodeBundle = useCallback((episodeIndex: number, updates: { title?: string; synopsis?: string }) => {
    updateEpisodeBundle(projectId, episodeIndex, updates);
  }, [projectId, updateEpisodeBundle]);

  const handleDeleteEpisodeBundle = useCallback((episodeIndex: number) => {
    deleteEpisodeBundle(projectId, episodeIndex);
    const episode = episodes?.find((item) => item.index === episodeIndex);
    if (episode) clearSelectionIfDeleted(episode.id);
  }, [projectId, deleteEpisodeBundle, episodes, clearSelectionIfDeleted]);

  const handleAddScene = useCallback((scene: ScriptScene, episodeId?: string) => {
    addScene(projectId, scene, episodeId);
  }, [projectId, addScene]);

  const handleUpdateScene = useCallback((id: string, updates: Partial<ScriptScene>) => {
    updateScene(projectId, id, updates);
  }, [projectId, updateScene]);

  const handleDeleteScene = useCallback((id: string) => {
    deleteScene(projectId, id);
    clearSelectionIfDeleted(id);
  }, [projectId, deleteScene, clearSelectionIfDeleted]);

  const handleAddCharacter = useCallback((character: ScriptCharacter) => {
    addCharacter(projectId, character);
  }, [projectId, addCharacter]);

  const handleUpdateCharacter = useCallback((id: string, updates: Partial<ScriptCharacter>) => {
    updateCharacter(projectId, id, updates);
  }, [projectId, updateCharacter]);

  const handleDeleteCharacter = useCallback((id: string) => {
    deleteCharacter(projectId, id);
    clearSelectionIfDeleted(id);
  }, [projectId, deleteCharacter, clearSelectionIfDeleted]);

  const handleUpdateShot = useCallback((id: string, updates: Partial<Shot>) => {
    updateShot(projectId, id, updates);
  }, [projectId, updateShot]);

  const handleDeleteShot = useCallback((id: string) => {
    deleteShot(projectId, id);
    clearSelectionIfDeleted(id);
  }, [projectId, deleteShot, clearSelectionIfDeleted]);

  return {
    handleAddEpisodeBundle,
    handleUpdateEpisodeBundle,
    handleDeleteEpisodeBundle,
    handleAddScene,
    handleUpdateScene,
    handleDeleteScene,
    handleAddCharacter,
    handleUpdateCharacter,
    handleDeleteCharacter,
    handleUpdateShot,
    handleDeleteShot,
  };
}
