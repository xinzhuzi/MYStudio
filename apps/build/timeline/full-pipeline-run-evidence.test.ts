import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildFullPipelineRunEvidence } from "./full-pipeline-run-evidence";

const RENDER_INPUT_SHA = "a".repeat(64);
const VIDEO_USE_INPUT_SHA = "b".repeat(64);
const BUNDLE_SHA = "c".repeat(64);
const OUTPUT_SHA = "d".repeat(64);
const FULL_RENDER_SETTINGS = {
  width: 1920,
  height: 1080,
  fps: 30,
  codec: "h264" as const,
  subtitleMode: "burn-in" as const,
  subtitleFont: "ma-shan-zheng",
  chapterGrade: { lutId: "cn-ink-cyan", blend: 0.75 },
  atmosphereMode: "off" as const,
  subtitleSfxEnabled: true,
  loudnessLufs: -14,
  truePeakDbtp: -1.5,
  audioDucking: { reductionDb: -12, attackUs: 120_000, releaseUs: 400_000 },
};

describe("full-pipeline ChapterVideo evidence", () => {
  it("builds validated relative evidence and keeps render/video-use hashes distinct", async () => {
    const runRoot = path.resolve("/tmp/full-pipeline-1");
    const result = await buildFullPipelineRunEvidence({
      projectId: "project-a",
      chapterId: "chapter-001",
      editingProjectId: "editing-a",
      editingRevision: 7,
      mode: "editable-edl",
      renderInputSha256: RENDER_INPUT_SHA,
      videoUseInputSha256: VIDEO_USE_INPUT_SHA,
      bundleContentHash: BUNDLE_SHA,
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      renderSettings: FULL_RENDER_SETTINGS,
      expectedDurationS: 9.5,
      runRoot,
      outputPath: path.join(runRoot, "remotion", "output.mp4"),
      inputManifestPath: path.join(runRoot, "input-manifest.json"),
      renderPlanPath: path.join(runRoot, "timeline-render-plan.json"),
      snapshotPath: path.join(runRoot, "editing-project.json"),
      outputSizeBytes: 1234,
      outputMtimeMs: 1_700_000_000_000,
      outputSha256: OUTPUT_SHA,
      probe: {
        raw: {
          format: { duration: "10" },
          streams: [
            { codec_type: "video", codec_name: "h264", duration: "10", width: 1920, height: 1080 },
            { codec_type: "audio", codec_name: "aac", duration: "10", channels: 2, sample_rate: "48000" },
          ],
        },
        duration: 10,
        width: 1920,
        height: 1080,
        streams: ["video", "audio"],
        videoCodec: "h264",
        audioCodec: "aac",
      },
      startedAt: 1000,
      completedAt: 2000,
    });

    expect(result.evidence).toMatchObject({
      projectId: "project-a",
      target: { kind: "chapter", chapterId: "chapter-001", editingProjectId: "editing-a", editingRevision: 7 },
      inputHash: RENDER_INPUT_SHA,
      bundleContentHash: BUNDLE_SHA,
      renderSettingsHash: "9cf74bc39cdaf647a937fea313801b777dc501d5e9912109230836ad1fd50050",
      compositionId: "ChapterVideo",
      renderer: { requested: "remotion", actual: "remotion" },
      outputPath: "remotion/output.mp4",
      inputManifestPath: "input-manifest.json",
      renderPlanPath: "timeline-render-plan.json",
      snapshotPath: "editing-project.json",
      sha256: OUTPUT_SHA,
      durationUs: 10_000_000,
      streams: [
        { kind: "video", codec: "h264", width: 1920, height: 1080 },
        { kind: "audio", codec: "aac", channels: 2, sampleRate: 48000 },
      ],
    });
    expect(result.evidence.jobId).toMatch(/^chapter:[a-f0-9]{64}$/);
    expect(result.expected).toMatchObject({
      projectId: "project-a",
      chapterId: "chapter-001",
      revision: 7,
      compositionId: "ChapterVideo",
      inputSha256: RENDER_INPUT_SHA,
      videoUseInputSha256: VIDEO_USE_INPUT_SHA,
      width: 1920,
      height: 1080,
      fps: 30,
      durationS: 9.5,
    });
    expect(result.evidence).not.toHaveProperty("cinematic");
  });

  it("rejects output and sidecar paths outside the isolated run root", async () => {
    await expect(buildFullPipelineRunEvidence({
      projectId: "project-a",
      chapterId: "chapter-001",
      editingProjectId: "editing-a",
      editingRevision: 7,
      mode: "editable-edl",
      renderInputSha256: RENDER_INPUT_SHA,
      videoUseInputSha256: VIDEO_USE_INPUT_SHA,
      bundleContentHash: BUNDLE_SHA,
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      renderSettings: FULL_RENDER_SETTINGS,
      expectedDurationS: 10,
      runRoot: "/tmp/full-pipeline-1",
      outputPath: "/tmp/outside.mp4",
      inputManifestPath: "/tmp/full-pipeline-1/input-manifest.json",
      renderPlanPath: "/tmp/full-pipeline-1/timeline-render-plan.json",
      snapshotPath: "/tmp/full-pipeline-1/editing-project.json",
      outputSizeBytes: 1234,
      outputMtimeMs: 1_700_000_000_000,
      outputSha256: OUTPUT_SHA,
      probe: {
        raw: { format: { duration: "10" }, streams: [] },
        duration: 10,
        width: 1920,
        height: 1080,
        streams: ["video", "audio"],
        videoCodec: "h264",
        audioCodec: "aac",
      },
      startedAt: 1000,
      completedAt: 2000,
    })).rejects.toThrow("full-pipeline-evidence-path-outside-run-root");
  });

  it("writes validated ChapterVideo and final-QC sidecars from the isolated CLI run", () => {
    const source = fs.readFileSync(new URL("./run-full-pipeline.ts", import.meta.url), "utf8");
    const renderIndex = source.indexOf("await renderMedia({");
    const evidenceIndex = source.indexOf("await buildFullPipelineRunEvidence({");

    expect(renderIndex).toBeGreaterThan(-1);
    expect(evidenceIndex).toBeGreaterThan(renderIndex);
    expect(source).toContain('path.join(remotionOutputDir, "chapter-video-evidence.json")');
    expect(source).toContain('path.join(outputDir, "editing-project.json")');
    expect(source).toContain('path.join(outputDir, "final-output-qc-expected.json")');
    expect(source).toContain('path.join(outputDir, "input-manifest.json")');
    expect(source).toContain("writeVideoWorkflowJson(chapterEvidencePath, runEvidence.evidence)");
    expect(source).toContain("writeVideoWorkflowJson(finalQcExpectedPath, runEvidence.expected)");
    expect(source).toContain("renderSettings: plan.renderSettings,");
  });
});
