import { normalizeContinuityAssetVersion } from "@/lib/studio/visual-continuity";
import type {
  ContinuityAssetVersion,
  ImageWorkflowGraph,
  MediaGenerationTask,
  StudioAgentRun,
  StudioWorkflowConfig,
} from "@/types/studio";

export const STUDIO_WORKFLOW_STORAGE_KEY = "studio-workflow-store";
export const STUDIO_WORKFLOW_PERSIST_VERSION = 11;

/**
 * B+ 收口终清(v11,1011):旧段键(storySkeleton/adaptationStrategy 及其 Review)
 * 的存量 agentWorkData 条目在迁移期滤除——UI 归档位已拆、类型联合已收,
 * 留在盘上只占分片体积。其他键原样保留。
 */
const LEGACY_SCRIPT_STAGE_WORK_KEYS = new Set([
  "storySkeleton",
  "storySkeletonReview",
  "adaptationStrategy",
  "adaptationStrategyReview",
]);

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
    if (node.type !== "reference" && node.type !== "generated") continue;
    // 判别式直取替代 node[field] 关联索引(联合类型下 TS7053)
    const field = node.type === "reference" ? "imageUrl" : "resultUrl";
    const mediaUrl = node.type === "reference" ? node.imageUrl : node.resultUrl;
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

function isLegacyStoryboardWorkflow(graph: unknown): boolean {
  if (!graph || typeof graph !== "object") return false;
  const record = graph as { target?: { kind?: unknown }; targetSourceFingerprint?: unknown };
  return record.target?.kind === "storyboard" && typeof record.targetSourceFingerprint !== "string";
}

/**
 * 上一代遗留分镜工作流清理(2026-08-30 用户裁定:不要旧流):
 * storyboard 目标且无 targetSourceFingerprint 的流属于被替换的旧分镜表,
 * 水合时直接丢弃。新流恒带指纹(切换链/绑定分镜均盖章),此过滤不会再误伤。
 * 从 state 删除后分片存储按 manifest 原子换新+清孤儿,磁盘同步清理。
 */
function isEmptyNonStoryboardWorkflow(graph: unknown): boolean {
  if (!graph || typeof graph !== "object") return false;
  const record = graph as { target?: { kind?: unknown }; nodes?: unknown[] };
  return record.target?.kind !== "storyboard" && !Array.isArray(record.nodes) || (record.target?.kind !== "storyboard" && record.nodes?.length === 0);
}

function isOrphanedStoryboardWorkflow(graph: unknown, storyboardIds: Set<string>): boolean {
  if (!graph || typeof graph !== "object") return false;
  const record = graph as { target?: { kind?: unknown; id?: unknown } };
  return record.target?.kind === "storyboard"
    && typeof record.target.id === "string"
    && !storyboardIds.has(record.target.id);
}

/**
 * 旧数据清理(2026-08-30 用户裁定:反复迭代的不一致性产物一次清):
 * - 空 非 分镜 流(零节点,如误建的「图像工作流 N」)——空壳无信息,资产域可按需重建
 * - 孤儿分镜流:目标分镜 id 已不在当前分镜表(迭代换代遗留,实测 78 条中 44 条)。
 *   流内成图文件与素材库不受影响(素材域独立持久化)。
 * 孤儿判定守卫:分镜表缺失或为空窗口时跳过(防误伤;分镜流与分镜表同窗口
 * 水合,自洽)。磁盘清理由分片写回 manifest 换新+清孤儿兜底。
 */
export function dropStaleImageWorkflows(
  value: unknown,
  storyboards: unknown,
): ImageWorkflowGraph[] {
  if (!Array.isArray(value)) return [];
  const storyboardIds = new Set(
    Array.isArray(storyboards)
      ? storyboards
          .map((item) => (item && typeof item === "object" ? (item as { id?: unknown }).id : undefined))
          .filter((id): id is string => typeof id === "string")
      : [],
  );
  const hasStoryboardWindow = storyboardIds.size > 0;
  let emptyDropped = 0;
  let orphanDropped = 0;
  const kept = value.filter((graph) => {
    if (!graph || typeof graph !== "object") return false;
    if (isEmptyNonStoryboardWorkflow(graph)) {
      emptyDropped += 1;
      return false;
    }
    if (hasStoryboardWindow && isOrphanedStoryboardWorkflow(graph, storyboardIds)) {
      orphanDropped += 1;
      return false;
    }
    return true;
  });
  if (emptyDropped || orphanDropped) {
    console.warn(
      `[studio-store] 清理旧工作流数据:空流 ${emptyDropped} 条,孤儿分镜流 ${orphanDropped} 条(反复迭代不一致性产物)`,
    );
  }
  return kept as ImageWorkflowGraph[];
}

export function dropLegacyStoryboardWorkflows(value: unknown): ImageWorkflowGraph[] {
  if (!Array.isArray(value)) return [];
  const kept = value.filter((graph) => {
    if (!graph || typeof graph !== "object") return false;
    return !isLegacyStoryboardWorkflow(graph);
  });
  if (kept.length !== value.length) {
    console.warn(
      `[studio-store] dropped ${value.length - kept.length} legacy storyboard image workflow(s) without targetSourceFingerprint`,
    );
  }
  return kept as ImageWorkflowGraph[];
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
    imageWorkflows: dropStaleImageWorkflows(
      dropLegacyStoryboardWorkflows(filterPersistedImageWorkflows(state.imageWorkflows)),
      state.storyboards,
    ),
    agentRuns: state.agentRuns ?? [],
    mediaTasks: state.mediaTasks ?? [],
    eventGraph: state.eventGraph ?? [],
    projectMemoryRecords: state.projectMemoryRecords ?? [],
    sceneSegments: state.sceneSegments ?? [],
    agentWorkData: Array.isArray(state.agentWorkData)
      ? state.agentWorkData.filter((item) => {
          const key = (item as { key?: unknown })?.key;
          return typeof key !== "string" || !LEGACY_SCRIPT_STAGE_WORK_KEYS.has(key);
        })
      : state.agentWorkData,
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

/**
 * 水合收割的中断原因(1016 控制球僵尸徽章修复):上一会话退出/崩溃时没走到
 * 终态(finish/fail/cancel)的活跃台账,重启后没有任何在途 runner 会再为它们
 * 落终态——不收割就永久占用悬浮球任务徽章(在案:10-13 directorPlan 僵尸
 * run 挂「1」三天)。
 */
export const STUDIO_LEDGER_REAP_REASON = "应用重启，任务中断";

/** 渲染进程本次会话的启动时刻(模块首载即定):水合回来的台账凡
 * startedAt/createdAt 早于它,必然属于之前的会话(本会话在途的一律晚于它,
 * 切项目触发的重水合零误伤)。 */
export const STUDIO_RENDERER_BOOT_TIME = Date.now();

function isInterruptedActiveEntry(
  item: unknown,
  timeKey: "startedAt" | "createdAt",
  bootTime: number,
): boolean {
  if (!item || typeof item !== "object") return false;
  const record = item as Record<string, unknown>;
  if (typeof record.id !== "string") return false;
  if (record.status !== "queued" && record.status !== "running") return false;
  const startedAt = Number(record[timeKey]);
  // 缺时间戳的老活跃条目按上一会话处理(startAgentRun/startMediaTask 恒写时间戳)
  return Number.isFinite(startedAt) ? startedAt < bootTime : true;
}

export interface ReapInterruptedTaskLedgersInput {
  agentRuns?: unknown;
  mediaTasks?: unknown;
  /** 会话启动时刻(传 STUDIO_RENDERER_BOOT_TIME);早于它的活跃条目才收割。 */
  bootTime: number;
  /** 测试注入的当前时刻;缺省 Date.now()。 */
  now?: number;
}

export interface ReapInterruptedTaskLedgersResult {
  agentRuns?: StudioAgentRun[];
  mediaTasks?: MediaGenerationTask[];
  reapedCount: number;
}

/**
 * 水合期收割上一会话中断的任务台账:agentRuns/mediaTasks 里 status 为
 * queued/running 且时间戳早于 bootTime 的条目改判 failed(STUDIO_LEDGER_REAP_REASON
 * + finishedAt;mediaTasks 连带 updatedAt),其余字段逐字保留(checkpointRef
 * 留给后续断点续跑)。终态条目、非对象/缺 id 的畸形条目、本会话在途条目一律
 * 原样透传;整列表零收割时返回原数组引用(不触发无谓的重渲染与落盘)。
 */
export function reapInterruptedTaskLedgers(
  input: ReapInterruptedTaskLedgersInput,
): ReapInterruptedTaskLedgersResult {
  const now = input.now ?? Date.now();
  let reapedCount = 0;

  const reapArray = (
    // 入参来自持久化水合(input.agentRuns/mediaTasks 声明为 unknown),
    // 数组性由下方 Array.isArray 守卫裁断,形参故取 unknown
    items: unknown,
    timeKey: "startedAt" | "createdAt",
    extra: Record<string, unknown> | undefined,
  ): StudioAgentRun[] | MediaGenerationTask[] | undefined => {
    if (!Array.isArray(items)) return undefined;
    let changed = false;
    const next = items.map((item) => {
      if (!isInterruptedActiveEntry(item, timeKey, input.bootTime)) return item;
      changed = true;
      reapedCount += 1;
      return {
        ...(item as Record<string, unknown>),
        status: "failed",
        errorReason: STUDIO_LEDGER_REAP_REASON,
        finishedAt: now,
        ...(extra ?? {}),
      };
    });
    return (changed ? next : items) as StudioAgentRun[] | MediaGenerationTask[];
  };

  return {
    agentRuns: reapArray(input.agentRuns, "startedAt", undefined) as
      | StudioAgentRun[]
      | undefined,
    mediaTasks: reapArray(input.mediaTasks, "createdAt", { updatedAt: now }) as
      | MediaGenerationTask[]
      | undefined,
    reapedCount,
  };
}
