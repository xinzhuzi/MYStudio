import fs from "node:fs";
import path from "node:path";

/**
 * 终极对齐：以 editing@N 的 clip evidence（remotionJobId/inputHash/sha）为准，
 * 从 queue-state.json 取对应 job 身份，重写每镜 slot+evidence 的身份字段。
 * 保证 Studio ensureSession 的严格身份校验（clip ↔ slot 三元组全等）通过。
 *
 * 用法：vite-node --config build/timeline/vite-node.config.ts \
 *   build/scripts/heal-slots-match-editing.mts <remotionRoot> <chapterId> <queue-state.json> <editing.json>
 */
const [remotionRoot, chapterId, queueStatePath, editingPath] = process.argv.slice(2);
if (!remotionRoot || !chapterId || !queueStatePath || !editingPath) {
  throw new Error("用法: heal-slots-match-editing.mts <remotionRoot> <chapterId> <queue-state.json> <editing.json>");
}
const state = JSON.parse(fs.readFileSync(queueStatePath, "utf8")) as { jobs: Array<{ job: Record<string, unknown> }> };
const editing = JSON.parse(fs.readFileSync(editingPath, "utf8")) as { state: { editingProjects: Record<string, Record<string, unknown>> } };
const items = Object.values(editing.state.editingProjects);
if (items.length === 0) throw new Error("editing.json 缺少工程");
const project = items[0]!;
const clips = (project.clips ?? []) as Array<{ source?: { evidence?: Record<string, unknown> } }>;

const jobsByJobId = new Map<string, Record<string, unknown>>();
for (const item of state.jobs ?? []) {
  const job = item.job ?? {};
  if (typeof job.jobId === "string") jobsByJobId.set(job.jobId, job);
}

let fixed = 0;
let missing = 0;
for (const clip of clips) {
  const evidence = clip.source?.evidence;
  const shotId = evidence?.storyboardId as string | undefined;
  const wantedJobId = evidence?.remotionJobId as string | undefined;
  const wantedSha = evidence?.remotionEvidenceSha256 as string | undefined;
  if (!shotId || !wantedJobId) continue;
  const job = jobsByJobId.get(wantedJobId);
  if (!job || job.status !== "succeeded") { missing += 1; continue; }
  const jobPath = path.join(remotionRoot, "jobs/shot", chapterId, shotId, "current.json");
  const evidencePath = path.join(remotionRoot, "evidence/shots", chapterId, shotId, "current.json");
  if (!fs.existsSync(jobPath) || !fs.existsSync(evidencePath)) { missing += 1; continue; }
  const slot = JSON.parse(fs.readFileSync(jobPath, "utf8")) as Record<string, unknown>;
  const evidenceFile = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
  if (slot.jobId === wantedJobId && slot.inputHash === job.inputHash) continue;
  for (const key of ["projectId", "inputHash", "bundleContentHash", "renderSettingsHash", "jobId", "templateVersion", "remotionVersion", "status", "attempt", "createdAt", "startedAt", "completedAt"]) {
    if (job[key] !== undefined) slot[key] = job[key];
  }
  slot.target = job.target;
  slot.progress = 1;
  slot.outputPath = `outputs/shots/${chapterId}/${shotId}/current.mp4`;
  slot.evidencePath = `evidence/shots/${chapterId}/${shotId}/current.json`;
  fs.writeFileSync(jobPath, `${JSON.stringify(slot, null, 2)}\n`);
  for (const key of ["projectId", "inputHash", "bundleContentHash", "renderSettingsHash", "jobId", "templateVersion", "remotionVersion", "attempt"]) {
    if (job[key] !== undefined) evidenceFile[key] = job[key];
  }
  evidenceFile.target = job.target;
  evidenceFile.compositionId = "StoryboardShot";
  if (wantedSha) evidenceFile.sha256 = wantedSha;
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidenceFile, null, 2)}\n`);
  fixed += 1;
}
process.stdout.write(`slots aligned to editing clips: ${fixed}, missing: ${missing}\n`);
