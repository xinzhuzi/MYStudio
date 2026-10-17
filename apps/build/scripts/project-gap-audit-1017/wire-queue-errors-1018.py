from pathlib import Path
import shutil
files=['apps/frontend/electron/rendering/plugins/remotion/queue/remotion-queue-ipc.ts','apps/frontend/electron/ipc/studio/remotion-queue-ipc.ts','apps/frontend/components/panels/studio/useRemotionQueueScope.ts']
for f in files:
 b=Path('apps/output/automation/project-gap-audit-1017/backups-1018')/f;b.parent.mkdir(parents=True,exist_ok=True)
 if not b.exists():shutil.copy2(f,b)
p=Path(files[0]);s=p.read_text().replace('  concurrency?: number;','  concurrency?: number;\n  persistenceError?: string;').replace('    jobs,\n    currentShotSlots,','    jobs,\n    currentShotSlots,\n    ...(typeof value.persistenceError === "string" ? { persistenceError: value.persistenceError } : {}),');p.write_text(s)
p=Path(files[1]);s=p.read_text().replace('      concurrency: queue.getConcurrency(),','      concurrency: queue.getConcurrency(),\n      ...(queue.getPersistenceError() ? { persistenceError: queue.getPersistenceError() } : {}),');p.write_text(s)
p=Path(files[2]);s=p.read_text().replace('          concurrency: scope.concurrency ?? 1,','          concurrency: scope.concurrency ?? 1,\n          ...(scope.persistenceError ? { error: scope.persistenceError } : {}),');p.write_text(s)
p=Path('apps/frontend/components/panels/studio/WorkbenchTab.tsx');s=p.read_text().replace('''      if (action === "retry") await queue.retry(job.jobId);
      else await queue.cancel(job.jobId);''','''      if (action === "retry") {
        const result = await queue.retry(job.jobId);
        if (!result.accepted) throw new Error('message' in result ? result.message : `无法重试：${result.reason}`);
      } else {
        const result = await queue.cancel(job.jobId);
        if (!result.success || !result.canceled) throw new Error(result.error ?? '取消未成功');
      }''').replace('job.status === "queued" || job.status === "running"','job.status === "blocked" || job.status === "ready" || job.status === "queued" || job.status === "running"')
needle='''          <span className="text-muted-foreground">{queueScope.loading ? "读取队列…" : `${props.storyboards.length} 个分镜`}</span>'''
s=s.replace(needle,needle+'''\n          {queueScope.error && <p role="alert" className="text-destructive">{queueScope.error}</p>}''')
p.write_text(s)
