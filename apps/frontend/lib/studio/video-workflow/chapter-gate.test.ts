import { describe, expect, it } from "vitest";
import type {
  HyperFramesOverlayArtifactV1,
  VideoUseChapterArtifactV1,
} from "@rendering/contracts/video-workflow";
import { evaluateRemotionChapterGate } from "./chapter-gate";

const hash = "a".repeat(64);
const videoUseArtifact: VideoUseChapterArtifactV1 = {
  schemaVersion: 1,
  projectId: "project-1",
  chapterId: "chapter-1",
  revision: 2,
  mode: "editable-edl",
  stage: "ready",
  status: "accepted",
  timeUnit: "seconds",
  timelineTimeUnit: "microseconds",
  sourceSha256: hash,
  audioSha256: hash,
  textSha256: hash,
  alignment: [],
  edl: [{ shotId: "shot-1", sourcePath: "/tmp/shot.mp4", sourceInS: 0, sourceOutS: 1, timelineStartS: 0, durationS: 1 }],
  subtitles: [],
  grade: { filter: "none", parameters: {} },
  overlaySlots: [],
  preview: { path: "/tmp/preview.mp4", sha256: hash, subtitlesBurnedIn: true, durationS: 1 },
  selfEval: { passed: true, score: 1, notes: [], evaluatedAt: 1 },
  evidence: { inputSha256: hash, artifactSha256: "b".repeat(64), toolVersion: "video-use@fixture" },
  review: { projectId: "project-1", chapterId: "chapter-1", revision: 2, artifactSha256: "b".repeat(64), reviewer: "user@example.com", decision: "accepted", timestamp: 2 },
};
const hyperFramesArtifact: HyperFramesOverlayArtifactV1 = {
  schemaVersion: 1,
  projectId: "project-1",
  chapterId: "chapter-1",
  revision: 2,
  status: "noop",
  sourceArtifactSha256: "b".repeat(64),
  inputSha256: hash,
  alphaFormat: "prores-4444-mov",
  windows: [],
  toolVersion: "hyperframes@fixture",
  generatedAt: 1,
};

describe("evaluateRemotionChapterGate", () => {
  it("accepts an editable artifact and an auditable no-op overlay", () => {
    expect(evaluateRemotionChapterGate({ projectId: "project-1", chapterId: "chapter-1", revision: 2, inputSha256: hash, videoUseArtifact, hyperFramesArtifact })).toEqual({
      accepted: true,
      mode: "editable-edl",
      videoUseArtifactSha256: "b".repeat(64),
      hyperFramesStatus: "noop",
    });
  });

  it("keeps the video-use source fingerprint separate from the Remotion job hash", () => {
    const result = evaluateRemotionChapterGate({
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 2,
      inputSha256: "d".repeat(64),
      videoUseInputSha256: hash,
      videoUseArtifact,
      hyperFramesArtifact,
    });
    expect(result.accepted).toBe(true);
  });

  it("passes flat clean-source and derived-input evidence to the Remotion renderer", () => {
    const flat = {
      ...videoUseArtifact,
      mode: "flat-shot-mp4" as const,
      flatShotMp4Path: "/tmp/clean-flat.mp4",
      flatShotMp4Sha256: "c".repeat(64),
      derivedInputs: [{
        schemaVersion: 1 as const,
        kind: "padded-video" as const,
        derivation: "ffmpeg-tpad-clone-apad" as const,
        sourcePath: "/tmp/source.mp4",
        sourceSha256: hash,
        sourceDurationUs: 1,
        derivedPath: "/tmp/derived.mp4",
        derivedSha256: "d".repeat(64),
        derivedDurationUs: 2,
        derivedRevision: 2,
        createdAt: 1,
      }],
    };
    const result = evaluateRemotionChapterGate({ projectId: "project-1", chapterId: "chapter-1", revision: 2, inputSha256: hash, videoUseArtifact: flat, hyperFramesArtifact });
    expect(result).toMatchObject({
      accepted: true,
      mode: "flat-shot-mp4",
      videoUseFlatShotMp4Path: "/tmp/clean-flat.mp4",
      videoUseFlatShotMp4Sha256: "c".repeat(64),
      videoUseDerivedInputs: flat.derivedInputs,
    });
  });

  it("blocks missing or drifted artifacts", () => {
    const missingVideo = evaluateRemotionChapterGate({ projectId: "project-1", chapterId: "chapter-1", revision: 2, inputSha256: hash });
    const missingOverlay = evaluateRemotionChapterGate({ projectId: "project-1", chapterId: "chapter-1", revision: 2, inputSha256: hash, videoUseArtifact });
    const drifted = evaluateRemotionChapterGate({ projectId: "project-1", chapterId: "chapter-1", revision: 3, inputSha256: hash, videoUseArtifact, hyperFramesArtifact });
    expect(missingVideo.accepted).toBe(false);
    expect(missingOverlay.accepted).toBe(false);
    expect(drifted.accepted).toBe(false);
    if (!missingVideo.accepted && !missingOverlay.accepted && !drifted.accepted) {
      expect(missingVideo.code).toBe("video-use-missing");
      expect(missingOverlay.code).toBe("hyperframes-missing");
      expect(drifted.code).toBe("video-use-identity-mismatch");
    }
  });

  it("blocks accepted artifacts without a bound review sidecar", () => {
    const { review: _review, ...unreviewed } = videoUseArtifact;
    const result = evaluateRemotionChapterGate({ projectId: "project-1", chapterId: "chapter-1", revision: 2, inputSha256: hash, videoUseArtifact: unreviewed, hyperFramesArtifact });
    expect(result).toMatchObject({ accepted: false, state: "blocked", code: "video-use-review-missing" });
  });

  it("blocks a review sidecar whose artifact hash does not match", () => {
    const result = evaluateRemotionChapterGate({
      projectId: "project-1", chapterId: "chapter-1", revision: 2, inputSha256: hash,
      videoUseArtifact: { ...videoUseArtifact, review: { ...videoUseArtifact.review!, artifactSha256: "c".repeat(64) } },
      hyperFramesArtifact,
    });
    expect(result).toMatchObject({ accepted: false, state: "blocked", code: "video-use-review-invalid" });
  });
});
