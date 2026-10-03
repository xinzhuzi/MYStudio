import fs from "node:fs";

/**
 * 数据级修补：把 shot slot（job + evidence 双文件）的 shotRevision 对齐到
 * storyboard 的 outputVersion，并按应用自身的 createRemotionRenderJobId
 * 重算 jobId（jobId 内嵌身份哈希，含 shotRevision）。
 *
 * 用法：vite-node --config build/timeline/vite-node.config.ts \
 *   build/scripts/heal-shot-slot-revision.ts <remotionRoot> <chapterId> <shotId> <newRevision>
 */
async function main(): Promise<void> {
  const [remotionRoot, chapterId, shotId, revisionRaw] = process.argv.slice(2);
  const revision = Number(revisionRaw);
  if (!remotionRoot || !chapterId || !shotId || !Number.isInteger(revision) || revision <= 0) {
    throw new Error("用法: heal-shot-slot-revision.ts <remotionRoot> <chapterId> <shotId> <newRevision>");
  }
  const jobPath = `${remotionRoot}/jobs/shot/${chapterId}/${shotId}/current.json`;
  const evidencePath = `${remotionRoot}/evidence/shots/${chapterId}/${shotId}/current.json`;
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8")) as Record<string, unknown>;
  const target = job.target as Record<string, unknown>;
  const previous = target.shotRevision;
  target.shotRevision = revision;
  const { createRemotionRenderJobId } = await import(
    "../../frontend/lib/studio/remotion/remotion-job-identity"
  );
  const jobId = await createRemotionRenderJobId({
    projectId: job.projectId as string,
    target: target as never,
    inputHash: job.inputHash as string,
    bundleContentHash: job.bundleContentHash as string,
    renderSettingsHash: job.renderSettingsHash as string,
  });
  job.jobId = jobId;
  fs.writeFileSync(`${jobPath}.bak-rev-heal2`, fs.readFileSync(jobPath));
  fs.writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
  (evidence.target as Record<string, unknown>).shotRevision = revision;
  evidence.jobId = jobId;
  fs.writeFileSync(`${evidencePath}.bak-rev-heal2`, fs.readFileSync(evidencePath));
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${shotId}: shotRevision ${previous} -> ${revision}, jobId -> ${jobId.slice(0, 20)}…\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
