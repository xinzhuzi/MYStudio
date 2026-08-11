import { useCallback } from "react";

import type { Episode, ScriptCharacter, ScriptScene, Shot } from "@/types/script";
import { buildArtifactId } from "@/lib/artifacts/artifact-projection";
import { toast } from "sonner";

type SelectedItemType = "character" | "scene" | "shot" | "episode" | null;

interface ScriptCrudActions {
  addEpisodeBundle: (projectId: string, title: string, synopsis?: string) => void;
  updateEpisodeBundle: (projectId: string, episodeIndex: number, updates: { title?: string; synopsis?: string }) => void;
  addScene: (projectId: string, scene: ScriptScene, episodeId?: string) => void;
  updateScene: (projectId: string, sceneId: string, updates: Partial<ScriptScene>) => void;
  addCharacter: (projectId: string, character: ScriptCharacter) => void;
  updateCharacter: (projectId: string, characterId: string, updates: Partial<ScriptCharacter>) => void;
  updateShot: (projectId: string, shotId: string, updates: Partial<Shot>) => void;
}

interface UseScriptCrudActionsOptions extends ScriptCrudActions {
  projectId: string;
  episodes?: Episode[];
  onRequestChapterDeletion?: (chapterId: string) => Promise<void>;
  onRequestArtifactDeletion?: (artifactId: string) => Promise<void>;
  selectedItemId: string | null;
  setSelectedItemId: (id: string | null) => void;
  setSelectedItemType: (type: SelectedItemType) => void;
}

export function useScriptCrudActions({
  projectId,
  episodes,
  onRequestChapterDeletion,
  onRequestArtifactDeletion,
  selectedItemId,
  setSelectedItemId,
  setSelectedItemType,
  addEpisodeBundle,
  updateEpisodeBundle,
  addScene,
  updateScene,
  addCharacter,
  updateCharacter,
  updateShot,
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

  const handleDeleteEpisodeBundle = useCallback(async (episodeIndex: number) => {
    const episode = episodes?.find((item) => item.index === episodeIndex);
    if (!episode) return;

    if (!onRequestChapterDeletion) {
      toast.error("章节删除服务不可用，未执行任何操作");
      return;
    }
    await onRequestChapterDeletion(episode.id);
    clearSelectionIfDeleted(episode.id);
  }, [episodes, onRequestChapterDeletion, clearSelectionIfDeleted]);

  const handleAddScene = useCallback((scene: ScriptScene, episodeId?: string) => {
    addScene(projectId, scene, episodeId);
  }, [projectId, addScene]);

  const handleUpdateScene = useCallback((id: string, updates: Partial<ScriptScene>) => {
    updateScene(projectId, id, updates);
  }, [projectId, updateScene]);

  const handleDeleteScene = useCallback(async (id: string) => {
    if (!onRequestArtifactDeletion) {
      toast.error("产物删除服务不可用，未执行任何操作");
      return;
    }
    await onRequestArtifactDeletion(buildArtifactId("script", "script-scene", id));
    clearSelectionIfDeleted(id);
  }, [onRequestArtifactDeletion, clearSelectionIfDeleted]);

  const handleAddCharacter = useCallback((character: ScriptCharacter) => {
    addCharacter(projectId, character);
  }, [projectId, addCharacter]);

  const handleUpdateCharacter = useCallback((id: string, updates: Partial<ScriptCharacter>) => {
    updateCharacter(projectId, id, updates);
  }, [projectId, updateCharacter]);

  const handleDeleteCharacter = useCallback((_id: string) => {
    toast.error("角色尚无可验证的产物映射，已阻止直接删除");
  }, []);

  const handleUpdateShot = useCallback((id: string, updates: Partial<Shot>) => {
    updateShot(projectId, id, updates);
  }, [projectId, updateShot]);

  const handleDeleteShot = useCallback((_id: string) => {
    toast.error("镜头尚无可验证的产物映射，已阻止直接删除");
  }, []);

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
