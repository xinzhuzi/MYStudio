import { useMemo } from "react";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import {
  buildProductionFlowModel,
  type ProductionFlowModel,
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
  const productionFlowAssetMediaById = useMemo(
    () =>
      buildWorkbenchAssetMediaMap(
        productionFlowCharacters,
        productionFlowScenes,
        productionFlowProps,
      ),
    [productionFlowCharacters, productionFlowProps, productionFlowScenes],
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
