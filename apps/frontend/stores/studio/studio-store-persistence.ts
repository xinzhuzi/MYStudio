import { normalizeContinuityAssetVersion } from "@/lib/studio/visual-continuity";
import type {
  ContinuityAssetVersion,
  ImageWorkflowGraph,
  StudioWorkflowConfig,
} from "@/types/studio";

export const STUDIO_WORKFLOW_STORAGE_KEY = "studio-workflow-store";
export const STUDIO_WORKFLOW_PERSIST_VERSION = 10;

type PersistedStudioWorkflowState = {
  entityExtractions?: unknown[];
  scriptPlans?: unknown[];
  seriesBible?: unknown;
  sourceBible?: unknown;
  episodeOutlines?: unknown[];
  continuityAssetVersions?: ContinuityAssetVersion[];
  imageWorkflows?: unknown[];
  agentRuns?: unknown[];
  mediaTasks?: unknown[];
  eventGraph?: unknown[];
  projectMemoryRecords?: unknown[];
  sceneSegments?: unknown[];
  workflowConfig?: Partial<StudioWorkflowConfig>;
  [key: string]: unknown;
};

export function assertImageWorkflowGraphMediaPersistable(
  graph: ImageWorkflowGraph,
): void {
  for (const node of graph.nodes) {
    const field = node.type === "reference"
      ? "imageUrl"
      : node.type === "generated"
        ? "resultUrl"
        : null;
    if (!field) continue;

    const mediaUrl = node[field];
    const transientScheme = typeof mediaUrl === "string"
      ? /^(data|blob):/i.exec(mediaUrl)?.[1]?.toLowerCase()
      : undefined;
    if (!transientScheme) continue;

    throw new Error(
      `imageWorkflows[${graph.id}].nodes[${node.id}].${field} 禁止持久化 ${transientScheme}: URL`,
    );
  }
}

function transientImageWorkflowMediaPaths(graph: unknown): string[] {
  if (!graph || typeof graph !== "object") return [];
  const graphRecord = graph as { id?: unknown; nodes?: unknown };
  if (!Array.isArray(graphRecord.nodes)) return [];
  const graphId = typeof graphRecord.id === "string" ? graphRecord.id : "unknown";
  const paths: string[] = [];
  graphRecord.nodes.forEach((node, index) => {
    if (!node || typeof node !== "object") return;
    const nodeRecord = node as { id?: unknown; type?: unknown; imageUrl?: unknown; resultUrl?: unknown };
    const field = nodeRecord.type === "reference"
      ? "imageUrl"
      : nodeRecord.type === "generated"
        ? "resultUrl"
        : null;
    if (!field) return;
    const value = nodeRecord[field];
    if (typeof value === "string" && /^(data|blob):/i.test(value)) {
      const nodeId = typeof nodeRecord.id === "string" ? nodeRecord.id : String(index);
      paths.push(`imageWorkflows[${graphId}].nodes[${nodeId}].${field}`);
    }
  });
  return paths;
}

/**
 * Rehydrate guard for legacy and same-version persisted data. Invalid graphs
 * are rejected as a whole so transient media can never enter the live store;
 * the diagnostic contains only structural paths, never the media payload.
 */
export function filterPersistedImageWorkflows(value: unknown): ImageWorkflowGraph[] {
  if (!Array.isArray(value)) return [];
  return value.filter((graph) => {
    const paths = transientImageWorkflowMediaPaths(graph);
    if (!paths.length) return true;
    console.warn(`[studio-store] rejected transient image workflow media during hydration: ${paths.join(", ")}`);
    return false;
  }) as ImageWorkflowGraph[];
}

export function migrateStudioWorkflowState(persistedState: unknown): unknown {
  if (!persistedState || typeof persistedState !== "object") return persistedState;
  const state = persistedState as PersistedStudioWorkflowState;
  return {
    ...state,
    entityExtractions: state.entityExtractions ?? [],
    scriptPlans: state.scriptPlans ?? [],
    seriesBible: state.seriesBible ?? null,
    sourceBible: typeof state.sourceBible === "string" ? state.sourceBible : "",
    episodeOutlines: state.episodeOutlines ?? [],
    continuityAssetVersions: (state.continuityAssetVersions ?? []).map(normalizeContinuityAssetVersion),
    imageWorkflows: filterPersistedImageWorkflows(state.imageWorkflows),
    agentRuns: state.agentRuns ?? [],
    mediaTasks: state.mediaTasks ?? [],
    eventGraph: state.eventGraph ?? [],
    projectMemoryRecords: state.projectMemoryRecords ?? [],
    sceneSegments: state.sceneSegments ?? [],
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
