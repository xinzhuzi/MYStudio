import fs from "node:fs";
import path from "node:path";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import type { TimelineRenderPlan } from "@/types/editing";
import {
  validateRemotionShotPlan,
} from "@/lib/studio/remotion/shot-plan";
import {
  canTransitionRemotionStatus,
  transitionRemotionRenderJob,
} from "@/lib/studio/remotion/remotion-workspace-state";
import { validateRemotionCurrentSlot } from "@/lib/studio/remotion/remotion-slot-validation";
import {
  validateRemotionRenderJob,
  validateRemotionRenderJobIdentity,
} from "@/lib/studio/remotion/remotion-render-validation";
import type {
  RemotionCurrentSlotV1,
  RemotionJobError,
  RemotionRenderJobV1,
  RemotionRenderJobTarget,
  RemotionStageStatus,
} from "@/types/remotion-workspace";
import type {
  RemotionChapterRenderRequest,
  RemotionChapterRenderResult,
} from "../renderer/remotion-chapter-renderer";
import type {
  RemotionShotRenderResult,
  RemotionShotRenderer,
} from "../renderer/remotion-shot-renderer";

const QUEUE_SCHEMA_VERSION = 1 as const;
const DEFAULT_CONCURRENCY = 1;
const MAX_CONCURRENCY = 1;

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
  chapterAudioClipIds?: string[];
}

export type RemotionQueueWorkItem = RemotionQueueShotInput | RemotionQueueChapterInput;

type RemotionQueueStateItem = RemotionQueueWorkItem;

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
  cancel(jobId: string): { success: boolean; jobId: string; canceled: boolean; error?: string };
}

export interface RemotionQueueOptions {
  persistence: RemotionQueuePersistence;
  executor: RemotionQueueExecutor | Pick<RemotionShotRenderer, "render" | "cancel">;
  now?: () => number;
  concurrency?: number;
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
export class RemotionRenderQueue {
  private readonly jobs = new Map<string, RemotionQueueStateItem>();
  private readonly listeners = new Set<(notification: RemotionQueueNotification) => void>();
  private readonly now: () => number;
  private readonly concurrency: number;
  private initialized = false;
  private sequence = 0;
  private activeProjectId: string | undefined;
  private activeChapterId: string | undefined;
  private activeJobId: string | undefined;
  private pump: Promise<void> = Promise.resolve();

  constructor(private readonly options: RemotionQueueOptions) {
    this.now = options.now ?? Date.now;
    const requested = options.concurrency ?? DEFAULT_CONCURRENCY;
    if (!Number.isInteger(requested) || requested < 1 || requested > MAX_CONCURRENCY) {
      throw new Error(`Remotion 队列并发必须在 1..${MAX_CONCURRENCY} 之间`);
    }
    this.concurrency = requested;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const loaded = await this.options.persistence.load();
    if (loaded.snapshot !== undefined) this.restoreSnapshot(loaded.snapshot);
    for (const rawEvent of loaded.events) this.restoreEvent(rawEvent);
    await this.validateRestoredItems();
    this.initialized = true;
    await this.recoverInterruptedJobs();
    this.schedulePump();
  }

  async enqueueShot(input: RemotionQueueShotInput): Promise<RemotionQueueEnqueueResult> {
    await this.init();
    const planValidation = await validateRemotionShotPlan(input.plan);
    if (!planValidation.success) return invalid(planValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    const jobValidation = await validateRemotionRenderJobIdentity(input.job);
    if (!jobValidation.success) return invalid(jobValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    if (input.job.target.kind !== "shot"
      || input.job.projectId !== input.plan.projectId
      || input.job.target.chapterId !== input.plan.chapterId
      || input.job.target.shotId !== input.plan.shot.shotId
      || input.job.target.shotRevision !== input.plan.shot.revision) {
      return invalid("shot job 与 shot plan 的 project/chapter/shot identity 不一致");
    }
    const scopeError = this.ensureScope(input.job.projectId, input.plan.chapterId);
    if (scopeError) return { accepted: false, reason: "blocked", message: scopeError };
    const existing = this.jobs.get(input.job.jobId);
    if (existing) {
      if (existing.kind !== "shot" || !sameJobIdentity(existing.job, input.job)) {
        return invalid("重复 jobId 绑定了不同的 render identity");
      }
      if (existing.job.status === "succeeded") return { accepted: false, job: existing.job, reason: "already-succeeded" };
      if (["queued", "running"].includes(existing.job.status)) {
        return { accepted: false, job: existing.job, reason: "duplicate-active" };
      }
      return { accepted: false, job: existing.job, reason: "duplicate-active" };
    }
    if (!(["ready", "blocked", "stale", "failed", "canceled"].includes(input.job.status))) {
      return invalid("新建队列 job 必须从 ready/blocked/stale/failed/canceled 开始");
    }
    const item: RemotionQueueShotInput = { kind: "shot", job: input.job, plan: input.plan };
    await this.commit(item);
    this.schedulePump();
    return { accepted: true, job: input.job, reused: false };
  }

  async enqueueChapter(input: RemotionQueueChapterInput): Promise<RemotionQueueEnqueueResult> {
    await this.init();
    const jobValidation = await validateRemotionRenderJobIdentity(input.job);
    if (!jobValidation.success) return invalid(jobValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    if (input.job.target.kind !== "chapter") return invalid("chapter 队列 job target 必须是 chapter");
    const scopeError = this.ensureScope(input.job.projectId, input.job.target.chapterId);
    if (scopeError) return { accepted: false, reason: "blocked", message: scopeError };
    if (input.dependencyJobIds.some((id) => typeof id !== "string" || !id.trim())) {
      return invalid("chapter dependencyJobIds 必须是非空且唯一的 job ID");
    }
    const dependencyJobIds = [...new Set(input.dependencyJobIds)];
    if (dependencyJobIds.length === 0 || dependencyJobIds.length !== input.dependencyJobIds.length) {
      return invalid("chapter dependencyJobIds 必须是非空且唯一的 job ID");
    }
    const dependencyError = this.validateChapterDependencies(input.job, dependencyJobIds);
    if (dependencyError) return invalid(dependencyError);
    const existing = this.jobs.get(input.job.jobId);
    if (existing) {
      if (existing.kind !== "chapter" || !sameJobIdentity(existing.job, input.job)) return invalid("重复 chapter jobId 绑定了不同的 render identity");
      if (["queued", "running"].includes(existing.job.status)) return { accepted: false, job: existing.job, reason: "duplicate-active" };
      if (existing.job.status === "succeeded") return { accepted: false, job: existing.job, reason: "already-succeeded" };
      return { accepted: false, job: existing.job, reason: "duplicate-active" };
    }
    const dependencyStatus = this.getDependencyStatus(dependencyJobIds);
    let job = input.job;
    if (dependencyStatus.failedJobId) {
      job = asBlocked(job, this.now(), {
        code: "chapter-dependency-failed",
        message: `依赖 shot job 失败: ${dependencyStatus.failedJobId}`,
        stage: "S5",
      });
    } else if (!dependencyStatus.allSucceeded) {
      job = asBlocked(job, this.now(), {
        code: "chapter-dependencies-pending",
        message: "等待当前章全部 required shot 成功",
        stage: "S5",
      });
    } else {
      if (!input.plan || !input.currentShotSlots || !input.chapterAudioClipIds) {
        return invalid("chapter job 在依赖成功后必须携带当前 TimelineRenderPlan、shot slots 与 chapter audio allow-list");
      }
      job = asReady(job);
    }
    await this.commit({
      kind: "chapter",
      job,
      dependencyJobIds,
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.currentShotSlots ? { currentShotSlots: input.currentShotSlots } : {}),
      ...(input.chapterAudioClipIds ? { chapterAudioClipIds: input.chapterAudioClipIds } : {}),
    });
    if (job.status === "ready") this.schedulePump();
    return { accepted: true, job, reused: false };
  }

  async retry(jobId: string): Promise<RemotionQueueEnqueueResult> {
    await this.init();
    const item = this.jobs.get(jobId);
    if (!item) return invalid(`未找到 Remotion job: ${jobId}`);
    if (!["failed", "canceled", "stale", "blocked"].includes(item.job.status)) {
      return { accepted: false, job: item.job, reason: item.job.status === "succeeded" ? "already-succeeded" : "duplicate-active" };
    }
    const next = item.job.status === "blocked" || item.job.status === "stale"
      ? asReady(item.job)
      : transitionOrThrow(item.job, { status: "queued", at: this.now() });
    await this.commit({ ...item, job: next });
    this.schedulePump();
    return { accepted: true, job: next, reused: false };
  }

  async markStale(jobId: string, message = "输入、模板或渲染设置已变化"): Promise<boolean> {
    await this.init();
    const item = this.jobs.get(jobId);
    if (!item || item.job.status === "running") return false;
    const next = asStale(item.job, this.now(), {
      code: "input-changed",
      message,
      stage: "S3",
    });
    await this.commit({ ...item, job: next });
    return true;
  }

  cancel(jobId: string): { success: boolean; jobId: string; canceled: boolean; error?: string } {
    const item = this.jobs.get(jobId);
    if (!item) return { success: false, jobId, canceled: false, error: `未找到 Remotion job: ${jobId}` };
    if (["succeeded", "failed", "canceled", "stale"].includes(item.job.status)) {
      return { success: false, jobId, canceled: false, error: `Remotion job 不在可取消状态: ${item.job.status}` };
    }
    if (item.job.status === "ready" || item.job.status === "queued") {
      void this.cancelQueued(item);
      return { success: true, jobId, canceled: true };
    }
    const result = this.options.executor.cancel(jobId);
    return result.success ? result : { ...result, error: result.error ?? "Remotion job 取消失败" };
  }

  getJobs(scope: { projectId: string; chapterId?: string }): RemotionRenderJobV1[] {
    return [...this.jobs.values()]
      .filter((item) => item.job.projectId === scope.projectId
        && (scope.chapterId === undefined || targetChapterId(item.job.target) === scope.chapterId))
      .map((item) => item.job);
  }

  getJob(jobId: string): RemotionRenderJobV1 | undefined {
    return this.jobs.get(jobId)?.job;
  }

  requestProjectSwitch(toProjectId: string): RemotionQueueSwitchResult {
    const fromProjectId = this.activeProjectId;
    if (!fromProjectId || fromProjectId === toProjectId) return { allowed: true, fromProjectId, toProjectId };
    const busy = [...this.jobs.values()].filter((item) => item.job.projectId === fromProjectId
      && ["running", "queued"].includes(item.job.status));
    if (busy.some((item) => item.job.status === "running")) return { allowed: false, code: "running-jobs", jobIds: busy.filter((item) => item.job.status === "running").map((item) => item.job.jobId) };
    if (busy.length > 0) return { allowed: false, code: "queued-jobs", jobIds: busy.map((item) => item.job.jobId) };
    return { allowed: true, fromProjectId, toProjectId };
  }

  async activateProject(toProjectId: string): Promise<RemotionQueueSwitchResult> {
    await this.init();
    const decision = this.requestProjectSwitch(toProjectId);
    if (!decision.allowed) return decision;
    this.activeProjectId = toProjectId;
    this.activeChapterId = undefined;
    await this.writeSnapshot();
    this.schedulePump();
    return decision;
  }

  subscribe(listener: (notification: RemotionQueueNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async waitForIdle(): Promise<void> {
    while (true) {
      const current = this.pump;
      await current;
      if (current === this.pump && !this.activeJobId && !this.hasRunnableJob()) return;
    }
  }

  private hasRunnableJob(): boolean {
    return this.activeProjectId !== undefined
      && this.activeChapterId !== undefined
      && [...this.jobs.values()].some((item) => (item.kind === "shot" || item.kind === "chapter")
        && item.job.projectId === this.activeProjectId
        && targetChapterId(item.job.target) === this.activeChapterId
        && ["ready", "queued"].includes(item.job.status));
  }

  private ensureScope(projectId: string, chapterId: string): string | undefined {
    if (!this.activeProjectId) {
      this.activeProjectId = projectId;
      this.activeChapterId = chapterId;
      return undefined;
    }
    if (this.activeProjectId !== projectId) return `当前活动项目为 ${this.activeProjectId}，不得排入 ${projectId}`;
    if (this.activeChapterId && this.activeChapterId !== chapterId) {
      const busy = [...this.jobs.values()].some((item) => item.job.projectId === projectId && ["running", "queued"].includes(item.job.status));
      if (busy) return `当前章 ${this.activeChapterId} 仍有未完成 job，不得切换到 ${chapterId}`;
      this.activeChapterId = chapterId;
    } else {
      this.activeChapterId = chapterId;
    }
    return undefined;
  }

  private schedulePump(): void {
    this.pump = this.pump.then(() => this.drain()).catch((error) => {
      const jobId = this.activeJobId;
      const item = jobId ? this.jobs.get(jobId) : undefined;
      if (item) {
        void this.fail(item, "queue-error", error instanceof Error ? error.message : String(error)).catch(() => undefined);
      }
    });
  }

  private async drain(): Promise<void> {
    if (!this.initialized || this.activeJobId || !this.activeProjectId || !this.activeChapterId) return;
    const next = [...this.jobs.values()].find((item) => (item.kind === "shot" || item.kind === "chapter")
      && item.job.projectId === this.activeProjectId
      && targetChapterId(item.job.target) === this.activeChapterId
      && ["ready", "queued"].includes(item.job.status));
    if (!next) return;
    const queued = transitionOrThrow(next.job, { status: "queued", at: this.now() });
    await this.commit({ ...next, job: queued });
    const running = transitionOrThrow(queued, { status: "running", at: this.now() });
    await this.commit({ ...next, job: running });
    this.activeJobId = running.jobId;
    let result: RemotionShotRenderResult | RemotionChapterRenderResult;
    try {
      if (next.kind === "shot") {
        result = await this.options.executor.render(next.plan);
      } else if (next.plan && next.currentShotSlots && next.chapterAudioClipIds
        && "renderChapter" in this.options.executor
        && this.options.executor.renderChapter) {
        result = await this.options.executor.renderChapter({
          plan: next.plan,
          currentShotSlots: next.currentShotSlots,
          chapterAudioClipIds: next.chapterAudioClipIds,
        });
      } else {
        result = { success: false, jobId: running.jobId, canceled: false, error: "chapter job 缺少渲染输入或 executor.renderChapter" };
      }
    } catch (error) {
      result = { success: false, jobId: running.jobId, canceled: false, error: error instanceof Error ? error.message : String(error) };
    }
    this.activeJobId = undefined;
    const latest = this.jobs.get(running.jobId);
    if (!latest) return;
    if (result.success) {
      const slotValidation = validateRemotionCurrentSlot(result.slot);
      if (!slotValidation.success || slotValidation.value.job.jobId !== running.jobId || slotValidation.value.job.status !== "succeeded") {
        await this.fail(latest, "evidence-invalid", "Remotion current slot/evidence 未通过 identity 验证");
      } else {
        await this.commit({ ...latest, job: slotValidation.value.job });
      }
    } else {
      await this.fail(latest, result.canceled ? "canceled" : "render-failed", result.error);
    }
    await this.refreshChapterDependencies(latest.job.projectId, targetChapterId(latest.job.target));
    this.schedulePump();
  }

  private async fail(item: RemotionQueueStateItem, code: string, message: string): Promise<void> {
    const nextStatus = code === "canceled" ? "canceled" : "failed";
    const next = transitionOrThrow(item.job, {
      status: nextStatus,
      at: this.now(),
      error: { code, message, stage: item.kind === "chapter" ? "S7" : "S4" },
    });
    await this.commit({ ...item, job: next });
  }

  private async cancelQueued(item: RemotionQueueStateItem): Promise<void> {
    const next: RemotionRenderJobV1 = {
      ...item.job,
      status: "canceled",
      attempt: Math.max(1, item.job.attempt),
      progress: 0,
      completedAt: this.now(),
      error: { code: "user-canceled", message: "用户取消了排队中的 Remotion job", stage: item.kind === "chapter" ? "S7" : "S4" },
      outputPath: undefined,
      evidencePath: undefined,
    };
    const validation = validateRemotionRenderJob(next);
    if (!validation.success) throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    await this.commit({ ...item, job: next });
    await this.refreshChapterDependencies(next.projectId, targetChapterId(next.target));
  }

  private async refreshChapterDependencies(projectId: string, chapterId: string): Promise<void> {
    const chapters = [...this.jobs.values()].filter((item): item is RemotionQueueChapterInput => item.kind === "chapter"
      && item.job.projectId === projectId && targetChapterId(item.job.target) === chapterId);
    for (const chapter of chapters) {
      const dependencyStatus = this.getDependencyStatus(chapter.dependencyJobIds);
      let next = chapter.job;
      if (dependencyStatus.failedJobId) {
        if (next.status !== "blocked") next = asBlocked(next, this.now(), { code: "chapter-dependency-failed", message: `依赖 shot job 失败: ${dependencyStatus.failedJobId}`, stage: "S5" });
      } else if (dependencyStatus.allSucceeded) {
        if (next.status === "blocked") next = asReady(next);
      }
      if (next !== chapter.job) await this.commit({ ...chapter, job: next });
    }
  }

  private getDependencyStatus(jobIds: string[]): { allSucceeded: boolean; failedJobId?: string } {
    let allSucceeded = true;
    for (const jobId of jobIds) {
      const job = this.jobs.get(jobId)?.job;
      if (!job || ["failed", "canceled", "blocked", "stale"].includes(job.status)) return { allSucceeded: false, failedJobId: jobId };
      if (job.status !== "succeeded") allSucceeded = false;
    }
    return { allSucceeded };
  }

  private validateChapterDependencies(
    chapterJob: RemotionRenderJobV1,
    dependencyJobIds: readonly string[],
  ): string | undefined {
    if (chapterJob.target.kind !== "chapter") return "chapter dependency 只能属于 chapter job";
    for (const dependencyJobId of dependencyJobIds) {
      const dependency = this.jobs.get(dependencyJobId);
      if (!dependency) return `chapter dependency job 不存在: ${dependencyJobId}`;
      if (dependency.kind !== "shot" || dependency.job.target.kind !== "shot") {
        return `chapter dependency 必须是 shot job: ${dependencyJobId}`;
      }
      if (dependency.job.projectId !== chapterJob.projectId) {
        return `chapter dependency 不属于当前项目: ${dependencyJobId}`;
      }
      if (dependency.job.target.chapterId !== chapterJob.target.chapterId) {
        return `chapter dependency 不属于当前章节: ${dependencyJobId}`;
      }
    }
    return undefined;
  }

  private async recoverInterruptedJobs(): Promise<void> {
    for (const item of [...this.jobs.values()]) {
      if (item.job.status !== "running") continue;
      const recovered = transitionOrThrow({ ...item.job, outputPath: undefined, evidencePath: undefined }, {
        status: "failed",
        at: this.now(),
        error: { code: "app-restart-recovery", message: "应用退出时 job 处于 running，未将未验证产物视为成功", stage: "S8" },
      });
      await this.commit({ ...item, job: recovered });
    }
  }

  private async commit(item: RemotionQueueStateItem): Promise<void> {
    const event: RemotionQueueEventV1 = {
      schemaVersion: QUEUE_SCHEMA_VERSION,
      seq: this.sequence + 1,
      at: this.now(),
      projectId: item.job.projectId,
      chapterId: targetChapterId(item.job.target),
      jobId: item.job.jobId,
      item,
      ...(this.activeProjectId ? { activeProjectId: this.activeProjectId } : {}),
      ...(this.activeChapterId ? { activeChapterId: this.activeChapterId } : {}),
    };
    await this.options.persistence.append(event);
    this.sequence = event.seq;
    this.jobs.set(item.job.jobId, item);
    this.emit(item.job);
    await this.writeSnapshot();
  }

  private async writeSnapshot(): Promise<void> {
    await this.options.persistence.writeSnapshot({
      schemaVersion: QUEUE_SCHEMA_VERSION,
      lastSeq: this.sequence,
      ...(this.activeProjectId ? { activeProjectId: this.activeProjectId } : {}),
      ...(this.activeChapterId ? { activeChapterId: this.activeChapterId } : {}),
      jobs: [...this.jobs.values()],
      updatedAt: this.now(),
    });
  }

  private emit(job: RemotionRenderJobV1): void {
    const notification = {
      type: "job" as const,
      projectId: job.projectId,
      chapterId: targetChapterId(job.target),
      jobId: job.jobId,
      status: job.status,
    };
    for (const listener of this.listeners) listener(notification);
  }

  private restoreSnapshot(value: unknown): void {
    if (!isRecord(value) || value.schemaVersion !== QUEUE_SCHEMA_VERSION || !Number.isSafeInteger(value.lastSeq) || !Array.isArray(value.jobs)) {
      throw new Error("Remotion queue snapshot 无效");
    }
    const lastSeq = value.lastSeq;
    if (typeof lastSeq !== "number") throw new Error("Remotion queue snapshot lastSeq 无效");
    this.sequence = lastSeq;
    this.activeProjectId = optionalString(value.activeProjectId);
    this.activeChapterId = optionalString(value.activeChapterId);
    for (const rawItem of value.jobs) this.restoreItem(rawItem);
  }

  private restoreEvent(value: unknown): void {
    if (!isRecord(value)) throw new Error("Remotion queue event 无效或顺序不连续");
    const seq = value.seq;
    if (value.schemaVersion !== QUEUE_SCHEMA_VERSION || !Number.isSafeInteger(seq) || typeof seq !== "number" || seq < 1) {
      throw new Error("Remotion queue event 无效或顺序不连续");
    }
    if (seq <= this.sequence) return;
    if (seq !== this.sequence + 1) throw new Error("Remotion queue event 序列不连续");
    this.sequence = seq;
    this.activeProjectId = optionalString(value.activeProjectId) ?? this.activeProjectId;
    this.activeChapterId = optionalString(value.activeChapterId) ?? this.activeChapterId;
    this.restoreItem(value.item);
  }

  private restoreItem(value: unknown): void {
    if (!isRecord(value) || (value.kind !== "shot" && value.kind !== "chapter")) throw new Error("Remotion queue item kind 无效");
    const jobResult = validateRemotionRenderJob(value.job);
    if (!jobResult.success) throw new Error(jobResult.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    if (value.kind === "shot") {
      if (!isRecord(value.plan)) throw new Error("shot queue item 缺少 plan");
      this.jobs.set(jobResult.value.jobId, { kind: "shot", job: jobResult.value, plan: value.plan as unknown as RemotionShotPlanV1 });
      return;
    }
    if (!Array.isArray(value.dependencyJobIds)
      || value.dependencyJobIds.length === 0
      || value.dependencyJobIds.some((id) => typeof id !== "string" || !id.trim())
      || new Set(value.dependencyJobIds).size !== value.dependencyJobIds.length) {
      throw new Error("chapter queue dependencyJobIds 无效");
    }
    const plan = value.plan as TimelineRenderPlan | undefined;
    const currentShotSlots = Array.isArray(value.currentShotSlots)
      ? value.currentShotSlots as RemotionCurrentSlotV1[]
      : undefined;
    const chapterAudioClipIds = Array.isArray(value.chapterAudioClipIds)
      ? value.chapterAudioClipIds.filter((id): id is string => typeof id === "string")
      : undefined;
    this.jobs.set(jobResult.value.jobId, {
      kind: "chapter",
      job: jobResult.value,
      dependencyJobIds: value.dependencyJobIds as string[],
      ...(plan ? { plan } : {}),
      ...(currentShotSlots ? { currentShotSlots } : {}),
      ...(chapterAudioClipIds ? { chapterAudioClipIds } : {}),
    });
  }

  private async validateRestoredItems(): Promise<void> {
    for (const item of this.jobs.values()) {
      const identity = await validateRemotionRenderJobIdentity(item.job);
      if (!identity.success) throw new Error(identity.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      if (item.kind === "shot") {
        const plan = await validateRemotionShotPlan(item.plan);
        if (!plan.success) throw new Error(plan.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      }
    }
    for (const item of this.jobs.values()) {
      if (item.kind !== "chapter") continue;
      const dependencyError = this.validateChapterDependencies(item.job, item.dependencyJobIds);
      if (dependencyError) throw new Error(dependencyError);
    }
  }
}

function targetChapterId(target: RemotionRenderJobTarget): string {
  return target.chapterId;
}

function sameJobIdentity(left: RemotionRenderJobV1, right: RemotionRenderJobV1): boolean {
  return left.projectId === right.projectId
    && JSON.stringify(left.target) === JSON.stringify(right.target)
    && left.inputHash === right.inputHash
    && left.bundleContentHash === right.bundleContentHash
    && left.renderSettingsHash === right.renderSettingsHash;
}

function asReady(job: RemotionRenderJobV1): RemotionRenderJobV1 {
  if (job.status === "ready") return job;
  if (!canTransitionRemotionStatus(job.status, "ready")) throw new Error(`job ${job.jobId} 不允许恢复 ready`);
  return transitionOrThrow(job, { status: "ready", at: Date.now() });
}

function asBlocked(job: RemotionRenderJobV1, at: number, error: RemotionJobError): RemotionRenderJobV1 {
  if (job.status === "blocked") return { ...job, error };
  return transitionOrThrow(job, { status: "blocked", at, error });
}

function asStale(job: RemotionRenderJobV1, at: number, error: RemotionJobError): RemotionRenderJobV1 {
  if (job.status === "stale") return { ...job, error };
  return transitionOrThrow(job, { status: "stale", at, error });
}

function transitionOrThrow(job: RemotionRenderJobV1, transition: {
  status: RemotionStageStatus;
  at: number;
  error?: RemotionJobError;
  outputPath?: string;
  evidencePath?: string;
}): RemotionRenderJobV1 {
  const result = transitionRemotionRenderJob(job, transition);
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  return result.value;
}

function invalid(message: string): { accepted: false; reason: "invalid"; message: string } {
  return { accepted: false, reason: "invalid", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryPath, content, "utf8");
  await fs.promises.rename(temporaryPath, filePath);
}

export function createRemotionQueueFilePersistence(root: string): RemotionQueuePersistence {
  if (!path.isAbsolute(root)) throw new Error("Remotion queue persistence root 必须是绝对路径");
  const eventsPath = path.join(root, "queue-events.jsonl");
  const snapshotPath = path.join(root, "queue-state.json");
  return {
    async load() {
      const snapshot = await readOptionalJson(snapshotPath);
      const rawEvents = await readOptionalText(eventsPath);
      const events = rawEvents
        ? rawEvents.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown)
        : [];
      return { snapshot, events };
    },
    async append(event) {
      const previous = await readOptionalText(eventsPath) ?? "";
      await atomicWrite(eventsPath, `${previous}${JSON.stringify(event)}\n`);
    },
    async writeSnapshot(snapshot) {
      await atomicWrite(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    },
  };
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readOptionalJson(filePath: string): Promise<unknown | undefined> {
  const raw = await readOptionalText(filePath);
  return raw === undefined ? undefined : JSON.parse(raw) as unknown;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
