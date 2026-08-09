import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFinalOutputQc } from "./final-output-qc.mjs";

const sha = "a".repeat(64);
const artifact = {
  projectId: "project-1", chapterId: "chapter-1", revision: 2, mode: "editable-edl", stage: "ready", status: "accepted",
  evidence: { artifactSha256: sha }, preview: { path: "/tmp/preview.mp4", subtitlesBurnedIn: true }, subtitles: [{ text: "你好" }],
};
const hyperframes = {
  projectId: "project-1", chapterId: "chapter-1", revision: 2, status: "noop", sourceArtifactSha256: sha, inputSha256: sha,
};

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
});
