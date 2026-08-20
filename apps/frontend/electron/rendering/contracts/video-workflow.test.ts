import { describe, expect, it } from "vitest";
import {
  isSubtitleCueOwnedByOverlay,
  validateHyperFramesOverlayArtifact,
  validateHyperFramesOverlayRequest,
  validateVideoUseChapterArtifact,
} from "./video-workflow";

const hash = "a".repeat(64);

function validVideoUseArtifact(): Record<string, unknown> & {
  alignment: Array<Record<string, unknown> & { words: Array<Record<string, unknown>> }>;
  subtitles: Array<Record<string, unknown>>;
  overlaySlots: Array<Record<string, unknown>>;
  derivedInputs?: Array<Record<string, unknown> & { derivedSha256: string }>;
} {
  return {
    schemaVersion: 1,
    projectId: "project-1",
    chapterId: "chapter-1",
    revision: 1,
    mode: "editable-edl",
    stage: "ready",
    status: "accepted",
    timeUnit: "seconds",
    timelineTimeUnit: "microseconds",
    sourceSha256: hash,
    audioSha256: hash,
    textSha256: hash,
    alignment: [{
      cueId: "cue-1",
      shotId: "shot-1",
      text: "你好",
      startUs: 0,
      durationUs: 1_000_000,
      confidence: 1,
      words: [{ id: "word-1", text: "你好", startUs: 0, durationUs: 1_000_000, confidence: 1 }],
    }],
    edl: [{ shotId: "shot-1", sourcePath: "/tmp/shot.mp4", sourceInS: 0, sourceOutS: 1, timelineStartS: 0, durationS: 1 }],
    subtitles: [{ cueId: "cue-1", shotId: "shot-1", text: "你好", startUs: 0, durationUs: 1_000_000, source: "alignment" }],
    grade: { filter: "none", parameters: {} },
    overlaySlots: [],
    preview: { path: "/tmp/preview.mp4", sha256: hash, subtitlesBurnedIn: true, durationS: 1 },
    selfEval: { passed: true, score: 1, notes: [], evaluatedAt: 1 },
    evidence: { inputSha256: hash, artifactSha256: hash, toolVersion: "video-use@test" },
    review: { projectId: "project-1", chapterId: "chapter-1", revision: 1, artifactSha256: hash, reviewer: "user", decision: "accepted", timestamp: 2 },
  };
}

function validOverlayWindow() {
  return { slotId: "slot-1", cueId: "cue-1", startUs: 0, durationUs: 1_000_000, templateId: "title", parameters: {} };
}

describe("video workflow persisted child contracts", () => {
  it("assigns overlapping animated cues to HyperFrames and leaves ordinary cues to Remotion", () => {
    const cue = { cueId: "cue-1", shotId: "shot-1", text: "你好", startUs: 100_000, durationUs: 400_000, source: "alignment" as const };
    expect(isSubtitleCueOwnedByOverlay(cue, [{ slotId: "caption-1", cueId: "cue-1", startUs: 200_000, durationUs: 100_000 }])).toBe(true);
    expect(isSubtitleCueOwnedByOverlay(cue, [{ slotId: "caption-2", cueId: "cue-2", startUs: 500_000, durationUs: 100_000 }])).toBe(false);
  });

  it("rejects alignment words without their timing fields", () => {
    const artifact = validVideoUseArtifact();
    artifact.alignment[0].words = [{ id: "word-1", text: "你好", confidence: 1 }];

    const result = validateVideoUseChapterArtifact(artifact);

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.issues.map((item) => item.path)).toContain("$.alignment[0].words[0].startUs");
  });

  it("rejects subtitle and overlay children without identity fields", () => {
    const artifact = validVideoUseArtifact();
    artifact.subtitles = [{ startUs: 0, durationUs: 1_000_000, source: "alignment" }];
    artifact.overlaySlots = [{ startUs: 0, durationUs: 1_000_000 }];

    const result = validateVideoUseChapterArtifact(artifact);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((item) => item.path)).toEqual(expect.arrayContaining([
        "$.subtitles[0].cueId",
        "$.subtitles[0].shotId",
        "$.subtitles[0].text",
        "$.overlaySlots[0].slotId",
        "$.overlaySlots[0].cueId",
      ]));
    }
  });

  it("accepts decorative artifact slots and rejects text-owned templates", () => {
    const artifact = validVideoUseArtifact();
    artifact.overlaySlots = [{
      slotId: "effect-shot-1", cueId: "decorative-effect-1", startUs: 0, durationUs: 1_000_000,
      templateId: "lens-flare", parameters: { x: 18, size: 260 }, moodWord: "战斗",
    }];
    expect(validateVideoUseChapterArtifact(artifact).success).toBe(true);
    artifact.overlaySlots[0].templateId = "kinetic-caption";
    expect(validateVideoUseChapterArtifact(artifact).success).toBe(false);
    artifact.overlaySlots[0].templateId = "title-card";
    expect(validateVideoUseChapterArtifact(artifact).success).toBe(false);
  });

  it("keeps legacy subtitle-only artifact slots valid", () => {
    const artifact = validVideoUseArtifact();
    artifact.overlaySlots = [{ slotId: "caption-1", cueId: "cue-1", startUs: 0, durationUs: 1_000_000 }];
    expect(validateVideoUseChapterArtifact(artifact).success).toBe(true);
  });

  it("rejects overlay windows without template parameters at IPC-adjacent boundaries", () => {
    const request = {
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      sourceArtifactSha256: hash,
      inputSha256: hash,
      width: 640,
      height: 360,
      fps: 30,
      alphaFormat: "prores-4444-mov",
      outputPath: "/tmp/overlay.mov",
      windows: [{ slotId: "slot-1", cueId: "cue-1", startUs: 0, durationUs: 1_000_000, templateId: "title" }],
    };
    const artifact = {
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      status: "noop",
      sourceArtifactSha256: hash,
      inputSha256: hash,
      alphaFormat: "prores-4444-mov",
      windows: [{ ...validOverlayWindow(), parameters: undefined }],
      toolVersion: "hyperframes@test",
      generatedAt: 1,
    };

    expect(validateHyperFramesOverlayRequest(request).success).toBe(false);
    expect(validateHyperFramesOverlayArtifact(artifact).success).toBe(false);
  });

  it("rejects placeholder provenance hashes before HyperFrames rendering or acceptance", () => {
    const request = {
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      sourceArtifactSha256: "0".repeat(64),
      inputSha256: "0".repeat(64),
      width: 640,
      height: 360,
      fps: 30,
      alphaFormat: "prores-4444-mov",
      outputPath: "/tmp/overlay.mov",
      windows: [validOverlayWindow()],
    };
    const artifact = {
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      status: "accepted",
      sourceArtifactSha256: "0".repeat(64),
      inputSha256: "0".repeat(64),
      alphaFormat: "prores-4444-mov",
      outputPath: "/tmp/overlay.mov",
      outputSha256: hash,
      windows: [validOverlayWindow()],
      toolVersion: "hyperframes@test",
      generatedAt: 1,
    };

    expect(validateHyperFramesOverlayRequest(request).success).toBe(false);
    expect(validateHyperFramesOverlayArtifact(artifact).success).toBe(false);
  });

  it("rejects PNG sequence before HyperFrames can create an artifact", () => {
    const request = {
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      sourceArtifactSha256: hash,
      inputSha256: hash,
      width: 640,
      height: 360,
      fps: 30,
      alphaFormat: "png-sequence",
      outputPath: "/tmp/overlay-frames",
      windows: [validOverlayWindow()],
    };
    const artifact = {
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      status: "accepted",
      sourceArtifactSha256: hash,
      inputSha256: hash,
      alphaFormat: "png-sequence",
      outputPath: "/tmp/overlay-frames",
      outputSha256: hash,
      windows: [validOverlayWindow()],
      toolVersion: "hyperframes@test",
      generatedAt: 1,
    };

    expect(validateHyperFramesOverlayRequest(request).success).toBe(false);
    expect(validateHyperFramesOverlayArtifact(artifact).success).toBe(false);
  });

  it("accepts auditable derived-input evidence and rejects incomplete hashes", () => {
    const artifact = validVideoUseArtifact();
    artifact.derivedInputs = [{
      schemaVersion: 1,
      kind: "padded-video",
      derivation: "ffmpeg-tpad-clone-apad",
      sourcePath: "/tmp/source.mp4",
      sourceSha256: hash,
      sourceDurationUs: 900_000,
      derivedPath: "/tmp/derived.mp4",
      derivedSha256: hash,
      derivedDurationUs: 1_000_000,
      derivedRevision: 1,
      createdAt: 2,
    }];
    expect(validateVideoUseChapterArtifact(artifact).success).toBe(true);
    artifact.derivedInputs[0].derivedSha256 = "bad";
    expect(validateVideoUseChapterArtifact(artifact).success).toBe(false);
  });

  it("requires a clean standalone MP4 for flat-shot artifacts", () => {
    const artifact = validVideoUseArtifact();
    artifact.mode = "flat-shot-mp4";
    artifact.flatShotMp4Path = (artifact.preview as { path: string }).path;

    const reusedPreview = validateVideoUseChapterArtifact(artifact);

    expect(reusedPreview.success).toBe(false);
    expect(reusedPreview.success ? [] : reusedPreview.issues.map((item) => item.path)).toContain("$.flatShotMp4Path");

    artifact.flatShotMp4Path = "/tmp/clean-flat.mov";
    expect(validateVideoUseChapterArtifact(artifact).success).toBe(false);

    artifact.flatShotMp4Path = "/tmp/clean-flat.mp4";
    expect(validateVideoUseChapterArtifact(artifact).success).toBe(true);
  });
});

describe("video-use EDL transitionToNext validation", () => {
  function artifactWithTransition(transition: Record<string, unknown>) {
    const artifact = validVideoUseArtifact();
    artifact.edl = [
      { shotId: "shot-1", sourcePath: "/tmp/a.mp4", sourceInS: 0, sourceOutS: 3.2, timelineStartS: 0, durationS: 3.2, transitionToNext: transition },
      { shotId: "shot-2", sourcePath: "/tmp/b.mp4", sourceInS: 0, sourceOutS: 3.0, timelineStartS: 3.2, durationS: 3.0 },
    ];
    return artifact;
  }

  it("accepts a legal crossfade transition with style word provenance", () => {
    const result = validateVideoUseChapterArtifact(artifactWithTransition({ effectId: "crossfade", durationUs: 600_000, styleWord: "水墨晕染" }));
    expect(result.success).toBe(true);
  });

  it("accepts registered GL transitions and rejects unknown GL identifiers", () => {
    expect(validateVideoUseChapterArtifact(artifactWithTransition({
      effectId: "gl:swap",
      durationUs: 600_000,
      styleWord: "水墨晕染",
    })).success).toBe(true);
    expect(validateVideoUseChapterArtifact(artifactWithTransition({
      effectId: "gl:NotInRegistry",
      durationUs: 600_000,
    })).success).toBe(false);
  });

  it("accepts a slow ink-wash crossfade at 1s (tuned ceiling 1.2s)", () => {
    const result = validateVideoUseChapterArtifact(artifactWithTransition({ effectId: "crossfade", durationUs: 1_000_000, styleWord: "水墨晕染" }));
    expect(result.success).toBe(true);
  });

  it("keeps legacy artifacts (no transitionToNext) valid", () => {
    const artifact = validVideoUseArtifact();
    expect((artifact.edl as Array<Record<string, unknown>>)[0]).not.toHaveProperty("transitionToNext");
    expect(validateVideoUseChapterArtifact(artifact).success).toBe(true);
  });

  it.each([
    ["unknown effectId", { effectId: "wipe", durationUs: 600_000 }],
    ["too short", { effectId: "fade", durationUs: 100_000 }],
    ["too long (hard cap)", { effectId: "fade", durationUs: 1_300_000 }],
    ["over half of own shot", { effectId: "fade", durationUs: 1_800_000 }],
    ["non-integer duration", { effectId: "fade", durationUs: 500_000.5 }],
    ["not an object", "crossfade"],
  ])("rejects %s", (_label, transition) => {
    const result = validateVideoUseChapterArtifact(artifactWithTransition(transition as Record<string, unknown>));
    expect(result.success).toBe(false);
  });

  it("rejects a transition longer than half of the NEXT shot", () => {
    const artifact = validVideoUseArtifact();
    artifact.edl = [
      { shotId: "shot-1", sourcePath: "/tmp/a.mp4", sourceInS: 0, sourceOutS: 3.2, timelineStartS: 0, durationS: 3.2, transitionToNext: { effectId: "fade", durationUs: 700_000 } },
      { shotId: "shot-2", sourcePath: "/tmp/b.mp4", sourceInS: 0, sourceOutS: 0.9, timelineStartS: 3.2, durationS: 0.9 },
    ];
    expect(validateVideoUseChapterArtifact(artifact).success).toBe(false);
  });
});
