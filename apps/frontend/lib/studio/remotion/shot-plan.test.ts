import { describe, expect, it } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import {
  makeChapterManifestV2,
  TEST_SHA_A,
  TEST_SHA_B,
  TEST_SHA_C,
} from "./remotion-workspace-test-fixtures";
import { createRemotionAudioBindingFingerprint } from "./remotion-audio-fingerprint";
import {
  compileRemotionShotPlan,
  projectStoryboardShotCompositionProps,
  validateRemotionShotHumanApproval,
  validateRemotionShotPlan,
} from "./shot-plan";
import {
  storyboardShotSemanticsFingerprint,
  visualContinuityFingerprint,
} from "../visual-continuity";

const MEDIA_URL = "http://127.0.0.1:43123/" + "a".repeat(64) + "/media";

describe("Remotion shot plan compiler", () => {
  it("compiles image and video shots without hard-coded shot counts", async () => {
    const image = await compileRemotionShotPlan(await input());
    expect(image.success).toBe(true);
    if (!image.success) return;
    expect(image.value.visualKind).toBe("image");

    const videoInput = await input();
    videoInput.storyboard.mediaRef = { kind: "video", path: "videos/shot-001.mp4", contentSha256: TEST_SHA_A };
    const video = await compileRemotionShotPlan(videoInput);
    expect(video.success).toBe(true);
    if (!video.success) return;
    expect(video.value.visualKind).toBe("video");
  });

  it("projects only shot-scoped audio into capability-only Composition props", async () => {
    const compiled = await compileRemotionShotPlan(await input());
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    const projected = projectStoryboardShotCompositionProps(compiled.value, () => MEDIA_URL);
    expect(projected.success).toBe(true);
    if (!projected.success) return;
    expect(projected.value.target).toBe("shot");
    expect(projected.value.shotId).toBe(compiled.value.shot.shotId);
    expect(projected.value.visualClips[0]?.src).toBe(MEDIA_URL);
    expect(projected.value.audioClips).toHaveLength(1);
    expect(projected.value.audioClips[0]?.renderScope).toBe("shot");
    expect(projected.value.audioClips[0]?.src).toBe(MEDIA_URL);
    expect(projected.value.audioClips[0]).toMatchObject({
      kind: "voice",
      trimStartFrames: 3,
      durationInFrames: 45,
      volume: 1,
      fade: { fadeInFrames: 1, fadeOutFrames: 1 },
      envelope: [
        { frame: 0, gain: 1 },
        { frame: 45, gain: 0.9 },
      ],
    });
  });

  it.each(["bgm", "ambience"] as const)("rejects %s as shot-scoped audio", async (role) => {
    const planInput = await input();
    const shotAudio = planInput.shot.audioBindings[0]!;
    const invalid = shotAudio as unknown as { role: string; bindingFingerprint: string };
    invalid.role = role;
    invalid.bindingFingerprint = await createRemotionAudioBindingFingerprint(
      shotAudio as never,
    );
    expectIssue(await compileRemotionShotPlan(planInput), "$.shots[0].audioBindings[0].role");
  });

  it("rejects missing visual material, required dialogue audio, and invalid duration", async () => {
    const missingVisual = await input();
    missingVisual.storyboard.mediaRef = undefined;
    expectIssue(await compileRemotionShotPlan(missingVisual), "$.storyboard.mediaRef");

    const missingAudio = await input();
    missingAudio.storyboard.lines = "需要口播";
    missingAudio.shot.audioBindings = missingAudio.shot.audioBindings.filter(
      (binding) => binding.renderScope !== "shot" || binding.role !== "voice",
    );
    expectIssue(await compileRemotionShotPlan(missingAudio), "$.shot.audioBindings");

    const invalidDuration = await input();
    invalidDuration.shot.durationUs = 0;
    expectIssue(await compileRemotionShotPlan(invalidDuration), "$.shots[0].durationUs");
  });

  it("rejects stale continuity and cross-project media references", async () => {
    const stale = await input();
    stale.storyboard.stale = true;
    stale.storyboard.staleReason = "上游图像已替换";
    expectIssue(await compileRemotionShotPlan(stale), "$.storyboard.stale");

    const missingContinuity = await input();
    missingContinuity.storyboard.continuityState = undefined;
    expectIssue(await compileRemotionShotPlan(missingContinuity), "$.storyboard.continuityState");

    const staleContinuity = await input();
    staleContinuity.storyboard.prompt = "已变更的视觉输入";
    expectIssue(await compileRemotionShotPlan(staleContinuity), "$.storyboard.continuityState");

    const crossProject = await input();
    crossProject.shot.visualSource.projectId = "project-b";
    expectIssue(await compileRemotionShotPlan(crossProject), "$.shots[0].visualSource.projectId");
  });

  it("keeps the input hash stable for equivalent key order and unrelated chapter revisions", async () => {
    const first = await compileRemotionShotPlan(await input());
    const secondInput = await input();
    const transform = secondInput.shot.transform;
    secondInput.shot.transform = {
      opacity: transform.opacity,
      rotation: transform.rotation,
      scaleY: transform.scaleY,
      scaleX: transform.scaleX,
      y: transform.y,
      x: transform.x,
    };
    secondInput.chapterRevision += 1;
    secondInput.sourceSnapshotHash = TEST_SHA_C;
    const second = await compileRemotionShotPlan(secondInput);
    expect(first.success && second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(first.value.inputHash).toBe(second.value.inputHash);
  });

  it("changes the input hash for shot audio fields while ignoring chapter shared audio", async () => {
    const baselineInput = await input();
    const baseline = await compileRemotionShotPlan(baselineInput);
    expect(baseline.success).toBe(true);
    if (!baseline.success) return;

    const motionChanged = await input();
    motionChanged.shot.motion = { ...motionChanged.shot.motion, toScale: 1.12 };
    const motion = await compileRemotionShotPlan(motionChanged);
    expect(motion.success).toBe(true);
    if (!motion.success) return;
    expect(motion.value.inputHash).not.toBe(baseline.value.inputHash);

    const audioChanged = await input();
    audioChanged.shot.audioBindings[0]!.volume = 0.75;
    audioChanged.shot.audioBindings[0]!.bindingFingerprint = await createRemotionAudioBindingFingerprint(
      audioChanged.shot.audioBindings[0]!,
    );
    const audio = await compileRemotionShotPlan(audioChanged);
    expect(audio.success).toBe(true);
    if (!audio.success) return;
    expect(audio.value.inputHash).not.toBe(baseline.value.inputHash);

    const legacySharedInput = {
      ...await input(),
      sharedAudioTracks: [{ trackId: "legacy-chapter-bgm", role: "bgm" }],
    };
    const legacyShared = await compileRemotionShotPlan(legacySharedInput);
    expect(legacyShared.success).toBe(true);
    if (!legacyShared.success) return;
    expect(legacyShared.value.inputHash).toBe(baseline.value.inputHash);
  });

  it("rejects storyboard identity, state, and stale source fingerprints", async () => {
    const wrongIndex = await input();
    wrongIndex.storyboard.index = 1;
    expectIssue(await compileRemotionShotPlan(wrongIndex), "$.storyboard.index");

    const notReady = await input();
    notReady.storyboard.state = "rendering";
    expectIssue(await compileRemotionShotPlan(notReady), "$.storyboard.state");

    const missingFingerprint = await input();
    missingFingerprint.storyboard.mediaRef!.contentSha256 = undefined;
    expectIssue(await compileRemotionShotPlan(missingFingerprint), "$.storyboard.mediaRef.contentSha256");

    const staleFingerprint = await input();
    staleFingerprint.storyboard.mediaRef!.contentSha256 = TEST_SHA_B;
    expectIssue(await compileRemotionShotPlan(staleFingerprint), "$.storyboard.mediaRef.contentSha256");
  });

  it("requires current dialogue audio to match a shot-scoped voice binding", async () => {
    const validDialogue = await input();
    validDialogue.storyboard.lines = "需要口播";
    expect((await compileRemotionShotPlan(validDialogue)).success).toBe(true);

    const staleDialogue = await input();
    staleDialogue.storyboard.lines = "需要口播";
    staleDialogue.storyboard.audioRef = {
      kind: "audio",
      path: "audio/old-shot-001.wav",
      contentSha256: TEST_SHA_C,
    };
    expectIssue(await compileRemotionShotPlan(staleDialogue), "$.storyboard.audioRef.contentSha256");
  });

  it("runtime-validates persisted plans and their canonical hash", async () => {
    const compiled = await compileRemotionShotPlan(await input());
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    expect((await validateRemotionShotPlan(structuredClone(compiled.value))).success).toBe(true);

    const tampered = structuredClone(compiled.value);
    tampered.inputHash = TEST_SHA_C;
    expectIssue(await validateRemotionShotPlan(tampered), "$.inputHash");

    const wrongTarget = { ...structuredClone(compiled.value), target: "chapter" };
    expectIssue(await validateRemotionShotPlan(wrongTarget), "$.target");

    const legacyShared = { ...structuredClone(compiled.value), sharedAudioTracks: [] };
    expectIssue(await validateRemotionShotPlan(legacyShared), "$.sharedAudioTracks");
  });

  it("fails closed on malformed persisted shot audio structure", async () => {
    const malformed = {
      schemaVersion: 1,
      target: "shot",
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      sourceSnapshotHash: TEST_SHA_A,
      renderSettings: (await input()).renderSettings,
      visualKind: "image",
      shot: null,
      inputHash: TEST_SHA_A,
    };
    await expect(validateRemotionShotPlan(malformed)).resolves.toMatchObject({
      success: false,
    });

    const valid = await compileRemotionShotPlan(await input());
    expect(valid.success).toBe(true);
    if (!valid.success) return;
    const malformedAudio = {
      ...structuredClone(valid.value),
      shot: { ...structuredClone(valid.value.shot), audioBindings: "not-an-array" },
    };
    await expect(validateRemotionShotPlan(malformedAudio)).resolves.toMatchObject({
      success: false,
    });
  });

  it("reports the original binding index when shot audio capability resolution fails", async () => {
    const planInput = await input();
    const compiled = await compileRemotionShotPlan(planInput);
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    const projected = projectStoryboardShotCompositionProps(compiled.value, (reference) => {
      if (reference.relativePath.includes("/audio/") || reference.relativePath.startsWith("remotion/audio/")) {
        throw new Error("audio capability unavailable");
      }
      return MEDIA_URL;
    });
    expectIssue(projected, "$.shot.audioBindings[0].source");
  });

  it("requires current-revision human approval when the first chapter policy is enabled", async () => {
    const result = await compileRemotionShotPlan({ ...await input(), requireHumanApproval: true });
    expectIssue(result, "$.storyboard.visualReview");
  });

  it("binds the first-chapter approval receipt to project, chapter, shot and revision", () => {
    const expected = {
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      shotRevision: 2,
      inputFingerprint: "visual-input-v2",
    };
    const valid = validateRemotionShotHumanApproval({
      schemaVersion: 1,
      ...expected,
      reviewer: "human",
      approvedAt: 10,
      evidencePath: "images/shot-001.png",
    }, expected);
    expect(valid.success).toBe(true);

    const stale = validateRemotionShotHumanApproval({
      schemaVersion: 1,
      ...expected,
      shotRevision: 1,
      reviewer: "human",
      approvedAt: 10,
      evidencePath: "images/shot-001.png",
    }, expected);
    expectIssue(stale, "$.humanApproval.shotRevision");
  });
});

function expectIssue(result: { success: boolean; issues?: Array<{ path: string }> }, path: string): void {
  expect(result.success).toBe(false);
  expect(result.issues?.some((issue) => issue.path === path)).toBe(true);
}

async function input() {
  const chapter = await makeChapterManifestV2();
  const shot = structuredClone(chapter.shots[0]!);
  const voice = shot.audioBindings[0]!;
  const storyboard: StoryboardItem = {
    id: "storyboard-001",
    episodeId: "chapter-001",
    index: 0,
    trackKey: "main",
    trackId: "track-001",
    duration: 2,
    prompt: "夜色中的城门",
    videoDesc: "静态镜头",
    assetIds: [],
    mediaRef: { kind: "image", path: "images/shot-001.png", contentSha256: TEST_SHA_A },
    audioRef: {
      kind: "audio",
      path: `project-file://project-a/${voice.source.relativePath}`,
      contentSha256: voice.source.contentSha256,
    },
    shotAudioBindings: structuredClone(shot.audioBindings),
    ttsJob: {
      schemaVersion: 1,
      projectId: chapter.projectId,
      chapterId: chapter.chapterId,
      shotId: shot.shotId,
      shotRevision: shot.revision,
      inputFingerprint: voice.ttsInputFingerprint!,
      status: "completed",
      attempt: 1,
      generationId: "generation-shot-001",
      createdAt: 100,
      updatedAt: 200,
    },
    state: "ready",
  };
  storyboard.shotSemantics = {
    sceneViewpointId: "scene-view-001",
    personFree: true,
    visibleCharacters: [],
    visibleProps: [],
    actionIn: "城门静止",
    actionOut: "城门静止",
  };
  storyboard.continuityState = {
    groupId: "group-001",
    sceneVersionId: "scene-version-001",
    sceneViewpointId: "scene-view-001",
    lighting: "夜色",
    palette: "冷色",
    actionIn: "城门静止",
    actionOut: "城门静止",
    characters: [],
    sourceSemanticsFingerprint: storyboardShotSemanticsFingerprint(storyboard.shotSemantics),
    inputFingerprint: "",
  };
  storyboard.continuityState.inputFingerprint = visualContinuityFingerprint(storyboard);
  return {
    projectId: chapter.projectId,
    chapterId: chapter.chapterId,
    chapterRevision: chapter.revision,
    sourceSnapshotHash: chapter.sourceSnapshotHash,
    renderSettings: chapter.renderSettings,
    shot,
    storyboard,
  };
}
