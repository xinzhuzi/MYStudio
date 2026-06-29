import { useMemo } from "react";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import type { TtsSpeakerId } from "@/types/tts";
import {
  summarizeImageRows,
  summarizeRows,
  uniqueByName,
  type AssetGenerationType,
  type AssetRow,
} from "./script-asset-generation-model";

export function useScriptAssetGenerationData(activeType: AssetGenerationType) {
  const visualManualId = useStudioStore((state) => state.workflowConfig.visualManualId);
  const entityExtractions = useStudioStore((state) => state.entityExtractions);
  const scriptPlans = useStudioStore((state) => state.scriptPlans);
  const characters = useCharacterLibraryStore((state) => state.characters);
  const scenes = useSceneStore((state) => state.scenes);
  const props = usePropsLibraryStore((state) => state.items);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeTtsProjectId = useTtsStore((state) => state.activeProjectId);
  const ttsProjects = useTtsStore((state) => state.projects);
  const voiceProfiles = useTtsStore((state) => state.voiceProfiles);

  const rows = useMemo(() => {
    const characterByName = uniqueByName(characters);
    const sceneByName = uniqueByName(scenes);
    const propByName = uniqueByName(props);
    const next: Record<AssetGenerationType, AssetRow[]> = {
      character: [],
      scene: [],
      prop: [],
    };
    const seen = {
      character: new Set<string>(),
      scene: new Set<string>(),
      prop: new Set<string>(),
    };

    for (const batch of entityExtractions) {
      for (const item of batch.characters) {
        if (seen.character.has(item.name)) continue;
        seen.character.add(item.name);
        next.character.push({
          type: "character",
          id: item.characterId,
          name: item.name,
          note: item.note,
          asset: characterByName.get(item.name),
        });
      }
      for (const item of batch.scenes) {
        if (seen.scene.has(item.name)) continue;
        seen.scene.add(item.name);
        next.scene.push({
          type: "scene",
          id: item.sceneId,
          name: item.name,
          note: item.note,
          asset: sceneByName.get(item.name),
        });
      }
      for (const item of batch.props) {
        if (seen.prop.has(item.name)) continue;
        seen.prop.add(item.name);
        next.prop.push({
          type: "prop",
          id: item.assetId,
          name: item.name,
          note: item.note,
          asset: propByName.get(item.name),
        });
      }
    }
    return next;
  }, [characters, entityExtractions, props, scenes]);

  const stats = useMemo(
    () => ({
      character: summarizeRows(rows.character),
      scene: summarizeRows(rows.scene),
      prop: summarizeRows(rows.prop),
    }),
    [rows],
  );
  const currentRows = rows[activeType];
  const currentStats = stats[activeType];
  const currentImageStats = useMemo(
    () => summarizeImageRows(currentRows),
    [currentRows],
  );
  const voiceStats = useMemo(() => {
    const bindings = activeTtsProjectId
      ? (ttsProjects[activeTtsProjectId]?.bindings ?? {})
      : {};
    let assigned = 0;
    for (const row of rows.character) {
      const assetId = row.asset?.id ?? row.id;
      const speakerId = `character:${assetId}` as TtsSpeakerId;
      const binding = bindings[speakerId];
      if (binding && voiceProfiles[binding.profileId]) assigned += 1;
    }
    return { assigned, total: rows.character.length };
  }, [activeTtsProjectId, rows.character, ttsProjects, voiceProfiles]);

  return {
    activeProjectId,
    currentImageStats,
    currentRows,
    currentStats,
    entityExtractions,
    rows,
    scriptPlans,
    stats,
    visualManualId,
    voiceStats,
  };
}
