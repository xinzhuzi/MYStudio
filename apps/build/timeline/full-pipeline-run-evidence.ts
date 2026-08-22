import path from "node:path";

import type { RemotionEvidenceV1 } from "@/types/remotion-workspace";
import type { TimelineRenderSettings } from "@/types/editing";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import { validateRemotionEvidenceIdentity } from "@/lib/studio/remotion/remotion-render-validation";
import type { RenderedMediaProbe } from "../remotion/render-smoke-evidence";

export interface BuildFullPipelineRunEvidenceInput {
  projectId: string;
  chapterId: string;
  editingProjectId: string;
  editingRevision: number;
  mode: string;
  renderInputSha256: string;
  videoUseInputSha256: string;
  bundleContentHash: string;
  templateVersion: string;
  remotionVersion: string;
  renderSettings: TimelineRenderSettings;
  expectedDurationS: number;
  runRoot: string;
  outputPath: string;
  inputManifestPath: string;
  renderPlanPath: string;
  snapshotPath: string;
  outputSizeBytes: number;
  outputMtimeMs: number;
  outputSha256: string;
  probe: RenderedMediaProbe;
  startedAt: number;
  completedAt: number;
}

export interface FullPipelineFinalOutputQcExpected {
  projectId: string;
  chapterId: string;
  revision: number;
  mode: string;
  compositionId: "ChapterVideo";
  inputSha256: string;
  videoUseInputSha256: string;
  width: number;
  height: number;
  fps: number;
  durationS: number;
}

function relativeRunPath(runRoot: string, targetPath: string): string {
  if (!path.isAbsolute(runRoot) || !path.isAbsolute(targetPath)) {
    throw new Error(`full-pipeline-evidence-path-outside-run-root: ${targetPath}`);
  }
  const relativePath = path.relative(path.resolve(runRoot), path.resolve(targetPath));
  if (!relativePath
    || relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)) {
    throw new Error(`full-pipeline-evidence-path-outside-run-root: ${targetPath}`);
  }
  return relativePath.split(path.sep).join("/");
}

function buildEvidenceStreams(
  input: BuildFullPipelineRunEvidenceInput,
): RemotionEvidenceV1["streams"] {
  const rawStreams = input.probe.raw.streams ?? [];
  const videoStreams = rawStreams.filter((stream) => stream.codec_type === "video");
  const audioStreams = rawStreams.filter((stream) => stream.codec_type === "audio");
  if (rawStreams.length !== 2 || videoStreams.length !== 1 || audioStreams.length !== 1) {
    throw new Error("full-pipeline-evidence-streams-invalid");
  }
  const video = videoStreams[0]!;
  const audio = audioStreams[0]!;
  const sampleRate = Number(audio.sample_rate);
  if (video.codec_name !== "h264"
    || audio.codec_name !== "aac"
    || video.width !== input.renderSettings.width
    || video.height !== input.renderSettings.height
    || !Number.isSafeInteger(audio.channels)
    || Number(audio.channels) < 1
    || !Number.isSafeInteger(sampleRate)
    || sampleRate < 1) {
    throw new Error("full-pipeline-evidence-media-contract-invalid");
  }
  return [
    {
      kind: "video",
      codec: "h264",
      width: video.width,
      height: video.height,
    },
    {
      kind: "audio",
      codec: "aac",
      channels: Number(audio.channels),
      sampleRate,
    },
  ];
}

export async function buildFullPipelineRunEvidence(
  input: BuildFullPipelineRunEvidenceInput,
): Promise<{
  evidence: RemotionEvidenceV1;
  expected: FullPipelineFinalOutputQcExpected;
}> {
  const outputPath = relativeRunPath(input.runRoot, input.outputPath);
  const inputManifestPath = relativeRunPath(input.runRoot, input.inputManifestPath);
  const renderPlanPath = relativeRunPath(input.runRoot, input.renderPlanPath);
  const snapshotPath = relativeRunPath(input.runRoot, input.snapshotPath);
  const renderSettingsHash = await sha256CanonicalJson(input.renderSettings);
  const target = {
    kind: "chapter" as const,
    chapterId: input.chapterId,
    editingProjectId: input.editingProjectId,
    editingRevision: input.editingRevision,
  };
  const identity = {
    projectId: input.projectId,
    target,
    inputHash: input.renderInputSha256,
    bundleContentHash: input.bundleContentHash,
    renderSettingsHash,
  };
  const evidence: RemotionEvidenceV1 = {
    schemaVersion: 1,
    ...identity,
    jobId: await createRemotionRenderJobId(identity),
    templateVersion: input.templateVersion,
    remotionVersion: input.remotionVersion,
    attempt: 1,
    compositionId: "ChapterVideo",
    renderer: { requested: "remotion", actual: "remotion" },
    outputPath,
    sizeBytes: input.outputSizeBytes,
    mtimeMs: Math.floor(input.outputMtimeMs),
    sha256: input.outputSha256,
    width: input.probe.width,
    height: input.probe.height,
    durationUs: Math.round(input.probe.duration * 1_000_000),
    streams: buildEvidenceStreams(input),
    inputManifestPath,
    renderPlanPath,
    snapshotPath,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
  const validation = await validateRemotionEvidenceIdentity(evidence);
  if (!validation.success) {
    throw new Error(`full-pipeline-evidence-invalid: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
  return {
    evidence: validation.value,
    expected: {
      projectId: input.projectId,
      chapterId: input.chapterId,
      revision: input.editingRevision,
      mode: input.mode,
      compositionId: "ChapterVideo",
      inputSha256: input.renderInputSha256,
      videoUseInputSha256: input.videoUseInputSha256,
      width: input.renderSettings.width,
      height: input.renderSettings.height,
      fps: input.renderSettings.fps,
      durationS: input.expectedDurationS,
    },
  };
}
