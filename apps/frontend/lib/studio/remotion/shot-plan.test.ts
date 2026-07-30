import { describe, expect, it } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import {
  makeChapterManifest,
  TEST_SHA_A,
  TEST_SHA_B,
  TEST_SHA_C,
} from "./remotion-workspace-test-fixtures";
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
    const image = await compileRemotionShotPlan(input());
    expect(image.success).toBe(true);
    if (!image.success) return;
    expect(image.value.visualKind).toBe("image");

    const videoInput = input();
    videoInput.storyboard.mediaRef = { kind: "video", path: "videos/shot-001.mp4", contentSha256: TEST_SHA_A };
    const video = await compileRemotionShotPlan(videoInput);
    expect(video.success).toBe(true);
    if (!video.success) return;
    expect(video.value.visualKind).toBe("video");
  });

  it("projects only shot-scoped audio into capability-only Composition props", async () => {
    const compiled = await compileRemotionShotPlan(input());
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
  });

  it("accepts ambience as shot-scoped Composition audio", async () => {
    const planInput = input();
    const shotAudio = planInput.shot.audioBindings.find((binding) => binding.renderScope === "shot");
    if (!shotAudio || shotAudio.renderScope !== "shot") throw new Error("shot audio fixture missing");
    shotAudio.role = "ambience";
    const compiled = await compileRemotionShotPlan(planInput);
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    const projected = projectStoryboardShotCompositionProps(compiled.value, () => MEDIA_URL);
    expect(projected.success).toBe(true);
    if (!projected.success) return;
    expect(projected.value.audioClips).toMatchObject([{ kind: "ambience", renderScope: "shot" }]);
  });

  it("rejects missing visual material, required dialogue audio, and invalid duration", async () => {
    const missingVisual = input();
    missingVisual.storyboard.mediaRef = undefined;
    expectIssue(await compileRemotionShotPlan(missingVisual), "$.storyboard.mediaRef");

    const missingAudio = input();
    missingAudio.storyboard.lines = "需要口播";
    missingAudio.shot.audioBindings = missingAudio.shot.audioBindings.filter(
      (binding) => binding.renderScope !== "shot" || binding.role !== "voice",
    );
    expectIssue(await compileRemotionShotPlan(missingAudio), "$.shot.audioBindings");

    const invalidDuration = input();
    invalidDuration.shot.durationUs = 0;
    expectIssue(await compileRemotionShotPlan(invalidDuration), "$.shots[0].durationUs");
  });

  it("rejects stale continuity and cross-project media references", async () => {
    const stale = input();
    stale.storyboard.stale = true;
    stale.storyboard.staleReason = "上游图像已替换";
    expectIssue(await compileRemotionShotPlan(stale), "$.storyboard.stale");

    const missingContinuity = input();
    missingContinuity.storyboard.continuityState = undefined;
    expectIssue(await compileRemotionShotPlan(missingContinuity), "$.storyboard.continuityState");

    const staleContinuity = input();
    staleContinuity.storyboard.prompt = "已变更的视觉输入";
    expectIssue(await compileRemotionShotPlan(staleContinuity), "$.storyboard.continuityState");

    const crossProject = input();
    crossProject.shot.visualSource.projectId = "project-b";
    expectIssue(await compileRemotionShotPlan(crossProject), "$.shots[0].visualSource.projectId");
  });

  it("keeps the input hash stable for equivalent key order and unrelated chapter revisions", async () => {
    const first = await compileRemotionShotPlan(input());
    const secondInput = input();
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

  it("changes the input hash for render-relevant shot and referenced shared-audio changes only", async () => {
    const baseline = await compileRemotionShotPlan(input());
    expect(baseline.success).toBe(true);
    if (!baseline.success) return;

    const motionChanged = input();
    motionChanged.shot.motion = { ...motionChanged.shot.motion, toScale: 1.12 };
    const motion = await compileRemotionShotPlan(motionChanged);
    expect(motion.success).toBe(true);
    if (!motion.success) return;
    expect(motion.value.inputHash).not.toBe(baseline.value.inputHash);

    const referencedTrackChanged = input();
    referencedTrackChanged.sharedAudioTracks[0]!.source.contentSha256 = TEST_SHA_B;
    referencedTrackChanged.sharedAudioTracks[0]!.sourceFingerprint = TEST_SHA_B;
    const referencedTrack = await compileRemotionShotPlan(referencedTrackChanged);
    expect(referencedTrack.success).toBe(true);
    if (!referencedTrack.success) return;
    expect(referencedTrack.value.inputHash).not.toBe(baseline.value.inputHash);

    const unreferencedTrackChanged = input();
    unreferencedTrackChanged.sharedAudioTracks.push({
      trackId: "unused-ambience",
      role: "ambience",
      source: {
        ...structuredClone(unreferencedTrackChanged.sharedAudioTracks[0]!.source),
        relativePath: "audio/unused-ambience.wav",
      },
      sourceFingerprint: unreferencedTrackChanged.sharedAudioTracks[0]!.sourceFingerprint,
    });
    const unreferencedTrack = await compileRemotionShotPlan(unreferencedTrackChanged);
    expect(unreferencedTrack.success).toBe(true);
    if (!unreferencedTrack.success) return;
    expect(unreferencedTrack.value.inputHash).toBe(baseline.value.inputHash);
  });

  it("rejects storyboard identity, state, and stale source fingerprints", async () => {
    const wrongIndex = input();
    wrongIndex.storyboard.index = 1;
    expectIssue(await compileRemotionShotPlan(wrongIndex), "$.storyboard.index");

    const notReady = input();
    notReady.storyboard.state = "rendering";
    expectIssue(await compileRemotionShotPlan(notReady), "$.storyboard.state");

    const missingFingerprint = input();
    missingFingerprint.storyboard.mediaRef!.contentSha256 = undefined;
    expectIssue(await compileRemotionShotPlan(missingFingerprint), "$.storyboard.mediaRef.contentSha256");

    const staleFingerprint = input();
    staleFingerprint.storyboard.mediaRef!.contentSha256 = TEST_SHA_B;
    expectIssue(await compileRemotionShotPlan(staleFingerprint), "$.storyboard.mediaRef.contentSha256");
  });

  it("requires current dialogue audio to match a shot-scoped voice binding", async () => {
    const validDialogue = input();
    validDialogue.storyboard.lines = "需要口播";
    validDialogue.storyboard.audioRef = {
      kind: "audio",
      path: "audio/shot-001.wav",
      contentSha256: TEST_SHA_B,
    };
    expect((await compileRemotionShotPlan(validDialogue)).success).toBe(true);

    const staleDialogue = input();
    staleDialogue.storyboard.lines = "需要口播";
    staleDialogue.storyboard.audioRef = {
      kind: "audio",
      path: "audio/old-shot-001.wav",
      contentSha256: TEST_SHA_C,
    };
    expectIssue(await compileRemotionShotPlan(staleDialogue), "$.storyboard.audioRef.contentSha256");
  });

  it("runtime-validates persisted plans and their canonical hash", async () => {
    const compiled = await compileRemotionShotPlan(input());
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    expect((await validateRemotionShotPlan(structuredClone(compiled.value))).success).toBe(true);

    const tampered = structuredClone(compiled.value);
    tampered.inputHash = TEST_SHA_C;
    expectIssue(await validateRemotionShotPlan(tampered), "$.inputHash");

    const wrongTarget = { ...structuredClone(compiled.value), target: "chapter" };
    expectIssue(await validateRemotionShotPlan(wrongTarget), "$.target");
  });

  it("reports the original binding index when shot audio capability resolution fails", async () => {
    const planInput = input();
    planInput.shot.audioBindings.reverse();
    const compiled = await compileRemotionShotPlan(planInput);
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    const projected = projectStoryboardShotCompositionProps(compiled.value, (reference) => {
      if (reference.relativePath.startsWith("audio/shot-")) throw new Error("audio capability unavailable");
      return MEDIA_URL;
    });
    expectIssue(projected, "$.shot.audioBindings[1].source");
  });

  it("requires current-revision human approval when the first chapter policy is enabled", async () => {
    const result = await compileRemotionShotPlan({ ...input(), requireHumanApproval: true });
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

function input() {
  const chapter = makeChapterManifest();
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
    shot: structuredClone(chapter.shots[0]),
    storyboard,
    sharedAudioTracks: structuredClone(chapter.sharedAudioTracks),
  };
}
