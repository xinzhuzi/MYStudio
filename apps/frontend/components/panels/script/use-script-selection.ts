import { useCallback, useEffect, useMemo, useState } from "react";
import type { EpisodeRawScript, ScriptData, Shot } from "@/types/script";

export type ScriptSelectionType = "character" | "scene" | "shot" | "episode";

type UseScriptSelectionOptions = {
  scriptData: ScriptData | null;
  shots: Shot[];
  episodeRawScripts: EpisodeRawScript[];
  activeEpisodeIndex: number | null | undefined;
  projectId: string;
  enterEpisode: (episodeIndex: number, projectId: string) => void;
};

export function useScriptSelection({
  scriptData,
  shots,
  episodeRawScripts,
  activeEpisodeIndex,
  projectId,
  enterEpisode,
}: UseScriptSelectionOptions) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemType, setSelectedItemType] = useState<ScriptSelectionType | null>(null);

  useEffect(() => {
    if (activeEpisodeIndex == null || !scriptData?.episodes) return;
    const episode = scriptData.episodes.find((item) => item.index === activeEpisodeIndex);
    if (episode) {
      setSelectedItemId(`episode_${activeEpisodeIndex}`);
      setSelectedItemType("episode");
    }
  }, [activeEpisodeIndex, scriptData?.episodes]);

  const selectItem = useCallback((id: string, type: ScriptSelectionType) => {
    setSelectedItemId(id);
    setSelectedItemType(type);
    if (type === "episode" && id.startsWith("episode_")) {
      const episodeIndex = Number.parseInt(id.replace("episode_", ""), 10);
      if (!Number.isNaN(episodeIndex)) {
        enterEpisode(episodeIndex, projectId);
      }
    }
  }, [enterEpisode, projectId]);

  const selection = useMemo(() => {
    const selectedCharacter = selectedItemType === "character"
      ? scriptData?.characters.find((item) => item.id === selectedItemId)
      : undefined;
    const selectedScene = selectedItemType === "scene"
      ? scriptData?.scenes.find((item) => item.id === selectedItemId)
      : undefined;
    const selectedShot = selectedItemType === "shot"
      ? shots.find((item) => item.id === selectedItemId)
      : undefined;
    const selectedEpisode = selectedItemType === "episode" && selectedItemId
      ? (() => {
          const episodeIndex = Number.parseInt(selectedItemId.replace("episode_", ""), 10);
          const rawScript = episodeRawScripts.find((item) => item.episodeIndex === episodeIndex);
          const episode = scriptData?.episodes.find((item) => item.index === episodeIndex);
          return rawScript && episode ? { ...episode, ...rawScript } : undefined;
        })()
      : undefined;
    const selectedSceneShots = selectedItemType === "scene" && selectedItemId
      ? shots.filter((shot) => shot.sceneRefId === selectedItemId || shot.sceneId === selectedItemId)
      : undefined;
    const selectedEpisodeShots = selectedItemType === "episode" && selectedEpisode
      ? shots.filter((shot) => shot.episodeId === selectedEpisode.id)
      : [];

    return {
      selectedCharacter,
      selectedScene,
      selectedShot,
      selectedEpisode,
      selectedSceneShots,
      selectedEpisodeShots,
    };
  }, [episodeRawScripts, scriptData, selectedItemId, selectedItemType, shots]);

  return {
    selectedItemId,
    setSelectedItemId,
    selectedItemType,
    setSelectedItemType,
    selectItem,
    ...selection,
  };
}
