// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { EditingProjectV1, TimelineRenderPlan } from "@/types/editing";
import type { RemotionChapterManifestV2, RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { compileTimelineRenderPlan } from "@/lib/studio/editing/timeline-render-compiler";
import {
  makeChapterManifestV2,
  makeCurrentSlot,
} from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import {
  createRemotionChapterRenderIdentity,
  RemotionChapterRenderer,
} from "./remotion-chapter-renderer";

describe("Remotion chapter identity", () => {
  it("changes for manifest rendering fields, mapped voice intervals and shot output SHA", async () => {
    const slot = makeCurrentSlot();
    const plan = makePlan(slot);
    const manifest = await manifestForPlan(plan);
    const base = await createRemotionChapterRenderIdentity({
      plan,
      currentShotSlots: [slot],
      chapterManifest: manifest,
      bundleContentHash: "d".repeat(64),
    });

    const manifestChanged = structuredClone(manifest);
    manifestChanged.sharedAudioBindings[0]!.volume = 0.5;
    const changedManifestIdentity = await createRemotionChapterRenderIdentity({
      plan,
      currentShotSlots: [slot],
      chapterManifest: manifestChanged,
      bundleContentHash: "d".repeat(64),
    });

    const voiceChanged = structuredClone(manifest);
    voiceChanged.shots[0]!.audioBindings[0]!.shotStartUs += 100_000;
    const changedVoiceIdentity = await createRemotionChapterRenderIdentity({
      plan,
      currentShotSlots: [slot],
      chapterManifest: voiceChanged,
      bundleContentHash: "d".repeat(64),
    });

    const slotChanged = structuredClone(slot);
    slotChanged.evidence.sha256 = "f".repeat(64);
    const planForChangedSlot = structuredClone(plan);
    planForChangedSlot.clips[0]!.source.evidence.remotionEvidenceSha256 = slotChanged.evidence.sha256;
    const changedSlotIdentity = await createRemotionChapterRenderIdentity({
      plan: planForChangedSlot,
      currentShotSlots: [slotChanged],
      chapterManifest: manifest,
      bundleContentHash: "d".repeat(64),
    });

    expect(new Set([
      base.inputHash,
      changedManifestIdentity.inputHash,
      changedVoiceIdentity.inputHash,
      changedSlotIdentity.inputHash,
    ])).toHaveLength(4);
  });
});

describe("RemotionChapterRenderer manifest preflight", () => {
  it("stops before capability creation or worker startup when the current manifest is missing", async () => {
    const slot = makeCurrentSlot();
    const fork = vi.fn();
    const renderer = new RemotionChapterRenderer({
      workspaceRoot: "/tmp/remotion-chapter-renderer-test",
      bundlePath: "/tmp/remotion-bundle-not-needed",
      workerPath: "/tmp/remotion-worker-not-needed.cjs",
      cwd: "/tmp",
      binariesDirectory: "/tmp",
      remotionVersion: "4.0.499",
      resolveSourcePath: (value) => value,
      probeBrowser: async () => ({ status: { state: "ready", remotionVersion: "4.0.499" }, executablePath: "/tmp/browser" }),
      fork,
      emitProgress: () => undefined,
      chapterManifestService: { read: vi.fn(async () => undefined) },
      projectRootForProject: () => "/tmp/project-a",
    });

    const result = await renderer.render({ plan: makePlan(slot), currentShotSlots: [slot] });

    expect(result).toMatchObject({ success: false, canceled: false, error: expect.stringContaining("manifest") });
    expect(fork).not.toHaveBeenCalled();
    await renderer.dispose();
  });

  it("stops before capability creation or worker startup on manifest identity or source SHA failure", async () => {
    const slot = makeCurrentSlot();
    const fork = vi.fn();
    const renderer = new RemotionChapterRenderer({
      workspaceRoot: "/tmp/remotion-chapter-renderer-test",
      bundlePath: "/tmp/remotion-bundle-not-needed",
      workerPath: "/tmp/remotion-worker-not-needed.cjs",
      cwd: "/tmp",
      binariesDirectory: "/tmp",
      remotionVersion: "4.0.499",
      resolveSourcePath: (value) => value,
      probeBrowser: async () => ({ status: { state: "ready", remotionVersion: "4.0.499" }, executablePath: "/tmp/browser" }),
      fork,
      emitProgress: () => undefined,
      chapterManifestService: { read: vi.fn(async () => { throw new Error("source_sha256_mismatch"); }) },
      projectRootForProject: () => "/tmp/project-a",
    });

    const result = await renderer.render({ plan: makePlan(slot), currentShotSlots: [slot] });

    expect(result).toMatchObject({ success: false, error: "source_sha256_mismatch" });
    expect(fork).not.toHaveBeenCalled();
    await renderer.dispose();
  });
});

async function manifestForPlan(plan: TimelineRenderPlan): Promise<RemotionChapterManifestV2> {
  const manifest = await makeChapterManifestV2();
  return {
    ...manifest,
    projectId: plan.projectId,
    chapterId: plan.episodeId,
    sourceSnapshotHash: plan.sourceSnapshotHash,
    requiredShotIds: ["shot-001"],
    shots: [{
      ...manifest.shots[0]!,
      shotId: "shot-001",
      storyboardId: "shot-001",
    }],
  };
}

function makePlan(slot: RemotionCurrentSlotV1): TimelineRenderPlan {
  if (slot.target.kind !== "shot") throw new Error("fixture target must be shot");
  const visual = {
    id: "visual-shot-001",
    trackId: "visual",
    name: "shot-001",
    source: {
      kind: "storyboardVideo" as const,
      path: slot.outputPath,
      evidence: {
        storyboardId: slot.target.shotId,
        remotionJobId: slot.job.jobId,
        remotionEvidenceSha256: slot.evidence.sha256,
        outputVersion: slot.target.shotRevision,
      },
    },
    startUs: 0,
    durationUs: 2_000_000,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
  };
  const project: EditingProjectV1 = {
    schemaVersion: 1,
    id: "editing-001",
    projectId: slot.projectId,
    episodeId: slot.target.chapterId,
    name: "chapter",
    revision: 1,
    sourceSnapshotHash: "b".repeat(64),
    createdBy: "auto",
    manuallyEdited: false,
    stale: false,
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264",
      subtitleMode: "burn-in",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    },
    tracks: [{ id: "visual", kind: "video", name: "visual", order: 0, clipIds: [visual.id], muted: false, locked: false }],
    clips: [visual],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const compiled = compileTimelineRenderPlan(project, { jobId: "chapter-plan", createdAt: 1 });
  if (!compiled.success) throw new Error(compiled.issues.map((issue) => issue.message).join(";"));
  return compiled.value;
}
