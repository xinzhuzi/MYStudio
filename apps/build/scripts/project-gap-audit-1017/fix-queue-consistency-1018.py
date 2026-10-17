from pathlib import Path
p=Path('apps/frontend/electron/rendering/plugins/remotion/queue/remotion-render-queue.ts')
s=p.read_text().replace('  private initialized = false;','''  private initialized = false;
  private initPromise?: Promise<void>;
  private commitTail: Promise<unknown> = Promise.resolve();
  private persistenceError?: string;
  private readonly cancellationPending = new Set<string>();
  private readonly restoredEvents = new Map<number, string>();''')
a=s.index('  async init():');b=s.index('\n  async enqueueShot',a)
s=s[:a]+'''  getPersistenceError(): string | undefined { return this.persistenceError; }

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    if (this.initialized) return;
    const run = (async () => {
      try {
        const loaded = await this.options.persistence.load();
        if (loaded.snapshot !== undefined) this.restoreSnapshot(loaded.snapshot);
        for (const rawEvent of loaded.events) this.restoreEvent(rawEvent);
        await this.validateRestoredItems();
        await this.recoverInterruptedJobs();
        this.initialized = true;
        this.schedulePump();
      } catch (error) {
        this.jobs.clear(); this.sequence = 0; this.restoredEvents.clear();
        this.activeProjectId = undefined; this.activeChapterId = undefined;
        this.initialized = false;
        throw new Error(`Remotion 队列恢复失败，已暂停全局自动渲染并保留原文件：${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    this.initPromise = run;
    try { await run; }
    finally { if (this.initPromise === run) this.initPromise = undefined; }
  }
''' + s[b:]
a=s.index('  cancel(jobId:');b=s.index('\n  getJobs(',a)
s=s[:a]+'''  async cancel(jobId: string): Promise<{ success: boolean; jobId: string; canceled: boolean; error?: string }> {
    this.cancellationPending.add(jobId);
    try {
      await this.init();
      await this.commitTail;
      const item = this.jobs.get(jobId);
      if (!item) return { success: false, jobId, canceled: false, error: `未找到 Remotion job: ${jobId}` };
      if (["succeeded", "failed", "canceled", "stale"].includes(item.job.status)) {
        return { success: false, jobId, canceled: false, error: `Remotion job 不在可取消状态: ${item.job.status}` };
      }
      if (item.job.status !== 'running' || !this.activeJobIds.has(jobId)) {
        await this.cancelQueued(item);
        return { success: true, jobId, canceled: true };
      }
      const result = this.options.executor.cancel(jobId);
      return result.success ? result : { ...result, error: result.error ?? 'Remotion job 取消失败' };
    } catch (error) {
      return { success: false, jobId, canceled: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.cancellationPending.delete(jobId);
    }
  }
''' + s[b:]
s=s.replace('&& !this.reservedJobIds.has(item.job.jobId));','&& !this.reservedJobIds.has(item.job.jobId)\n        && !this.cancellationPending.has(item.job.jobId));')
s=s.replace('''      const queued = transitionOrThrow(next.job, { status: "queued", at: this.now() });
      await this.commit({ ...next, job: queued });
      running = transitionOrThrow(queued, { status: "running", at: this.now() });
      await this.commit({ ...next, job: running });
      this.activeJobIds.add(running.jobId);''','''      if (this.cancellationPending.has(next.job.jobId)) return;
      const queued = transitionOrThrow(next.job, { status: "queued", at: this.now() });
      if (!await this.commit({ ...next, job: queued }, ['ready', 'queued'])) return;
      if (this.cancellationPending.has(next.job.jobId) || this.jobs.get(next.job.jobId)?.job.status === 'canceled') return;
      running = transitionOrThrow(queued, { status: "running", at: this.now() });
      if (!await this.commit({ ...next, job: running }, ['queued'])) return;
      if (this.cancellationPending.has(next.job.jobId) || this.jobs.get(next.job.jobId)?.job.status === 'canceled') return;
      this.activeJobIds.add(running.jobId);''')
s=s.replace('''    const next: RemotionRenderJobV1 = {
      ...item.job,
      status: "canceled",''','''    const transitioned = transitionOrThrow({ ...item.job, attempt: Math.max(1, item.job.attempt) }, {
      status: 'canceled', at: this.now(),
      error: { code: 'user-canceled', message: '用户取消了 Remotion job', stage: item.kind === 'shot' ? 'S4' : 'S7' },
    });
    const next: RemotionRenderJobV1 = {
      ...transitioned,
      status: "canceled",''')
s=s.replace('''    for (const chapter of chapters) {
      const dependencyStatus''','''    for (const chapter of chapters) {
      // Terminal jobs stay terminal until explicit retry; dependency updates cannot resurrect them.
      if (['canceled', 'failed', 'succeeded', 'stale'].includes(chapter.job.status)) continue;
      const dependencyStatus''')
a=s.index('  private async commit(');b=s.index('\n  private async writeSnapshot',a)
s=s[:a]+'''  private commit(item: RemotionQueueStateItem, expectedStatuses?: readonly string[]): Promise<boolean> {
    const run = this.commitTail.then(async () => {
      const previous = this.jobs.get(item.job.jobId);
      if (expectedStatuses && (!previous || !expectedStatuses.includes(previous.job.status) || this.cancellationPending.has(item.job.jobId))) return false;
      const event: RemotionQueueEventV1 = {
        schemaVersion: QUEUE_SCHEMA_VERSION, seq: this.sequence + 1, at: this.now(),
        projectId: item.job.projectId, chapterId: targetChapterId(item.job.target), jobId: item.job.jobId, item,
        ...(this.activeProjectId ? { activeProjectId: this.activeProjectId } : {}),
        ...(this.activeChapterId ? { activeChapterId: this.activeChapterId } : {}),
      };
      // Successful append is the durable commit point. A failed snapshot must
      // never turn an already committed succeeded job into a rendering failure.
      await this.options.persistence.append(event);
      this.sequence = event.seq;
      this.jobs.set(item.job.jobId, item);
      await this.writeSnapshot();
      this.emit(item.job);
      return true;
    });
    this.commitTail = run.then(() => undefined, () => undefined);
    return run;
  }
''' + s[b:]
a=s.index('  private async writeSnapshot');b=s.index('\n  private emit(',a)
s=s[:a]+'''  private async writeSnapshot(): Promise<void> {
    try {
      await this.options.persistence.writeSnapshot({
        schemaVersion: QUEUE_SCHEMA_VERSION, lastSeq: this.sequence,
        ...(this.activeProjectId ? { activeProjectId: this.activeProjectId } : {}),
        ...(this.activeChapterId ? { activeChapterId: this.activeChapterId } : {}),
        jobs: [...this.jobs.values()], updatedAt: this.now(),
      });
      this.persistenceError = undefined;
    } catch (error) {
      this.persistenceError = `事件日志已保存，队列快照保存失败，将在下次状态更新时重试：${error instanceof Error ? error.message : String(error)}`;
      console.error('[remotion-queue]', this.persistenceError);
    }
  }
''' + s[b:]
s=s.replace('    for (const listener of this.listeners) listener(notification);', '''    for (const listener of this.listeners) {
      try { listener(notification); }
      catch (error) { console.error('[remotion-queue] notification failed:', error); }
    }''')
s=s.replace('if (typeof lastSeq !== "number")', 'if (typeof lastSeq !== "number" || lastSeq < 0)')
s=s.replace('''    if (seq <= this.sequence) return;''','''    const fingerprint = JSON.stringify(value);
    const seen = this.restoredEvents.get(seq);
    if (seen !== undefined && seen !== fingerprint) throw new Error(`Remotion queue 历史序号冲突: ${seq}`);
    this.restoredEvents.set(seq, fingerprint);
    if (seq <= this.sequence) return;''')
p.write_text(s)
p=Path('apps/frontend/lib/studio/remotion/remotion-workspace-state.ts');s=p.read_text().replace('blocked: new Set(["blocked", "ready", "failed", "stale"])','blocked: new Set(["blocked", "ready", "failed", "stale", "canceled"])').replace('ready: new Set(["ready", "queued", "blocked", "stale"])','ready: new Set(["ready", "queued", "blocked", "stale", "canceled"])');p.write_text(s)
