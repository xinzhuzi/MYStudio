import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import type { TimelineRenderPlan } from "@/types/editing";
import { validateRemotionShotPlan } from "@/lib/studio/remotion/shot-plan";
import { validateRemotionCurrentSlot } from "@/lib/studio/remotion/remotion-slot-validation";
import { validateRemotionRenderJob, validateRemotionRenderJobIdentity } from "@/lib/studio/remotion/remotion-render-validation";
import type { RemotionCurrentSlotV1, RemotionRenderJobV1 } from "@/types/remotion-workspace";
import type { RemotionChapterRenderResult, RemotionChapterSceneRenderResult, RemotionChapterSceneSegmentSpec } from "../renderer/remotion-chapter-renderer";
import type { RemotionShotRenderResult } from "../renderer/remotion-shot-renderer";
import { DEFAULT_CONCURRENCY, MAX_QUEUE_CONCURRENCY, QUEUE_SCHEMA_VERSION } from "./remotion-queue-contract";
import type { RemotionQueueChapterInput, RemotionQueueChapterSceneInput, RemotionQueueEnqueueResult, RemotionQueueEventV1, RemotionQueueNotification, RemotionQueueOptions, RemotionQueueShotInput, RemotionQueueStateItem, RemotionQueueSwitchResult } from "./remotion-queue-contract";
import { asBlocked, asReady, asStale, invalid, isRecord, optionalString, sameJobIdentity, targetChapterId, transitionOrThrow } from "./remotion-queue-utils";



export class RemotionRenderQueue {
  private readonly jobs = new Map<string, RemotionQueueStateItem>();
  private readonly listeners = new Set<(notification: RemotionQueueNotification) => void>();
  private readonly now: () => number;
  private initialized = false;
  private sequence = 0;
  private activeProjectId: string | undefined;
  private activeChapterId: string | undefined;
  /** 在跑 job(多槽并发);快照/恢复不持久化该集合,重启由 running→ready 兜底。 */
  private readonly activeJobIds = new Set<string>();
  /** 同步预留:drain 启动 runJob 到其落 active 之间存在异步间隙,防重复拾取。 */
  private readonly reservedJobIds = new Set<string>();
  private pump: Promise<void> = Promise.resolve();
  private readonly concurrencySlots: number;

  constructor(private readonly options: RemotionQueueOptions) {
    this.now = options.now ?? Date.now;
    const requested = options.concurrency ?? DEFAULT_CONCURRENCY;
    if (!Number.isInteger(requested) || requested < 1 || requested > MAX_QUEUE_CONCURRENCY) {
      throw new Error(`Remotion 队列并发必须在 1..${MAX_QUEUE_CONCURRENCY} 之间`);
    }
    this.concurrencySlots = requested;
  }

  /** 队列并发槽数(装机=硬件感知值;面板标签透传展示)。 */
  getConcurrency(): number {
    return this.concurrencySlots;
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
      // 中断恢复死锁修复（08-20 真机三连踩）：ready 等待态的存量 job 在 init/
      // activateProject 时因 chapter scope 未设而无人调度；本方法的 ensureScope
      // 是唯一设置 activeChapterId 的入口，duplicate 返回若不泵，存量 ready
      // 将永不渲染（编排 probing 等镜→15 分钟超时）。此处补泵幂等无害。
      this.schedulePump();
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
      // 同 enqueueShot duplicate 补泵（中断恢复的 ready 存量依赖 enqueue 唤醒）。
      this.schedulePump();
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
      if (!input.plan || !input.currentShotSlots) {
        return invalid("chapter job 在依赖成功后必须携带当前 TimelineRenderPlan 与 shot slots");
      }
      job = asReady(job);
    }
    await this.commit({
      kind: "chapter",
      job,
      dependencyJobIds,
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.currentShotSlots ? { currentShotSlots: input.currentShotSlots } : {}),
    });
    if (job.status === "ready") this.schedulePump();
    return { accepted: true, job, reused: false };
  }

  async enqueueChapterScene(input: RemotionQueueChapterSceneInput): Promise<RemotionQueueEnqueueResult> {
    await this.init();
    const jobValidation = await validateRemotionRenderJobIdentity(input.job);
    if (!jobValidation.success) return invalid(jobValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    if (input.job.target.kind !== "chapter-scene") return invalid("chapter-scene 队列 job target 必须是 chapter-scene");
    if (input.job.target.sceneNo !== input.sceneSegment.sceneNo) return invalid("chapter-scene job target 与 sceneSegment.sceneNo 不一致");
    const scopeError = this.ensureScope(input.job.projectId, input.job.target.chapterId);
    if (scopeError) return { accepted: false, reason: "blocked", message: scopeError };
    if (input.dependencyJobIds.some((id) => typeof id !== "string" || !id.trim())) {
      return invalid("chapter-scene dependencyJobIds 必须是非空且唯一的 job ID");
    }
    const dependencyJobIds = [...new Set(input.dependencyJobIds)];
    if (dependencyJobIds.length === 0 || dependencyJobIds.length !== input.dependencyJobIds.length) {
      return invalid("chapter-scene dependencyJobIds 必须是非空且唯一的 job ID");
    }
    const dependencyError = this.validateChapterDependencies(input.job, dependencyJobIds);
    if (dependencyError) return invalid(dependencyError);
    const existing = this.jobs.get(input.job.jobId);
    if (existing) {
      if (existing.kind !== "chapter-scene" || !sameJobIdentity(existing.job, input.job)) return invalid("重复 chapter-scene jobId 绑定了不同的 render identity");
      if (["queued", "running"].includes(existing.job.status)) return { accepted: false, job: existing.job, reason: "duplicate-active" };
      if (existing.job.status === "succeeded") return { accepted: false, job: existing.job, reason: "already-succeeded" };
      this.schedulePump();
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
      job = asReady(job);
    }
    await this.commit({
      kind: "chapter-scene",
      job,
      dependencyJobIds,
      plan: input.plan,
      currentShotSlots: input.currentShotSlots,
      sceneSegment: input.sceneSegment,
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
    // 08-20 修(ready chapter 永不泵):activateProject 清了 activeChapterId,
    // hasRunnableJob 要求两者都有——若有同项目 ready chapter,自动对齐 scope
    // 让 init 的补泵真正可运行(打包版一键成片 enqueue 走 hostedStudio 仅开发版
    // 可用,应用后无入队触点→ready 条目无人消费)。
    const readyChapter = [...this.jobs.values()].find((item) =>
      (item.kind === "chapter" || item.kind === "chapter-scene")
      && item.job.projectId === toProjectId
      && ["ready", "queued"].includes(item.job.status));
    if (readyChapter) {
      this.activeChapterId = readyChapter.job.target.kind === "chapter" || readyChapter.job.target.kind === "chapter-scene"
        ? readyChapter.job.target.chapterId
        : undefined;
    }
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
      if (current === this.pump && this.activeJobIds.size === 0 && this.reservedJobIds.size === 0 && !this.hasRunnableJob()) return;
      // 多槽改造后 runJob 不再驻留 pump 链:pump 恒为已解决 promise,纯微任务
      // 自旋会饿死事件循环(executor 的定时器/IO 永不触发→死锁)。每轮让出
      // 一个宏任务,在跑 job 才能推进。
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private hasRunnableJob(): boolean {
    return this.activeProjectId !== undefined
      && this.activeChapterId !== undefined
      && [...this.jobs.values()].some((item) => (item.kind === "shot" || item.kind === "chapter" || item.kind === "chapter-scene")
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
      // runJob 自带错误处置且不 reject;此处仅兜底 drain 自身(如 transition 异常)
      console.error("[remotion-queue] drain error:", error);
    });
  }

  private async drain(): Promise<void> {
    if (!this.initialized || !this.activeProjectId || !this.activeChapterId) return;
    while (this.activeJobIds.size + this.reservedJobIds.size < this.concurrencySlots) {
      const next = [...this.jobs.values()].find((item) => (item.kind === "shot" || item.kind === "chapter" || item.kind === "chapter-scene")
        && item.job.projectId === this.activeProjectId
        && targetChapterId(item.job.target) === this.activeChapterId
        && ["ready", "queued"].includes(item.job.status)
        && !this.reservedJobIds.has(item.job.jobId));
      if (!next) return;
      this.reservedJobIds.add(next.job.jobId);
      void this.runJob(next).finally(() => {
        this.reservedJobIds.delete(next.job.jobId);
        this.schedulePump();
      });
    }
  }

  /**
   * 单 job 全生命周期(多槽并发下每个实例独立运行,永不 reject):
   * 起跑转移(queued→running)→ executor 派发 → 成功落 slot/失败落 fail →
   * 章依赖刷新。commit/transition 异常兜底为该 job 的 queue-error。
   */
  private async runJob(next: RemotionQueueStateItem): Promise<void> {
    let running: RemotionRenderJobV1 | undefined;
    try {
      const queued = transitionOrThrow(next.job, { status: "queued", at: this.now() });
      await this.commit({ ...next, job: queued });
      running = transitionOrThrow(queued, { status: "running", at: this.now() });
      await this.commit({ ...next, job: running });
      this.activeJobIds.add(running.jobId);
      // 预留使命完成(防 drain 同步启动到 active 落位间的重复拾取):落 active
      // 即解除——否则与 active 双重计数,concurrency 槽实际只放行 ⌈N/2⌉ 个。
      this.reservedJobIds.delete(running.jobId);
      let result: RemotionShotRenderResult | RemotionChapterRenderResult | RemotionChapterSceneRenderResult;
      try {
        if (next.kind === "shot") {
          result = await this.options.executor.render(next.plan);
        } else if (next.kind === "chapter-scene") {
          if ("renderChapterScene" in this.options.executor && this.options.executor.renderChapterScene) {
            result = await this.options.executor.renderChapterScene({
              plan: next.plan,
              currentShotSlots: next.currentShotSlots,
              expectedJobId: running.jobId,
              sceneSegment: next.sceneSegment,
            });
          } else {
            result = { success: false, jobId: running.jobId, canceled: false, error: "chapter-scene job 缺少 executor.renderChapterScene" };
          }
        } else if (next.plan && next.currentShotSlots
          && "renderChapter" in this.options.executor
          && this.options.executor.renderChapter) {
          result = await this.options.executor.renderChapter({
            plan: next.plan,
            currentShotSlots: next.currentShotSlots,
            expectedJobId: running.jobId,
          });
        } else {
          result = { success: false, jobId: running.jobId, canceled: false, error: "chapter job 缺少渲染输入或 executor.renderChapter" };
        }
      } catch (error) {
        result = { success: false, jobId: running.jobId, canceled: false, error: error instanceof Error ? error.message : String(error) };
      }
      this.activeJobIds.delete(running.jobId);
      const latest = this.jobs.get(running.jobId);
      if (!latest) return;
      if (result.success) {
        if ("slot" in result) {
          const slotValidation = validateRemotionCurrentSlot(result.slot);
          if (!slotValidation.success || slotValidation.value.job.jobId !== running.jobId || slotValidation.value.job.status !== "succeeded") {
            await this.fail(latest, "evidence-invalid", "Remotion current slot/evidence 未通过 identity 验证");
          } else {
            await this.commit({ ...latest, job: slotValidation.value.job });
            const succeededChapterId = targetChapterId(latest.job.target);
            if (this.options.onChapterJobSucceeded && succeededChapterId) {
              try {
                this.options.onChapterJobSucceeded({
                  projectId: latest.job.projectId,
                  chapterId: succeededChapterId,
                  jobId: latest.job.jobId,
                  outputPath: slotValidation.value.job.outputPath ?? "",
                });
              } catch {
                // QC 回调失败不影响队列
              }
            }
          }
        } else {
          // chapter-scene 成功：只 commit job（evidence 已由渲染器落盘旁车文件），
          // 不发布 current slot、不触发章级 QC 回调。
          const jobValidation = validateRemotionRenderJob(result.job);
          if (!jobValidation.success || jobValidation.value.jobId !== running.jobId || jobValidation.value.status !== "succeeded") {
            await this.fail(latest, "evidence-invalid", "chapter-scene job 未通过 identity 验证");
          } else {
            await this.commit({ ...latest, job: jobValidation.value });
          }
        }
      } else {
        await this.fail(latest, result.canceled ? "canceled" : "render-failed", result.error);
      }
      await this.refreshChapterDependencies(latest.job.projectId, targetChapterId(latest.job.target));
    } catch (error) {
      if (running) this.activeJobIds.delete(running.jobId);
      const item = this.jobs.get(next.job.jobId) ?? next;
      await this.fail(item, "queue-error", error instanceof Error ? error.message : String(error)).catch(() => undefined);
    }
  }

  private async fail(item: RemotionQueueStateItem, code: string, message: string): Promise<void> {
    const nextStatus = code === "canceled" ? "canceled" : "failed";
    const next = transitionOrThrow(item.job, {
      status: nextStatus,
      at: this.now(),
      error: { code, message, stage: item.kind === "shot" ? "S4" : "S7" },
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
      error: { code: "user-canceled", message: "用户取消了排队中的 Remotion job", stage: item.kind === "shot" ? "S4" : "S7" },
      outputPath: undefined,
      evidencePath: undefined,
    };
    const validation = validateRemotionRenderJob(next);
    if (!validation.success) throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    await this.commit({ ...item, job: next });
    await this.refreshChapterDependencies(next.projectId, targetChapterId(next.target));
  }

  private async refreshChapterDependencies(projectId: string, chapterId: string): Promise<void> {
    const chapters = [...this.jobs.values()].filter((item): item is RemotionQueueChapterInput | RemotionQueueChapterSceneInput =>
      (item.kind === "chapter" || item.kind === "chapter-scene")
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
    if (chapterJob.target.kind !== "chapter" && chapterJob.target.kind !== "chapter-scene") {
      return "chapter dependency 只能属于 chapter/chapter-scene job";
    }
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
    if (!isRecord(value) || (value.kind !== "shot" && value.kind !== "chapter" && value.kind !== "chapter-scene")) throw new Error("Remotion queue item kind 无效");
    const jobResult = validateRemotionRenderJob(value.job);
    if (!jobResult.success) throw new Error(jobResult.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    // A persisted running job has no trustworthy in-memory executor after restart.
    // Requeue it as ready so the scheduler can drain it again safely.
    const restoredJob = jobResult.value.status === "running"
      ? { ...jobResult.value, status: "ready" as const, progress: 0, startedAt: undefined, completedAt: undefined, error: undefined, outputPath: undefined, evidencePath: undefined }
      : jobResult.value;
    if (value.kind === "shot") {
      if (!isRecord(value.plan)) throw new Error("shot queue item 缺少 plan");
      this.jobs.set(restoredJob.jobId, { kind: "shot", job: restoredJob, plan: value.plan as unknown as RemotionShotPlanV1 });
      return;
    }
    if (!Array.isArray(value.dependencyJobIds)
      || value.dependencyJobIds.length === 0
      || value.dependencyJobIds.some((id) => typeof id !== "string" || !id.trim())
      || new Set(value.dependencyJobIds).size !== value.dependencyJobIds.length) {
      throw new Error("chapter queue dependencyJobIds 无效");
    }
    if (value.kind === "chapter-scene") {
      if (!isRecord(value.plan) || !Array.isArray(value.currentShotSlots) || !isRecord(value.sceneSegment)) {
        throw new Error("chapter-scene queue item 缺少 plan/currentShotSlots/sceneSegment");
      }
      this.jobs.set(jobResult.value.jobId, {
        kind: "chapter-scene",
        job: restoredJob,
        dependencyJobIds: value.dependencyJobIds as string[],
        plan: value.plan as unknown as TimelineRenderPlan,
        currentShotSlots: value.currentShotSlots as RemotionCurrentSlotV1[],
        sceneSegment: value.sceneSegment as unknown as RemotionChapterSceneSegmentSpec,
      });
      return;
    }
    const plan = value.plan as TimelineRenderPlan | undefined;
    const currentShotSlots = Array.isArray(value.currentShotSlots)
      ? value.currentShotSlots as RemotionCurrentSlotV1[]
      : undefined;
    this.jobs.set(jobResult.value.jobId, {
      kind: "chapter",
      job: restoredJob,
      dependencyJobIds: value.dependencyJobIds as string[],
      ...(plan ? { plan } : {}),
      ...(currentShotSlots ? { currentShotSlots } : {}),
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
      if (item.kind !== "chapter" && item.kind !== "chapter-scene") continue;
      const dependencyError = this.validateChapterDependencies(item.job, item.dependencyJobIds);
      if (dependencyError) throw new Error(dependencyError);
    }
  }
}



export { DEFAULT_CONCURRENCY, MAX_QUEUE_CONCURRENCY, QUEUE_SCHEMA_VERSION, resolveHardwareQueueConcurrency } from "./remotion-queue-contract";
export type { RemotionQueueChapterInput, RemotionQueueChapterSceneInput, RemotionQueueEnqueueResult, RemotionQueueEventV1, RemotionQueueExecutor, RemotionQueueNotification, RemotionQueueOptions, RemotionQueuePersistence, RemotionQueueShotInput, RemotionQueueSnapshotV1, RemotionQueueStateItem, RemotionQueueSwitchResult, RemotionQueueWorkItem } from "./remotion-queue-contract";
export { asBlocked, asReady, createRemotionQueueFilePersistence, migrateQueueEventsFileIfNeeded, sameJobIdentity, targetChapterId } from "./remotion-queue-utils";
