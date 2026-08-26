import { useEffect, useMemo, useState } from "react";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useEditingStore } from "@/stores/editing/editing-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  buildAssetLibraryMatchNamesForProductionFlow,
  buildAssetLibraryMediaMapForProductionFlow,
  buildProductionFlowModel,
  type ProductionFlowModel,
  type ProductionFlowAssetLibraryMatches,
  type ProductionFlowRendererSummary,
} from "./workflow-node-model";
import { buildWorkbenchAssetMediaMap } from "./WorkbenchTab";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { useRemotionQueueScope } from "./useRemotionQueueScope";

type ProductionFlowModelInput = Omit<
  Parameters<typeof buildProductionFlowModel>[0],
  "assetMediaById" | "rendererSummary"
> & { productionEpisodeId: string };

export function useProductionFlowModel({
  productionEpisodeId,
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
  // R1:显式订阅连续性版本,批准/版本变化即重算 stale 徽章(缺省会退化为惰性读,滞后到下次资产库变更)
  const continuityAssetVersions = useStudioStore(
    (state) => state.continuityAssetVersions,
  );
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const requestedRenderer = useAppSettingsStore((state) => state.renderingSettings.renderer);
  const remotionQueueScope = useRemotionQueueScope(activeProjectId ?? undefined, productionEpisodeId);
  const [chapterSharedAudioRoles, setChapterSharedAudioRoles] = useState<Array<"bgm" | "sfx" | "ambience">>([]);
  useEffect(() => {
    let cancelled = false;
    const bridge = typeof window === "undefined" ? undefined : window.remotionChapterManifest;
    if (!bridge || !activeProjectId) {
      setChapterSharedAudioRoles([]);
      return;
    }
    void bridge.read({ projectId: activeProjectId, chapterId: productionEpisodeId }).then((reply) => {
      if (cancelled) return;
      setChapterSharedAudioRoles(reply.status === "ready"
        ? reply.manifest.sharedAudioBindings.map((binding) => binding.role)
        : []);
    }).catch(() => {
      if (!cancelled) setChapterSharedAudioRoles([]);
    });
    return () => { cancelled = true; };
  }, [activeProjectId, productionEpisodeId]);
  const editingProjectId = useEditingStore(
    (state) => state.currentEditingProjectIdByEpisode[productionEpisodeId],
  );
  const editingProject = useEditingStore(
    (state) => editingProjectId ? state.editingProjects[editingProjectId] : undefined,
  );
  const timelineRenderRecord = useEditingStore(
    (state) => editingProjectId
      ? state.timelineRenderRecordsByEditingProjectId[editingProjectId]
      : undefined,
  );
  const rendererSummary = useMemo<ProductionFlowRendererSummary>(() => {
    const evidenceRenderer = timelineRenderRecord?.evidence.renderer;
    const isCurrentRecord = Boolean(
      activeProjectId
      && editingProjectId
      && editingProject
      && timelineRenderRecord
      && evidenceRenderer
      && editingProject.id === editingProjectId
      && editingProject.projectId === activeProjectId
      && editingProject.episodeId === productionEpisodeId
      && timelineRenderRecord.projectId === activeProjectId
      && timelineRenderRecord.episodeId === productionEpisodeId
      && timelineRenderRecord.editingProjectId === editingProjectId
      && timelineRenderRecord.editingRevision === editingProject.revision
      && timelineRenderRecord.sourceSnapshotHash === editingProject.sourceSnapshotHash,
    );
    if (!isCurrentRecord || !timelineRenderRecord || !evidenceRenderer) {
      return { requested: requestedRenderer };
    }
    return {
      requested: requestedRenderer,
      lastRequested: evidenceRenderer.requested,
      actual: evidenceRenderer.actual,
      fallbackEffectIds: evidenceRenderer.fallback?.effectIds,
      lastJobId: timelineRenderRecord.evidence.jobId,
      outputPath: timelineRenderRecord.evidence.path,
    };
  }, [
    activeProjectId,
    editingProject,
    editingProjectId,
    productionEpisodeId,
    requestedRenderer,
    timelineRenderRecord,
  ]);
  const projectAssetMediaById = useMemo(
    () =>
      buildWorkbenchAssetMediaMap(
        filterProjectItems(productionFlowCharacters, activeProjectId),
        filterProjectItems(productionFlowScenes, activeProjectId),
        filterProjectItems(productionFlowProps, activeProjectId),
        continuityAssetVersions,
      ),
    [
      activeProjectId,
      continuityAssetVersions,
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
      const batchMatch = getStudioAssetsBridge()?.batchMatch;
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
        episodeId: productionEpisodeId,
        storyboards,
        productionTracks,
        videoCandidates,
        remotionQueueJobs: remotionQueueScope.jobs,
        remotionQueueConcurrency: remotionQueueScope.concurrency,
        remotionCurrentShotSlots: remotionQueueScope.currentShotSlots,
        remotionQueueLoading: remotionQueueScope.loading,
        remotionQueueError: remotionQueueScope.error,
        chapterSharedAudioRoles,
        workflowConfig,
        manualCatalog,
        rendererSummary,
        assetMediaById: productionFlowAssetMediaById,
      }),
    [
      agentWorkData,
      entityExtractions,
      productionFlowAssetMediaById,
      productionTracks,
      productionEpisodeId,
      scriptPlans,
      storyboards,
      videoCandidates,
      workflowConfig,
      manualCatalog,
      rendererSummary,
      remotionQueueScope.currentShotSlots,
      remotionQueueScope.error,
      remotionQueueScope.jobs,
      remotionQueueScope.concurrency,
      remotionQueueScope.loading,
      chapterSharedAudioRoles,
    ],
  );
}

function filterProjectItems<T extends { projectId?: string }>(
  items: T[],
  projectId: string | null,
) {
  return projectId ? items.filter((item) => item.projectId === projectId) : items;
}
