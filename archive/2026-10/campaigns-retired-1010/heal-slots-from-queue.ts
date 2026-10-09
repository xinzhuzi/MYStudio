import fs from "node:fs";
import path from "node:path";

/**
 * 数据级修补：磁盘 shot slot（job + evidence 双文件）被 CLI 管线覆写为
 * CLI 时代 jobId 后，App 队列提交集认不出（waitForCurrentChapterShotSlots
 * 按 submittedJobs 的 jobId/inputHash 过滤 slot）。本脚本用 App 队列
 * queue-state.json 里的 succeeded job 身份重写 slot/evidence 的身份字段，
 * 输出文件与内容哈希保持不变。
 *
 * 用法：vite-node --config build/timeline/vite-node.config.ts \
 *   build/scripts/heal-slots-from-queue.ts <remotionRoot> <chapterId> <queue-state.json>
 */
async function main(): Promise<void> {
  const [remotionRoot, chapterId, queueStatePath] = process.argv.slice(2);
  if (!remotionRoot || !chapterId || !queueStatePath) {
    throw new Error("用法: heal-slots-from-queue.ts <remotionRoot> <chapterId> <queue-state.json>");
  }
  const state = JSON.parse(fs.readFileSync(queueStatePath, "utf8")) as {
    jobs: Array<{ job: Record<string, unknown> }>;
  };
  let rewritten = 0;
  let skipped = 0;
  for (const item of state.jobs ?? []) {
    const job = item.job ?? {};
    const target = job.target as Record<string, unknown> | undefined;
    if (job.status !== "succeeded" || target?.kind !== "shot" || target.chapterId !== chapterId) continue;
    const shotId = String(target.shotId);
    const jobPath = path.join(remotionRoot, "jobs/shot", chapterId, shotId, "current.json");
    const evidencePath = path.join(remotionRoot, "evidence/shots", chapterId, shotId, "current.json");
    if (!fs.existsSync(jobPath) || !fs.existsSync(evidencePath)) { skipped += 1; continue; }
    const slot = JSON.parse(fs.readFileSync(jobPath, "utf8")) as Record<string, unknown>;
    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
    if (slot.jobId === job.jobId && slot.inputHash === job.inputHash) { skipped += 1; continue; }
    if (!fs.existsSync(`${jobPath}.bak-queue-heal`)) {
      fs.writeFileSync(`${jobPath}.bak-queue-heal`, fs.readFileSync(jobPath));
      fs.writeFileSync(`${evidencePath}.bak-queue-heal`, fs.readFileSync(evidencePath));
    }
    for (const key of ["projectId", "inputHash", "bundleContentHash", "renderSettingsHash", "jobId", "templateVersion", "remotionVersion", "status", "attempt", "createdAt", "startedAt", "completedAt"]) {
      if (job[key] !== undefined) slot[key] = job[key];
    }
    slot.target = target;
    slot.progress = 100;
    slot.outputPath = `outputs/shots/${chapterId}/${shotId}/current.mp4`;
    slot.evidencePath = `evidence/shots/${chapterId}/${shotId}/current.json`;
    fs.writeFileSync(jobPath, `${JSON.stringify(slot, null, 2)}\n`);
    for (const key of ["projectId", "inputHash", "bundleContentHash", "renderSettingsHash", "jobId", "templateVersion", "remotionVersion", "attempt"]) {
      if (job[key] !== undefined) evidence[key] = job[key];
    }
    evidence.target = target;
    evidence.compositionId = "StoryboardShot";
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    rewritten += 1;
  }
  process.stdout.write(`slots rewritten: ${rewritten}, skipped: ${skipped}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
