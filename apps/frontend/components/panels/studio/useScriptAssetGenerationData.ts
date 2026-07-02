import { useEffect, useMemo, useState } from "react";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import type { StudioAssetSummary } from "@/types/studio-assets";
import {
  ASSET_TYPES,
  summarizeImageRows,
  summarizeRows,
  toRuntimeAssetType,
  uniqueByName,
  type AssetGenerationType,
  type AssetRow,
} from "./script-asset-generation-model";
import {
  getRoleVoiceSpeakerIds,
  resolveRoleVoiceBinding,
} from "./script-asset-voice-binding";

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
  const [assetMatchesByType, setAssetMatchesByType] = useState<
    Record<AssetGenerationType, Record<string, StudioAssetSummary>>
  >({
    character: {},
    scene: {},
    prop: {},
  });

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

  useEffect(() => {
    const requests = ASSET_TYPES.map(({ key }) => ({
      key,
      names: rows[key].map((row) => row.name).filter(Boolean),
    })).filter((request) => request.names.length > 0);

    if (!requests.length || typeof window === "undefined" || !window.studioAssets?.batchMatch) {
      setAssetMatchesByType({ character: {}, scene: {}, prop: {} });
      return;
    }

    let cancelled = false;
    Promise.all(
      requests.map(async ({ key, names }) => {
        const matches = await window.studioAssets?.batchMatch({
          type: toRuntimeAssetType(key),
          names,
        });
        return { key, matches: matches ?? [] };
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const next: Record<AssetGenerationType, Record<string, StudioAssetSummary>> = {
          character: {},
          scene: {},
          prop: {},
        };
        for (const { key, matches } of results) {
          for (const match of matches) {
            if (match.asset?.id) next[key][match.name] = match.asset;
          }
        }
        setAssetMatchesByType(next);
      })
      .catch(() => {
        if (!cancelled) setAssetMatchesByType({ character: {}, scene: {}, prop: {} });
      });

    return () => {
      cancelled = true;
    };
  }, [rows]);

  const resolvedRows = useMemo<Record<AssetGenerationType, AssetRow[]>>(
    () => ({
      character: rows.character.map((row) => ({
        ...row,
        assetLibrary: assetMatchesByType.character[row.name],
        assetLibraryId: assetMatchesByType.character[row.name]?.id,
      })),
      scene: rows.scene.map((row) => ({
        ...row,
        assetLibrary: assetMatchesByType.scene[row.name],
        assetLibraryId: assetMatchesByType.scene[row.name]?.id,
      })),
      prop: rows.prop.map((row) => ({
        ...row,
        assetLibrary: assetMatchesByType.prop[row.name],
        assetLibraryId: assetMatchesByType.prop[row.name]?.id,
      })),
    }),
    [assetMatchesByType, rows],
  );

  const stats = useMemo(
    () => ({
      character: summarizeRows(resolvedRows.character),
      scene: summarizeRows(resolvedRows.scene),
      prop: summarizeRows(resolvedRows.prop),
    }),
    [resolvedRows],
  );
  const currentRows = resolvedRows[activeType];
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
    for (const row of resolvedRows.character) {
      const resolution = resolveRoleVoiceBinding(
        getRoleVoiceSpeakerIds(row),
        bindings,
        voiceProfiles,
      );
      if (resolution.state === "assigned") assigned += 1;
    }
    return { assigned, total: resolvedRows.character.length };
  }, [activeTtsProjectId, resolvedRows.character, ttsProjects, voiceProfiles]);

  return {
    activeProjectId,
    currentImageStats,
    currentRows,
    currentStats,
    entityExtractions,
    rows: resolvedRows,
    scriptPlans,
    stats,
    visualManualId,
    voiceStats,
  };
}
