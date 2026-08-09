import { describe, expect, it } from "vitest";
import {
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
  return { slotId: "slot-1", startUs: 0, durationUs: 1_000_000, templateId: "title", parameters: {} };
}

describe("video workflow persisted child contracts", () => {
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
      ]));
    }
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
      windows: [{ slotId: "slot-1", startUs: 0, durationUs: 1_000_000, templateId: "title" }],
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
});
