import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFinalOutputQc } from "./final-output-qc.mjs";

const sha = "a".repeat(64);
const artifact = {
  projectId: "project-1", chapterId: "chapter-1", revision: 2, mode: "editable-edl", stage: "ready", status: "accepted",
  evidence: { artifactSha256: sha }, preview: { path: "/tmp/preview.mp4", subtitlesBurnedIn: true },
  subtitles: [{ cueId: "cue-1", shotId: "shot-1", text: "你好", startUs: 0, durationUs: 1_000_000, source: "alignment" }],
  edl: [{ shotId: "shot-1", sourcePath: "/tmp/shot-1.mp4", sourceInS: 0, timelineStartS: 0, durationS: 1 }], overlaySlots: [],
  subtitleAuthority: { mode: "clean-remotion", evidence: { mode: "clean-remotion", decision: "imported-manifest", sourceFingerprint: sha, evidencePaths: ["/tmp/subtitle-evidence.json"] } },
};
const hyperframes = {
  projectId: "project-1", chapterId: "chapter-1", revision: 2, status: "noop", sourceArtifactSha256: sha, inputSha256: sha,
  windows: [],
};

function editingProject(artifactSha) {
  return {
    id: "editing-1", projectId: "project-1", episodeId: "chapter-1", revision: 2,
    renderSettings: { subtitleMode: "burn-in" },
    tracks: [{ id: "video", kind: "video" }, { id: "subtitles", kind: "text", name: "字幕" }],
    clips: [
      {
        id: "clip-1", trackId: "video", startUs: 0, durationUs: 1_000_000, trimStartUs: 0,
        source: { kind: "storyboardVideo", path: "/tmp/shot-1.mp4", evidence: { storyboardId: "shot-1", sourceFingerprint: artifactSha } },
      },
      {
        id: "video-use-subtitle-2-cue-1", trackId: "subtitles", startUs: 0, durationUs: 1_000_000,
        source: { kind: "text", text: "你好", evidence: { storyboardId: "shot-1", cueId: "cue-1", sourceFingerprint: artifactSha } },
        subtitle: { sourceFormat: "generated" },
      },
    ],
  };
}

describe("final output QC", () => {
  it("fails closed when output, evidence or artifacts are missing", async () => {
    const report = await runFinalOutputQc({ outputPath: join(mkdtempSync(join(tmpdir(), "mystudio-qc-")), "missing.mp4") });
    expect(report.ok).toBe(false);
    expect(report.readOnly).toBe(true);
    expect(report.issues.map((item) => item.code)).toContain("output.missing");
    expect(report.issues.map((item) => item.code)).toContain("evidence.missing");
  });

  it("rejects reusing a subtitle-burned preview as final output", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "preview.mp4");
    writeFileSync(outputPath, "not-an-mp4");
    const report = await runFinalOutputQc({
      outputPath,
      evidence: { path: outputPath, sizeBytes: 10, sha256: "b".repeat(64), streams: ["video", "audio"] },
      videoUseArtifact: { ...artifact, preview: { path: outputPath, subtitlesBurnedIn: true } },
      hyperFramesArtifact: hyperframes,
      ffprobePath: process.execPath,
    });
    expect(report.ok).toBe(false);
    expect(report.issues.map((item) => item.code)).toContain("subtitle.preview-burn-in");
  });

  it("rejects an ordinary video-use cue that is missing from the Remotion subtitle track", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "output.mp4");
    writeFileSync(outputPath, "not-an-mp4");
    const project = editingProject(sha);
    project.clips = project.clips.filter((clip) => clip.trackId !== "subtitles");
    const report = await runFinalOutputQc({
      outputPath,
      videoUseArtifact: artifact,
      hyperFramesArtifact: hyperframes,
      editingProject: project,
      evidence: { projectId: "project-1", target: { kind: "chapter", chapterId: "chapter-1", editingProjectId: "editing-1", editingRevision: 2 }, inputHash: sha, outputPath, sizeBytes: 10, mtimeMs: 1, sha256: sha, streams: ["video", "audio"] },
      ffprobePath: process.execPath,
    });
    expect(report.issues.map((item) => item.code)).toContain("subtitle.remotion-missing");
  });

  it("rejects a HyperFrames-owned animated cue that is also projected to Remotion", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "output.mp4");
    writeFileSync(outputPath, "not-an-mp4");
    const report = await runFinalOutputQc({
      outputPath,
      videoUseArtifact: { ...artifact, overlaySlots: [{ slotId: "cue-1", startUs: 0, durationUs: 1_000_000 }] },
      hyperFramesArtifact: { ...hyperframes, windows: [{ slotId: "cue-1", startUs: 0, durationUs: 1_000_000 }] },
      editingProject: editingProject(sha),
      evidence: { projectId: "project-1", target: { kind: "chapter", chapterId: "chapter-1", editingProjectId: "editing-1", editingRevision: 2 }, inputHash: sha, outputPath, sizeBytes: 10, mtimeMs: 1, sha256: sha, streams: ["video", "audio"] },
      ffprobePath: process.execPath,
    });
    expect(report.issues.map((item) => item.code)).toContain("subtitle.animated-duplicate");
  });

  it("accepts canonical ChapterVideo evidence streams and binds every core field", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "output.mp4");
    const ffprobePath = join(root, "ffprobe");
    writeFileSync(outputPath, "mp4-fixture");
    writeFileSync(ffprobePath, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({format:{duration:1},streams:[{codec_type:'video',codec_name:'h264',duration:1,width:640,height:360},{codec_type:'audio',codec_name:'aac',duration:1}]}));\n");
    chmodSync(ffprobePath, 0o755);
    const stat = statSync(outputPath);
    const outputSha = createHash("sha256").update("mp4-fixture").digest("hex");
    const artifactSha = "b".repeat(64);
    const report = await runFinalOutputQc({
      outputPath,
      ffprobePath,
      videoUseArtifact: {
        ...artifact,
        evidence: { inputSha256: sha, artifactSha256: artifactSha, toolVersion: "video-use@test" },
        review: { projectId: "project-1", chapterId: "chapter-1", revision: 2, artifactSha256: artifactSha, reviewer: "user", decision: "accepted", timestamp: 2 },
      },
      hyperFramesArtifact: { ...hyperframes, sourceArtifactSha256: artifactSha },
      editingProject: editingProject(artifactSha),
      evidence: {
        projectId: "project-1",
        target: { kind: "chapter", chapterId: "chapter-1", editingProjectId: "editing-1", editingRevision: 2 },
        inputHash: sha,
        outputPath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: outputSha,
        streams: [{ kind: "video", codec: "h264", width: 640, height: 360 }, { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 }],
      },
    });

    expect(report.ok).toBe(true);
  });

  it("keeps video-use input SHA separate from ChapterVideo render identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "output.mp4");
    const ffprobePath = join(root, "ffprobe");
    writeFileSync(outputPath, "mp4-dual-hash-fixture");
    writeFileSync(ffprobePath, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({format:{duration:1},streams:[{codec_type:'video',codec_name:'h264',duration:1,width:640,height:360},{codec_type:'audio',codec_name:'aac',duration:1}]}));\n");
    chmodSync(ffprobePath, 0o755);
    const stat = statSync(outputPath);
    const outputSha = createHash("sha256").update("mp4-dual-hash-fixture").digest("hex");
    const videoUseInputSha = "c".repeat(64);
    const renderInputHash = "d".repeat(64);
    const artifactSha = "e".repeat(64);
    const report = await runFinalOutputQc({
      outputPath,
      ffprobePath,
      expected: { projectId: "project-1", chapterId: "chapter-1", revision: 2, mode: "editable-edl", inputSha256: renderInputHash, videoUseInputSha256: videoUseInputSha, width: 640, height: 360, durationS: 1, fps: 30 },
      videoUseArtifact: {
        ...artifact,
        evidence: { inputSha256: videoUseInputSha, artifactSha256: artifactSha, toolVersion: "video-use@test" },
        review: { projectId: "project-1", chapterId: "chapter-1", revision: 2, artifactSha256: artifactSha, reviewer: "user", decision: "accepted", timestamp: 2 },
      },
      hyperFramesArtifact: { ...hyperframes, sourceArtifactSha256: artifactSha, inputSha256: videoUseInputSha },
      editingProject: editingProject(artifactSha),
      evidence: {
        projectId: "project-1",
        target: { kind: "chapter", chapterId: "chapter-1", editingProjectId: "editing-1", editingRevision: 2 },
        inputHash: renderInputHash,
        outputPath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: outputSha,
        streams: [{ kind: "video", codec: "h264", width: 640, height: 360 }, { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 }],
      },
    });

    if (!report.ok) console.log("dual-hash issues", report.issues);
    expect(report.ok).toBe(true);
  });

  it("accepts an absolute video-use EDL path against a project-relative projection", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "output.mp4");
    const shotPath = join(root, "projects", "_p", "project-1", "remotion", "outputs", "shots", "chapter-1", "shot-1", "current.mp4");
    const ffprobePath = join(root, "ffprobe");
    writeFileSync(outputPath, "mp4-relative-project-fixture");
    writeFileSync(ffprobePath, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({format:{duration:1},streams:[{codec_type:'video',codec_name:'h264',duration:1,width:640,height:360},{codec_type:'audio',codec_name:'aac',duration:1}]}));\n");
    chmodSync(ffprobePath, 0o755);
    const stat = statSync(outputPath);
    const outputSha = createHash("sha256").update("mp4-relative-project-fixture").digest("hex");
    const artifactSha = "7".repeat(64);
    const relativeArtifact = {
      ...artifact,
      edl: [{ shotId: "shot-1", sourcePath: shotPath, sourceInS: 0, timelineStartS: 0, durationS: 1 }],
      evidence: { inputSha256: sha, artifactSha256: artifactSha, toolVersion: "video-use@test" },
      review: { projectId: "project-1", chapterId: "chapter-1", revision: 2, artifactSha256: artifactSha, reviewer: "user", decision: "accepted", timestamp: 2 },
    };
    const project = editingProject(artifactSha);
    project.clips[0].source.path = "outputs/shots/chapter-1/shot-1/current.mp4";
    const report = await runFinalOutputQc({
      outputPath,
      ffprobePath,
      videoUseArtifact: relativeArtifact,
      hyperFramesArtifact: { ...hyperframes, sourceArtifactSha256: artifactSha },
      editingProject: project,
      evidence: {
        projectId: "project-1",
        target: { kind: "chapter", chapterId: "chapter-1", editingProjectId: "editing-1", editingRevision: 2 },
        inputHash: sha,
        outputPath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: outputSha,
        streams: [{ kind: "video", codec: "h264", width: 640, height: 360 }, { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 }],
      },
    });
    expect(report.ok).toBe(true);
  });

  it("accepts a flat clean source only when its independent SHA and projection match", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "output.mp4");
    const cleanPath = join(root, "clean-flat.mp4");
    const ffprobePath = join(root, "ffprobe");
    writeFileSync(outputPath, "mp4-flat-final");
    writeFileSync(cleanPath, "mp4-flat-clean");
    writeFileSync(ffprobePath, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({format:{duration:1},streams:[{codec_type:'video',codec_name:'h264',duration:1,width:640,height:360},{codec_type:'audio',codec_name:'aac',duration:1}]}));\n");
    chmodSync(ffprobePath, 0o755);
    const stat = statSync(outputPath);
    const outputSha = createHash("sha256").update("mp4-flat-final").digest("hex");
    const cleanSha = createHash("sha256").update("mp4-flat-clean").digest("hex");
    const artifactSha = "f".repeat(64);
    const flatArtifact = {
      ...artifact,
      mode: "flat-shot-mp4",
      flatShotMp4Path: cleanPath,
      flatShotMp4Sha256: cleanSha,
      evidence: { inputSha256: sha, artifactSha256: artifactSha, toolVersion: "video-use@test" },
      review: { projectId: "project-1", chapterId: "chapter-1", revision: 2, artifactSha256: artifactSha, reviewer: "user", decision: "accepted", timestamp: 2 },
    };
    const project = editingProject(artifactSha);
    project.clips[0].source.path = cleanPath;
    const report = await runFinalOutputQc({
      outputPath,
      ffprobePath,
      videoUseArtifact: flatArtifact,
      hyperFramesArtifact: { ...hyperframes, sourceArtifactSha256: artifactSha },
      editingProject: project,
      evidence: {
        projectId: "project-1",
        target: { kind: "chapter", chapterId: "chapter-1", editingProjectId: "editing-1", editingRevision: 2 },
        inputHash: sha,
        outputPath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: outputSha,
        streams: [{ kind: "video", codec: "h264", width: 640, height: 360 }, { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 }],
      },
    });
    expect(report.ok).toBe(true);
  });

  it("rejects stale flat projection and HyperFrames evidence bindings", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "output.mp4");
    writeFileSync(outputPath, "mp4-fixture");
    const flatArtifact = {
      ...artifact,
      mode: "flat-shot-mp4",
      flatShotMp4Path: "/tmp/clean-flat.mp4",
      evidence: { inputSha256: sha, artifactSha256: "b".repeat(64), toolVersion: "video-use@test" },
      review: { projectId: "project-1", chapterId: "chapter-1", revision: 2, artifactSha256: "b".repeat(64), reviewer: "user", decision: "accepted", timestamp: 2 },
    };
    const report = await runFinalOutputQc({
      outputPath,
      videoUseArtifact: flatArtifact,
      hyperFramesArtifact: { ...hyperframes, sourceArtifactSha256: flatArtifact.evidence.artifactSha256, inputSha256: "c".repeat(64), windows: [{ slotId: "unexpected", startUs: 0, durationUs: 1 }] },
      editingProject: editingProject("d".repeat(64)),
      evidence: { projectId: "project-1", target: { kind: "chapter", chapterId: "chapter-1", editingProjectId: "editing-1", editingRevision: 2 }, inputHash: sha, outputPath, sizeBytes: 11, mtimeMs: 1, sha256: sha, streams: ["video", "audio"] },
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "hyperframes.input-sha",
      "hyperframes.windows",
      "editing-project.flat-source",
    ]));
  });

  it("rejects a flat artifact whose clean MP4 path is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "output.mp4");
    writeFileSync(outputPath, "mp4-flat-final");
    const artifactSha = "1".repeat(64);
    const flatArtifact = {
      ...artifact,
      mode: "flat-shot-mp4",
      flatShotMp4Path: join(root, "missing-clean.mp4"),
      flatShotMp4Sha256: "2".repeat(64),
      evidence: { inputSha256: sha, artifactSha256: artifactSha, toolVersion: "video-use@test" },
      review: { projectId: "project-1", chapterId: "chapter-1", revision: 2, artifactSha256: artifactSha, reviewer: "user", decision: "accepted", timestamp: 2 },
    };
    const report = await runFinalOutputQc({
      outputPath,
      videoUseArtifact: flatArtifact,
      hyperFramesArtifact: { ...hyperframes, sourceArtifactSha256: artifactSha },
      editingProject: editingProject(artifactSha),
      evidence: { projectId: "project-1", target: { kind: "chapter", chapterId: "chapter-1", editingProjectId: "editing-1", editingRevision: 2 }, inputHash: sha, outputPath, sizeBytes: 15, mtimeMs: 1, sha256: sha, streams: ["video", "audio"] },
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((item) => item.code)).toContain("video-use.flat-input-missing");
  });

  it("rejects evidence with missing core fields instead of treating it as optional", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "output.mp4");
    writeFileSync(outputPath, "mp4-fixture");
    const report = await runFinalOutputQc({
      outputPath,
      evidence: {
        projectId: "project-1",
        target: { kind: "chapter", chapterId: "chapter-1", editingRevision: 2 },
        inputHash: sha,
        outputPath,
        streams: ["video", "audio"],
      },
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["evidence.size", "evidence.mtime", "evidence.sha256"]));
  });

  it("rejects an accepted video-use artifact whose input fingerprint is missing or drifted", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-"));
    const outputPath = join(root, "output.mp4");
    writeFileSync(outputPath, "mp4-fixture");
    const report = await runFinalOutputQc({
      outputPath,
      expected: { inputSha256: sha },
      videoUseArtifact: {
        ...artifact,
        evidence: { artifactSha256: sha, toolVersion: "video-use@test" },
      },
      hyperFramesArtifact: hyperframes,
      evidence: {
        projectId: "project-1",
        target: { kind: "chapter", chapterId: "chapter-1", editingRevision: 2 },
        inputHash: sha,
        outputPath,
        sizeBytes: 11,
        mtimeMs: 1,
        sha256: sha,
        streams: ["video", "audio"],
      },
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((item) => item.code)).toContain("video-use.evidence-input-sha");
  });

  it("fails closed for unknown authority and missing evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-authority-"));
    const outputPath = join(root, "output.mp4");
    writeFileSync(outputPath, "mp4-fixture");
    const unknown = { ...artifact, subtitleAuthority: { mode: "unknown" } };
    const report = await runFinalOutputQc({ outputPath, videoUseArtifact: unknown, hyperFramesArtifact: hyperframes });
    expect(report.issues.map((item) => item.code)).toContain("subtitle.authority.unknown");
  });

  it("rejects source-embedded text/overlay and detects source SHA drift", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-embedded-"));
    const outputPath = join(root, "output.mp4");
    const sourcePath = join(root, "source.mp4");
    const evidencePath = join(root, "frame.json");
    writeFileSync(outputPath, "mp4-fixture");
    writeFileSync(sourcePath, "embedded-source");
    writeFileSync(evidencePath, "approved-frame");
    const sourceSha = createHash("sha256").update("different-source").digest("hex");
    const embedded = {
      ...artifact,
      edl: [{ shotId: "shot-1", sourcePath, sourceInS: 0, timelineStartS: 0, durationS: 1 }],
      subtitleAuthority: {
        mode: "source-embedded",
        evidence: { mode: "source-embedded", decision: "human", sourceFingerprint: sourceSha, evidencePaths: [evidencePath] },
      },
      overlaySlots: [{ slotId: "cue-1", startUs: 0, durationUs: 1_000_000 }],
    };
    const report = await runFinalOutputQc({
      outputPath,
      videoUseArtifact: embedded,
      hyperFramesArtifact: { ...hyperframes, windows: [{ slotId: "cue-1", startUs: 0, durationUs: 1_000_000 }] },
      editingProject: editingProject(sha),
    });
    expect(report.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "subtitle.authority.source-sha-drift",
      "subtitle.embedded-text",
      "subtitle.embedded-overlay",
    ]));
  });

  it("rejects missing source-embedded evidence files", async () => {
    const root = mkdtempSync(join(tmpdir(), "mystudio-qc-evidence-"));
    const outputPath = join(root, "output.mp4");
    const sourcePath = join(root, "source.mp4");
    writeFileSync(outputPath, "mp4-fixture");
    writeFileSync(sourcePath, "embedded-source");
    const sourceSha = createHash("sha256").update("embedded-source").digest("hex");
    const report = await runFinalOutputQc({
      outputPath,
      videoUseArtifact: {
        ...artifact,
        edl: [{ shotId: "shot-1", sourcePath, sourceInS: 0, timelineStartS: 0, durationS: 1 }],
        subtitleAuthority: { mode: "source-embedded", evidence: { mode: "source-embedded", decision: "human", sourceFingerprint: sourceSha, evidencePaths: [join(root, "missing-frame.png")] } },
        overlaySlots: [],
      },
      hyperFramesArtifact: hyperframes,
      editingProject: editingProject(sha),
    });
    expect(report.issues.map((item) => item.code)).toContain("subtitle.authority.evidence-missing");
  });
});
