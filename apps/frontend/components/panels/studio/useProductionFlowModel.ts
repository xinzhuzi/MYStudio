import { useEffect, useMemo, useState } from "react";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import {
  buildAssetLibraryMatchNamesForProductionFlow,
  buildAssetLibraryMediaMapForProductionFlow,
  buildProductionFlowModel,
  type ProductionFlowModel,
  type ProductionFlowAssetLibraryMatches,
} from "./workflow-node-model";
import { buildWorkbenchAssetMediaMap } from "./WorkbenchTab";

type ProductionFlowModelInput = Omit<
  Parameters<typeof buildProductionFlowModel>[0],
  "assetMediaById"
>;

export function useProductionFlowModel({
  agentWorkData,
  entityExtractions,
  scriptPlans,
  storyboards,
  productionTracks,
  videoCandidates,
  workflowConfig,
  manualCatalog,
}: ProductionFlowModelInput): ProductionFlowModel {
  const productionFlowCharacters = useCharacterLibraryStore(
    (state) => state.characters,
  );
  const productionFlowScenes = useSceneStore((state) => state.scenes);
  const productionFlowProps = usePropsLibraryStore((state) => state.items);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projectAssetMediaById = useMemo(
    () =>
      buildWorkbenchAssetMediaMap(
        filterProjectItems(productionFlowCharacters, activeProjectId),
        filterProjectItems(productionFlowScenes, activeProjectId),
        filterProjectItems(productionFlowProps, activeProjectId),
      ),
    [
      activeProjectId,
      productionFlowCharacters,
      productionFlowProps,
      productionFlowScenes,
    ],
  );
  const assetLibraryMatchNames = useMemo(
    () =>
      buildAssetLibraryMatchNamesForProductionFlow({
        entityExtractions,
        scriptPlans,
      }),
    [entityExtractions, scriptPlans],
  );
  const [assetLibraryMatches, setAssetLibraryMatches] =
    useState<ProductionFlowAssetLibraryMatches>({
      role: {},
      scene: {},
      tool: {},
    });

  useEffect(() => {
    let cancelled = false;
    async function loadAssetLibraryMatches() {
      const batchMatch = window.studioAssets?.batchMatch;
      if (!batchMatch) {
        setAssetLibraryMatches({ role: {}, scene: {}, tool: {} });
        return;
      }
      const nextMatches: ProductionFlowAssetLibraryMatches = {
        role: {},
        scene: {},
        tool: {},
      };
      for (const kind of ["role", "scene", "tool"] as const) {
        const names = assetLibraryMatchNames[kind];
        if (!names.length) continue;
        const results = await batchMatch({ type: kind, names });
        const bucket = nextMatches[kind]!;
        for (const result of results) {
          if (result.asset) bucket[result.name] = result.asset;
        }
      }
      if (!cancelled) setAssetLibraryMatches(nextMatches);
    }
    void loadAssetLibraryMatches().catch(() => {
      if (!cancelled) {
        setAssetLibraryMatches({ role: {}, scene: {}, tool: {} });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [assetLibraryMatchNames]);

  const assetLibraryMediaById = useMemo(
    () =>
      buildAssetLibraryMediaMapForProductionFlow({
        entityExtractions,
        scriptPlans,
        matchesByType: assetLibraryMatches,
      }),
    [assetLibraryMatches, entityExtractions, scriptPlans],
  );
  const productionFlowAssetMediaById = useMemo(
    () => ({
      ...assetLibraryMediaById,
      ...projectAssetMediaById,
    }),
    [assetLibraryMediaById, projectAssetMediaById],
  );
  return useMemo(
    () =>
      buildProductionFlowModel({
        agentWorkData,
        entityExtractions,
        scriptPlans,
        storyboards,
        productionTracks,
        videoCandidates,
        workflowConfig,
        manualCatalog,
        assetMediaById: productionFlowAssetMediaById,
      }),
    [
      agentWorkData,
      entityExtractions,
      productionFlowAssetMediaById,
      productionTracks,
      scriptPlans,
      storyboards,
      videoCandidates,
      workflowConfig,
      manualCatalog,
    ],
  );
}

function filterProjectItems<T extends { projectId?: string }>(
  items: T[],
  projectId: string | null,
) {
  return projectId ? items.filter((item) => item.projectId === projectId) : items;
}
