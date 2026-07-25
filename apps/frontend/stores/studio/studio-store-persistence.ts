import { normalizeContinuityAssetVersion } from "@/lib/studio/visual-continuity";
import type {
  ContinuityAssetVersion,
  StudioWorkflowConfig,
} from "@/types/studio";

export const STUDIO_WORKFLOW_STORAGE_KEY = "studio-workflow-store";
export const STUDIO_WORKFLOW_PERSIST_VERSION = 9;

type PersistedStudioWorkflowState = {
  entityExtractions?: unknown[];
  scriptPlans?: unknown[];
  seriesBible?: unknown;
  episodeOutlines?: unknown[];
  continuityAssetVersions?: ContinuityAssetVersion[];
  imageWorkflows?: unknown[];
  agentRuns?: unknown[];
  mediaTasks?: unknown[];
  eventGraph?: unknown[];
  projectMemoryRecords?: unknown[];
  workflowConfig?: Partial<StudioWorkflowConfig>;
  [key: string]: unknown;
};

export function migrateStudioWorkflowState(persistedState: unknown): unknown {
  if (!persistedState || typeof persistedState !== "object") return persistedState;
  const state = persistedState as PersistedStudioWorkflowState;
  return {
    ...state,
    entityExtractions: state.entityExtractions ?? [],
    scriptPlans: state.scriptPlans ?? [],
    seriesBible: state.seriesBible ?? null,
    episodeOutlines: state.episodeOutlines ?? [],
    continuityAssetVersions: (state.continuityAssetVersions ?? []).map(normalizeContinuityAssetVersion),
    imageWorkflows: state.imageWorkflows ?? [],
    agentRuns: state.agentRuns ?? [],
    mediaTasks: state.mediaTasks ?? [],
    eventGraph: state.eventGraph ?? [],
    projectMemoryRecords: state.projectMemoryRecords ?? [],
    workflowConfig: normalizeWorkflowConfig(state.workflowConfig),
  };
}

export function normalizeWorkflowConfig(
  config: Partial<StudioWorkflowConfig> | undefined,
): StudioWorkflowConfig {
  return {
    ...config,
    visualManualId: config?.visualManualId === "2D_chinese_guofeng"
      ? undefined
      : config?.visualManualId,
    directorManualId: config?.directorManualId === "Xianxia_fantasy"
      ? undefined
      : config?.directorManualId,
  };
}
