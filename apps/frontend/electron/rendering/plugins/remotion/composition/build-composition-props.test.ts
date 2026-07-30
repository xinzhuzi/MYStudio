import { describe, expect, it } from "vitest";
import type { TimelineRenderPlan } from "@/types/editing";
import { makeCurrentSlot } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import { remotionCurrentSlotPaths } from "@/lib/studio/remotion/remotion-current-slot";
import { buildChapterVideoCompositionProps } from "./build-composition-props";

const token = "a".repeat(64);
const mediaUrl = `http://127.0.0.1:43123/${token}/shot`;

describe("buildChapterVideoCompositionProps", () => {
  it("accepts only current Remotion shot MP4s and keeps visual audio audible", () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      chapterAudioClipIds: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.target).toBe("chapter");
      expect(result.value.visualClips[0]?.muted).toBe(false);
    }
  });

  it("rejects legacy candidate visuals and undeclared chapter audio", () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "videoCandidate");
    plan.clips.push({
      id: "voice-1",
      trackId: "voice",
      trackKind: "voice",
      source: { kind: "audio", path: "/tmp/voice.wav", evidence: {} },
      startUs: 0,
      durationUs: 1_000_000,
      trimStartUs: 0,
      speed: 1,
      volume: 1,
      muted: false,
    });
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "voice-1": mediaUrl },
      chapterAudioClipIds: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.message).join(";")).toContain("Remotion shot MP4");
  });

  it("requires an exact shot slot set and matching shot revision", () => {
    const slot = makeCurrentSlot();
    const extraSlot = slotForShot("shot-002");
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot, extraSlot],
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      chapterAudioClipIds: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.message).join(";")).toContain("额外 shot");

    plan.clips[0]!.source.evidence.outputVersion = 2;
    const revisionResult = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      chapterAudioClipIds: [],
    });
    expect(revisionResult.success).toBe(false);
    if (!revisionResult.success) expect(revisionResult.issues.map((issue) => issue.message).join(";")).toContain("revision");
  });

  it("rejects duplicate and unknown chapter audio IDs", () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.clips.push({
      id: "voice-1",
      trackId: "voice",
      trackKind: "voice",
      source: { kind: "audio", path: "/tmp/voice.wav", evidence: {} },
      startUs: 0,
      durationUs: 1_000_000,
      trimStartUs: 0,
      speed: 1,
      volume: 1,
      muted: false,
    });
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "voice-1": mediaUrl },
      chapterAudioClipIds: ["voice-1", "voice-1", "unknown"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.issues.map((issue) => issue.message).join(";");
      expect(messages).toContain("不得重复");
      expect(messages).toContain("未在当前章节计划中声明");
    }
  });
});

function chapterPlan(
  slot: ReturnType<typeof makeCurrentSlot>,
  storyboardId: string,
  sourceKind: "storyboardVideo" | "videoCandidate",
): TimelineRenderPlan {
  const target = slot.target;
  if (target.kind !== "shot") throw new Error("fixture target must be shot");
  return {
    schemaVersion: 1,
    jobId: "chapter-job",
    projectId: slot.projectId,
    episodeId: target.chapterId,
    editingProjectId: "editing-001",
    editingRevision: 1,
    sourceSnapshotHash: "b".repeat(64),
    editingProjectSnapshot: {} as TimelineRenderPlan["editingProjectSnapshot"],
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264",
      subtitleMode: "burn-in",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
      audioDucking: { reductionDb: -12, attackUs: 120_000, releaseUs: 400_000 },
    },
    clips: [{
      id: `visual-${storyboardId}`,
      trackId: "visual",
      trackKind: "video",
      source: {
        kind: sourceKind,
        path: slot.outputPath,
        evidence: {
          storyboardId,
          remotionJobId: slot.job.jobId,
          remotionEvidenceSha256: slot.evidence.sha256,
          outputVersion: target.shotRevision,
        },
      },
      startUs: 0,
      durationUs: 2_000_000,
      trimStartUs: 0,
      speed: 1,
      volume: 0,
      muted: true,
    }],
    transitions: [],
    effects: [],
    createdAt: 1,
  };
}

function slotForShot(shotId: string) {
  const base = makeCurrentSlot();
  if (base.target.kind !== "shot") throw new Error("fixture target must be shot");
  const target = { ...base.target, shotId };
  const paths = remotionCurrentSlotPaths(target);
  const job = {
    ...base.job,
    jobId: `shot:${"f".repeat(64)}`,
    target,
    outputPath: paths.outputPath,
    evidencePath: paths.evidencePath,
  };
  return {
    ...base,
    target,
    job,
    evidence: {
      ...base.evidence,
      jobId: job.jobId,
      target,
      outputPath: paths.outputPath,
    },
    ...paths,
  };
}
