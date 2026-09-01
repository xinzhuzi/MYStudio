import os from "node:os";
import type { RemotionChapterRenderRequest, RemotionChapterRenderResult, RemotionChapterSceneRenderRequest, RemotionChapterSceneRenderResult, RemotionChapterSceneSegmentSpec } from "../renderer/remotion-chapter-renderer";
import type { RemotionShotRenderResult, RemotionShotRenderer } from "../renderer/remotion-shot-renderer";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionCurrentSlotV1, RemotionRenderJobV1, RemotionStageStatus } from "@/types/remotion-workspace";

/**
 * Remotion 队列契约——并发常量/硬件感知并发/工作项/快照/事件/持久化/执行器接口族。file-size-reduction P3 拆出,体逐字保留。
 */
export const QUEUE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CONCURRENCY = 1;
/**
 * 队列并发上限(每路=一个 headless-shell 渲染进程,≈2GB 内存 + ≥4 逻辑核)。
 * 并发>1 的语义:多个 shot job 同时渲染;chapter/chapter-scene job 与 shot
 * 同池占槽。缺省仍为 1(单实例串行,测试/桥接兼容);装机 main 按硬件传入。
 */
export const MAX_QUEUE_CONCURRENCY = 4;

/**
 * 硬件感知队列并发:每路渲染按 4 逻辑核 + 8GB 内存预算,取两约束与上限的
 * 最小值,下限 1。M4 128G(14 核)→ 3。
 */
export function resolveHardwareQueueConcurrency(
  { cores, totalMemoryBytes }: { cores: number; totalMemoryBytes: number } = {
    cores: os.availableParallelism(),
    totalMemoryBytes: os.totalmem(),
  },
): number {
  const byCores = Math.floor(cores / 4);
  const byMemory = Math.floor(totalMemoryBytes / (8 * 1024 ** 3));
  return Math.max(1, Math.min(MAX_QUEUE_CONCURRENCY, byCores, byMemory));
}

export interface RemotionQueueShotInput {
  kind: "shot";
  job: RemotionRenderJobV1;
  plan: RemotionShotPlanV1;
}

export interface RemotionQueueChapterInput {
  kind: "chapter";
  job: RemotionRenderJobV1;
  dependencyJobIds: string[];
  plan?: TimelineRenderPlan;
  currentShotSlots?: RemotionCurrentSlotV1[];
}

/** 按场分段 job：与整章 job 同源（同一 plan/slots），但产物落项目根
 * exports/<chapterId>/scenes 相对路径，成功后不发布 current slot、不触发章级 QC 回调。 */
export interface RemotionQueueChapterSceneInput {
  kind: "chapter-scene";
  job: RemotionRenderJobV1;
  dependencyJobIds: string[];
  plan: TimelineRenderPlan;
  currentShotSlots: RemotionCurrentSlotV1[];
  sceneSegment: RemotionChapterSceneSegmentSpec;
}

export type RemotionQueueWorkItem = RemotionQueueShotInput | RemotionQueueChapterInput | RemotionQueueChapterSceneInput;

export type RemotionQueueStateItem = RemotionQueueWorkItem;

export interface RemotionQueueSnapshotV1 {
  schemaVersion: typeof QUEUE_SCHEMA_VERSION;
  lastSeq: number;
  activeProjectId?: string;
  activeChapterId?: string;
  jobs: RemotionQueueStateItem[];
  updatedAt: number;
}

export interface RemotionQueueEventV1 {
  schemaVersion: typeof QUEUE_SCHEMA_VERSION;
  seq: number;
  at: number;
  projectId: string;
  chapterId: string;
  jobId: string;
  item: RemotionQueueStateItem;
  activeProjectId?: string;
  activeChapterId?: string;
}

export interface RemotionQueuePersistence {
  load(): Promise<{ snapshot?: unknown; events: unknown[] }>;
  append(event: RemotionQueueEventV1): Promise<void>;
  writeSnapshot(snapshot: RemotionQueueSnapshotV1): Promise<void>;
}

export interface RemotionQueueExecutor {
  render(plan: RemotionShotPlanV1): Promise<RemotionShotRenderResult>;
  renderChapter?: (input: RemotionChapterRenderRequest) => Promise<RemotionChapterRenderResult>;
  renderChapterScene?: (input: RemotionChapterSceneRenderRequest) => Promise<RemotionChapterSceneRenderResult>;
  cancel(jobId: string): { success: boolean; jobId: string; canceled: boolean; error?: string };
}

export interface RemotionQueueOptions {
  persistence: RemotionQueuePersistence;
  executor: RemotionQueueExecutor | Pick<RemotionShotRenderer, "render" | "cancel">;
  now?: () => number;
  concurrency?: number;
  /** 章节成片 job 成功 commit 后的异步通知(出片后 QC 链挂点)。
   * fire-and-forget:回调抛错被吞掉,绝不影响队列状态;缺省 no-op。 */
  onChapterJobSucceeded?: (identity: {
    projectId: string;
    chapterId: string;
    jobId: string;
    outputPath: string;
  }) => void;
}

export type RemotionQueueEnqueueResult =
  | { accepted: true; job: RemotionRenderJobV1; reused: false }
  | { accepted: false; job: RemotionRenderJobV1; reason: "duplicate-active" | "already-succeeded" }
  | { accepted: false; reason: "blocked" | "invalid"; message: string };

export type RemotionQueueSwitchResult =
  | { allowed: true; fromProjectId?: string; toProjectId: string }
  | { allowed: false; code: "running-jobs" | "queued-jobs" | "cleanup-pending"; jobIds: string[] };

export interface RemotionQueueNotification {
  type: "job";
  projectId: string;
  chapterId: string;
  jobId: string;
  status: RemotionStageStatus;
}

/**
 * Durable main-process scheduler for Remotion jobs.
 *
 * It owns scheduling state, but not renderer implementation.  The renderer is
 * injected so the queue can be replayed and tested without starting Chromium.
 */
