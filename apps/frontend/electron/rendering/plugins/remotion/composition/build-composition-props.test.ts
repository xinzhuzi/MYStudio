import { describe, expect, it } from "vitest";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionChapterManifestV2 } from "@/types/remotion-workspace";
import {
  makeChapterAudioBindingV2,
  makeChapterManifestV2,
  makeCurrentSlot,
  makeShotAudioBindingV2,
} from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import { remotionCurrentSlotPaths } from "@/lib/studio/remotion/remotion-current-slot";
import {
  buildChapterVideoCompositionProps,
  mapEditedVoiceIntervals,
} from "./build-composition-props";

const token = "a".repeat(64);
const mediaUrl = `http://127.0.0.1:43123/${token}/shot`;

describe("buildChapterVideoCompositionProps", () => {
  it("accepts current Remotion shot MP4s, rejects EditingProject audio, and keeps baked shot audio audible", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.target).toBe("chapter");
      expect(result.value.visualClips[0]?.muted).toBe(false);
      expect(result.value.audioClips).toEqual([]);
    }

    plan.clips.push(audioPlanClip("voice-1", "voice"));
    const duplicate = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) expect(duplicate.issues.map((issue) => issue.message).join(";")).toContain("EditingProject");
  });

  it("rejects legacy candidate visuals", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "videoCandidate");
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.message).join(";")).toContain("Remotion shot MP4");
  });

  it("projects an accepted HyperFrames overlay into the ChapterVideo composition", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "hyperframes-overlay": mediaUrl },
      mediaUrlByBindingId: {},
      hyperFramesOverlay: {
        src: mediaUrl,
        windows: [{
          slotId: "shot-001",
          startUs: 250_000,
          durationUs: 500_000,
          templateId: "kinetic-caption",
          parameters: { text: "字幕" },
        }],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.overlayClips).toEqual([{
        clipId: "hyperframes-overlay",
        src: mediaUrl,
        from: 0,
        durationInFrames: 23,
      }]);
    }
  });

  it("requires exact manifest, plan and shot-slot identities", async () => {
    const slot = makeCurrentSlot();
    const extraSlot = slotForShot("shot-002");
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot, extraSlot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.message).join(";")).toContain("额外 shot");

    plan.clips[0]!.source.evidence.outputVersion = 2;
    const revisionResult = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(revisionResult.success).toBe(false);
    if (!revisionResult.success) expect(revisionResult.issues.map((issue) => issue.message).join(";")).toContain("revision");
  });

  it("projects manifest BGM range, trim, fades, user envelope and per-track ducking", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const voice = await makeShotAudioBindingV2({
      shotId: "shot-001",
      shotStartUs: 500_000,
      durationUs: 500_000,
    });
    const bgm = await makeChapterAudioBindingV2({
      bindingId: "chapter-bgm",
      sourceStartUs: 500_000,
      sourceDurationUs: 3_000_000,
      chapterStartUs: 0,
      durationUs: 2_000_000,
      fadeInUs: 200_000,
      fadeOutUs: 300_000,
      envelope: [{ timeUs: 0, gain: 0.8 }, { timeUs: 2_000_000, gain: 0.4 }],
      ducking: { enabled: true, reductionDb: -12, attackUs: 100_000, releaseUs: 200_000 },
    });
    const ambience = await makeChapterAudioBindingV2({
      bindingId: "chapter-ambience",
      role: "ambience",
      sourceDurationUs: 2_000_000,
      durationUs: 2_000_000,
      chapterStartUs: 0,
      ducking: { enabled: false, reductionDb: -18, attackUs: 50_000, releaseUs: 50_000 },
    });
    const chapterManifest = await manifestForPlan(plan, { voice, sharedAudioBindings: [bgm, ambience] });
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: { "chapter-bgm": mediaUrl, "chapter-ambience": mediaUrl },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.audioClips).toHaveLength(2);
    const clip = result.value.audioClips.find((audio) => audio.clipId === "chapter-bgm")!;
    expect(clip).toMatchObject({
      clipId: "chapter-bgm",
      kind: "bgm",
      renderScope: "chapter",
      from: 0,
      durationInFrames: 60,
      trimStartFrames: 15,
      volume: 0.25,
      fade: { fadeInFrames: 6, fadeOutFrames: 9 },
      envelope: [{ frame: 0, gain: 0.8 }, { frame: 60, gain: 0.4 }],
    });
    const holdGain = 10 ** (-12 / 20);
    expect(clip.duckingEnvelope).toEqual(expect.arrayContaining([
      { frame: 12, gain: 1 },
      { frame: 15, gain: holdGain },
      { frame: 30, gain: holdGain },
      { frame: 36, gain: 1 },
    ]));
    expect(result.value.audioClips.find((audio) => audio.clipId === "chapter-ambience")?.duckingEnvelope)
      .toEqual([{ frame: 0, gain: 1 }, { frame: 60, gain: 1 }]);
  });

  it("clips a shared track that outlives a one-shot chapter at the composition boundary", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.clips[0]!.durationUs = 1_000_000;
    const bgm = await makeChapterAudioBindingV2({
      bindingId: "chapter-bgm-long",
      chapterStartUs: 0,
      durationUs: 2_000_000,
      fadeInUs: 0,
      fadeOutUs: 300_000,
      envelope: [{ timeUs: 0, gain: 0.8 }, { timeUs: 2_000_000, gain: 0.4 }],
    });
    const chapterManifest = await manifestForPlan(plan, { sharedAudioBindings: [bgm] });
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: { "chapter-bgm-long": mediaUrl },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.durationInFrames).toBe(30);
    expect(result.value.audioClips[0]).toMatchObject({
      durationInFrames: 30,
      fade: { fadeInFrames: 0, fadeOutFrames: 9 },
      envelope: [{ frame: 0, gain: 0.8 }, { frame: 30, gain: 0.8 }],
    });
  });

  it("maps voice through edited trim, speed and transition layout, then merges overlaps", async () => {
    const firstSlot = makeCurrentSlot();
    const secondSlot = slotForShot("shot-002");
    const plan = twoShotPlan(firstSlot, secondSlot);
    const voice = await makeShotAudioBindingV2({
      shotId: "shot-002",
      shotStartUs: 500_000,
      durationUs: 500_000,
    });
    const chapterManifest = await manifestForTwoShotPlan(plan, voice);

    expect(mapEditedVoiceIntervals({ plan, currentShotSlots: [firstSlot, secondSlot], chapterManifest })).toEqual({
      success: true,
      value: [{ startFrame: 41, endFrame: 56 }],
    });
  });
});

async function manifestForPlan(
  plan: TimelineRenderPlan,
  options: {
    voice?: Awaited<ReturnType<typeof makeShotAudioBindingV2>>;
    sharedAudioBindings?: RemotionChapterManifestV2["sharedAudioBindings"];
  } = {},
): Promise<RemotionChapterManifestV2> {
  const manifest = await makeChapterManifestV2();
  return {
    ...manifest,
    projectId: plan.projectId,
    chapterId: plan.episodeId,
    sourceSnapshotHash: plan.sourceSnapshotHash,
    requiredShotIds: ["shot-001"],
    sharedAudioBindings: options.sharedAudioBindings ?? [],
    shots: [{
      ...manifest.shots[0]!,
      shotId: "shot-001",
      storyboardId: "shot-001",
      audioBindings: options.voice ? [options.voice] : [],
    }],
  };
}

async function manifestForTwoShotPlan(
  plan: TimelineRenderPlan,
  voice: Awaited<ReturnType<typeof makeShotAudioBindingV2>>,
): Promise<RemotionChapterManifestV2> {
  const manifest = await manifestForPlan(plan);
  return {
    ...manifest,
    requiredShotIds: ["shot-001", "shot-002"],
    shots: [
      { ...manifest.shots[0]!, audioBindings: [] },
      {
        ...manifest.shots[0]!,
        shotId: "shot-002",
        storyboardId: "shot-002",
        index: 1,
        audioBindings: [voice],
      },
    ],
  };
}

function audioPlanClip(
  id: string,
  trackKind: "voice" | "bgm" | "sfx",
): TimelineRenderPlan["clips"][number] {
  return {
    id,
    trackId: trackKind,
    trackKind,
    source: { kind: "audio", path: `/tmp/${id}.wav`, evidence: {} },
    startUs: 0,
    durationUs: 1_000_000,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
  };
}

function twoShotPlan(
  firstSlot: ReturnType<typeof makeCurrentSlot>,
  secondSlot: ReturnType<typeof slotForShot>,
): TimelineRenderPlan {
  const plan = chapterPlan(firstSlot, "shot-001", "storyboardVideo");
  plan.clips[0]!.durationUs = 1_000_000;
  const secondTarget = secondSlot.target;
  if (secondTarget.kind !== "shot") throw new Error("fixture target must be shot");
  plan.clips.push({
    ...plan.clips[0]!,
    id: "visual-shot-002",
    source: {
      kind: "storyboardVideo",
      path: secondSlot.outputPath,
      evidence: {
        storyboardId: "shot-002",
        remotionJobId: secondSlot.job.jobId,
        remotionEvidenceSha256: secondSlot.evidence.sha256,
        outputVersion: secondTarget.shotRevision,
      },
    },
    startUs: 1_000_000,
  });
  plan.transitions = [{
    id: "transition-1-2",
    fromClipId: "visual-shot-001",
    toClipId: "visual-shot-002",
    effectId: "fade",
    durationUs: 200_000,
    params: {},
  }];
  return plan;
}

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
