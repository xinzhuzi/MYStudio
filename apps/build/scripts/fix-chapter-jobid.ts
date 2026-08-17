/** 一次性：用真实 createRemotionRenderJobId 修正注入章节作业的 jobId。 */
import fs from "node:fs";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import type { RemotionRenderJobIdentityV1 } from "@/types/remotion-workspace";

const Q = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_remotion/queue/queue-state.json";
const q = JSON.parse(fs.readFileSync(Q, "utf8"));
const jobs = q.jobs ?? q.state?.jobs;
const ch = jobs.filter((it: { job: { target?: { kind?: string } } }) => it.job.target?.kind === "chapter").pop() as { job: Record<string, unknown> };
const j = ch.job as unknown as { projectId: string; target: never; inputHash: string; bundleContentHash: string; renderSettingsHash: string; jobId: string };
const identity: RemotionRenderJobIdentityV1 = {
  projectId: j.projectId,
  target: j.target as never,
  inputHash: j.inputHash,
  bundleContentHash: j.bundleContentHash,
  renderSettingsHash: j.renderSettingsHash,
};
j.jobId = await createRemotionRenderJobId(identity);
fs.writeFileSync(Q, JSON.stringify(q));
console.log("jobId →", j.jobId.slice(0, 44));
