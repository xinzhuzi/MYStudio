// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { buildRemotionCurrentSlot } from "@/lib/studio/remotion/remotion-current-slot";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import {
  makeChapterManifestV2,
  makeShotAudioBindingV2,
} from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionCurrentSlotV1, RemotionRenderJobV1 } from "@/types/remotion-workspace";
import {
  RemotionRenderQueue,
  type RemotionQueueEventV1,
  type RemotionQueuePersistence,
  type RemotionQueueShotInput,
  resolveHardwareQueueConcurrency,
} from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/electron/rendering/plugins/remotion/queue/remotion-render-queue";
import { createReadyShotJob } from "@/lib/studio/remotion/remotion-job-factory";

class MemoryPersistence implements RemotionQueuePersistence {
  snapshot: unknown;
  events: RemotionQueueEventV1[] = [];

  async load() { return { snapshot: this.snapshot, events: this.events }; }
  async append(event: RemotionQueueEventV1) { this.events.push(event); }
  async writeSnapshot(snapshot: unknown) { this.snapshot = snapshot; }
}

async function makePlan(chapterId = "chapter-001", shotIndex = 0, projectId = "project-a"): Promise<RemotionShotPlanV1> {
  const chapter = await makeChapterManifestV2();
  const shotId = `shot-${String(shotIndex + 1).padStart(3, "0")}`;
  const voice = await makeShotAudioBindingV2({ projectId, chapterId, shotId });
  const shot = {
    ...chapter.shots[0]!,
    shotId,
    index: shotIndex,
    visualSource: { ...chapter.shots[0]!.visualSource, projectId },
    audioBindings: [voice],
  };
  const hashInput = {
    schemaVersion: 1 as const,
    target: "shot" as const,
    projectId,
    chapterId,
    renderSettings: chapter.renderSettings,
    visualKind: "image" as const,
    shot,
  };
  return {
    schemaVersion: 1,
    target: "shot",
    projectId,
    chapterId,
    chapterRevision: chapter.revision,
    sourceSnapshotHash: chapter.sourceSnapshotHash,
    renderSettings: chapter.renderSettings,
    visualKind: "image",
    shot,
    inputHash: await sha256CanonicalJson(hashInput),
  };
}

async function makeInput(shotIndex = 0, projectId = "project-a"): Promise<RemotionQueueShotInput> {
  const plan = await makePlan("chapter-001", shotIndex, projectId);
  const job = await createReadyShotJob({
    plan,
    bundleContentHash: "d".repeat(64),
    templateVersion: "1.0.0",
    remotionVersion: "4.0.534",
    now: 100,
  });
  return { kind: "shot", job, plan };
}

async function withCinematicInput(
  plan: RemotionShotPlanV1,
  cinematic: NonNullable<RemotionShotPlanV1["cinematic"]>,
): Promise<RemotionShotPlanV1> {
  return {
    ...plan,
    cinematic,
    inputHash: await sha256CanonicalJson({
      schemaVersion: 1 as const,
      target: "shot" as const,
      projectId: plan.projectId,
      chapterId: plan.chapterId,
      renderSettings: plan.renderSettings,
      visualKind: plan.visualKind,
      shot: plan.shot,
      cinematic,
    }),
  };
}

function successSlot(job: RemotionRenderJobV1): RemotionCurrentSlotV1 {
  const succeeded: RemotionRenderJobV1 = {
    ...job,
    status: "succeeded",
    attempt: Math.max(1, job.attempt),
    progress: 1,
    startedAt: 110,
    completedAt: 120,
    outputPath: `outputs/shots/${job.target.kind === "shot" ? job.target.chapterId : "unknown"}/${job.target.kind === "shot" ? job.target.shotId : "unknown"}/current.mp4`,
    evidencePath: `evidence/shots/${job.target.kind === "shot" ? job.target.chapterId : "unknown"}/${job.target.kind === "shot" ? job.target.shotId : "unknown"}/current.json`,
  };
  return buildRemotionCurrentSlot(job.projectId, job.target, succeeded, {
    schemaVersion: 1,
    jobId: succeeded.jobId,
    projectId: succeeded.projectId,
    target: succeeded.target,
    inputHash: succeeded.inputHash,
    bundleContentHash: succeeded.bundleContentHash,
    renderSettingsHash: succeeded.renderSettingsHash,
    templateVersion: succeeded.templateVersion,
    remotionVersion: succeeded.remotionVersion,
    attempt: succeeded.attempt,
    compositionId: "StoryboardShot",
    renderer: { requested: "remotion", actual: "remotion" },
    outputPath: succeeded.outputPath!,
    sizeBytes: 100,
    mtimeMs: 120,
    sha256: "e".repeat(64),
    width: 1080,
    height: 1920,
    durationUs: 2_000_000,
    streams: [
      { kind: "video", codec: "h264", width: 1080, height: 1920 },
      { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 },
    ],
    inputManifestPath: `chapters/${succeeded.target.kind === "shot" ? succeeded.target.chapterId : "unknown"}.json`,
    startedAt: 110,
    completedAt: 120,
  }, 120);
}

function successChapterSlot(job: RemotionRenderJobV1): RemotionCurrentSlotV1 {
  if (job.target.kind !== "chapter") throw new Error("chapter fixture target required");
  const succeeded: RemotionRenderJobV1 = {
    ...job,
    status: "succeeded",
    attempt: Math.max(1, job.attempt),
    progress: 1,
    startedAt: 110,
    completedAt: 120,
    outputPath: `outputs/chapters/${job.target.chapterId}/current.mp4`,
    evidencePath: `evidence/chapters/${job.target.chapterId}/current.json`,
  };
  return buildRemotionCurrentSlot(job.projectId, job.target, succeeded, {
    schemaVersion: 1,
    jobId: succeeded.jobId,
    projectId: succeeded.projectId,
    target: succeeded.target,
    inputHash: succeeded.inputHash,
    bundleContentHash: succeeded.bundleContentHash,
    renderSettingsHash: succeeded.renderSettingsHash,
    templateVersion: succeeded.templateVersion,
    remotionVersion: succeeded.remotionVersion,
    attempt: succeeded.attempt,
    compositionId: "ChapterVideo",
    renderer: { requested: "remotion", actual: "remotion" },
    outputPath: succeeded.outputPath!,
    sizeBytes: 100,
    mtimeMs: 120,
    sha256: "c".repeat(64),
    width: 1080,
    height: 1920,
    durationUs: 4_000_000,
    streams: [
      { kind: "video", codec: "h264", width: 1080, height: 1920 },
      { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 },
    ],
    inputManifestPath: `chapters/${job.target.chapterId}.json`,
    renderPlanPath: `jobs/chapter/${job.target.chapterId}/current-render-plan.json`,
    snapshotPath: `jobs/chapter/${job.target.chapterId}/current-editing-project.json`,
    startedAt: 110,
    completedAt: 120,
  }, 120);
}


describe("audit: queue failure reproduction", () => {
  it("parallel commits use unique seq and journal-only recovery preserves both jobs", async () => {
    const events: RemotionQueueEventV1[]=[];
    const inputs=await Promise.all([makeInput(0),makeInput(1)]);
    const persistence={load:async()=>({snapshot:undefined,events}),append:async(e:RemotionQueueEventV1)=>{events.push(e);await Promise.resolve();},writeSnapshot:async()=>{}};
    const executor={render:async()=>({success:false as const,jobId:"unused",canceled:false,error:"unused"}),cancel:(jobId:string)=>({success:false,jobId,canceled:false,error:"not running"})};
    const queue=new RemotionRenderQueue({persistence,executor});
    await queue.init();
    await Promise.all(inputs.map(input=>(queue as any).commit(input)));
    expect(events.map(e=>e.seq)).toEqual([1,2]);
    const restored=new RemotionRenderQueue({persistence,executor});
    await restored.init();
    expect(restored.getJobs({projectId:"project-a"})).toHaveLength(2);
    console.log("AUDIT queue-sequence",JSON.stringify({seq:events.map(e=>e.seq),before:2,after:restored.getJobs({projectId:"project-a"}).length}));
  });
  it("blocked jobs cancel without an executor", async () => {
    const input=await makeInput();
    input.job={...input.job,status:"blocked",error:{code:"gate",message:"gate",stage:"S4"}};
    const persistence=new MemoryPersistence();
    persistence.snapshot={schemaVersion:1,lastSeq:0,jobs:[input],updatedAt:1};
    let calls=0;
    const queue=new RemotionRenderQueue({persistence,executor:{render:async()=>({success:false,jobId:input.job.jobId,canceled:false,error:"unused"}),cancel:jobId=>{calls++;return {success:false,jobId,canceled:false,error:"not running"};}}});
    await queue.init();
    expect((await queue.cancel(input.job.jobId)).success).toBe(true);
    expect(calls).toBe(0);
    expect(queue.getJob(input.job.jobId)?.status).toBe("canceled");
  });
});
it("audit: public parallel enqueue produces unique journal sequences",async()=>{
 const inputs=await Promise.all([makeInput(0),makeInput(1),makeInput(2)]);
 const events:RemotionQueueEventV1[]=[];
 const persistence={load:async()=>({snapshot:undefined,events:[]}),append:async(e:RemotionQueueEventV1)=>{await new Promise(r=>setTimeout(r,1));events.push(e);},writeSnapshot:async()=>{}};
 const queue=new RemotionRenderQueue({persistence,concurrency:3,executor:{render:async(plan)=>({success:false,jobId:inputs.find(i=>i.plan.shot.shotId===plan.shot.shotId)!.job.jobId,canceled:false,error:"audit fixture"}),cancel:jobId=>({success:false,jobId,canceled:false})}});
 await queue.init();await Promise.all(inputs.map(i=>queue.enqueueShot(i)));await queue.waitForIdle();
 expect(new Set(events.map(e=>e.seq)).size).toBe(events.length);
 console.log("AUDIT public sequence",JSON.stringify(events.map(e=>e.seq)));
});
