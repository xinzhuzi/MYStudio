import fs from "node:fs";
import path from "node:path";

import type { CinematicCameraPreset } from "@rendering/plugins/remotion/composition/composition-props";
import type { DepthAdapterResult } from "@rendering/plugins/depth/depth-adapter";
import type { DepthEstimationRequestV1 } from "@rendering/contracts/depth-workflow";
import type { RemotionCinematicEvidenceV1 } from "@/types/remotion-workspace";

export interface ResolveFullPipelineDepthModelDirInput {
  storageBasePath: string;
  explicitModelDir?: string;
  fileExists?: (filePath: string) => boolean;
}

export function resolveFullPipelineDepthModelDir(
  input: ResolveFullPipelineDepthModelDirInput,
): string {
  const fileExists = input.fileExists ?? fs.existsSync;
  const explicitModelDir = input.explicitModelDir?.trim();
  if (explicitModelDir) {
    const resolvedExplicit = path.resolve(explicitModelDir);
    if (!path.isAbsolute(explicitModelDir) || !fileExists(resolvedExplicit)) {
      throw new Error(`depth-model-dir-unavailable: ${resolvedExplicit}`);
    }
    return resolvedExplicit;
  }
  const currentModelDir = path.resolve(input.storageBasePath, "model", "depth");
  if (fileExists(currentModelDir)) return currentModelDir;
  const legacyModelDir = path.resolve(input.storageBasePath, "DeepModel");
  if (fileExists(legacyModelDir)) return legacyModelDir;
  throw new Error(`depth-model-dir-unavailable: ${currentModelDir}; legacy=${legacyModelDir}`);
}

export interface BuildFullPipelineDepthEvidenceInput {
  result: DepthAdapterResult;
  projectId: string;
  shotId: string;
  preset: CinematicCameraPreset;
  inputImagePath: string;
  expectedDepthPath: string;
  evidenceRoot: string;
  hashFile: (filePath: string) => Promise<string>;
  fileExists?: (filePath: string) => boolean;
}

export interface FullPipelineCinematicDepthEvidenceRecord {
  shotId: string;
  clipId: string;
  evidence: RemotionCinematicEvidenceV1;
}

export interface FullPipelineCinematicDepthReport {
  enabled: boolean;
  evidence: FullPipelineCinematicDepthEvidenceRecord[];
}

export interface FullPipelineDepthPreflightReport {
  schemaVersion: 1;
  status: "accepted";
  stage: "before-project-revision-writes";
  projectId: string;
  shotId: string;
  preset: CinematicCameraPreset;
  model: "depth-anything-v2-small";
  inputImagePath: string;
  outputDepthPath: string;
  artifactPath: string;
  inputSha256: string;
  outputSha256: string;
}

export interface RunFullPipelineDepthPreflightInput {
  projectId: string;
  shotId: string;
  shotVideoPath: string;
  preset: CinematicCameraPreset;
  preflightRoot: string;
  extractFrame: (inputVideoPath: string, outputImagePath: string) => Promise<void>;
  estimateDepth: (request: DepthEstimationRequestV1) => Promise<DepthAdapterResult>;
  hashFile: (filePath: string) => Promise<string>;
}

function relativeEvidencePath(root: string, target: string, label: string): string {
  const relativePath = path.relative(path.resolve(root), path.resolve(target));
  if (!relativePath
    || relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)) {
    throw new Error(`depth-preflight-${label}-path-invalid: ${target}`);
  }
  return relativePath.split(path.sep).join("/");
}

export async function runFullPipelineDepthPreflight(
  input: RunFullPipelineDepthPreflightInput,
): Promise<{
  report: FullPipelineDepthPreflightReport;
  reportPath: string;
  inputImagePath: string;
  outputDepthPath: string;
}> {
  const preflightRoot = path.resolve(input.preflightRoot);
  const inputImagePath = path.join(preflightRoot, "input-frame.png");
  const outputDepthPath = path.join(preflightRoot, "depth.png");
  const reportPath = path.join(preflightRoot, "depth-preflight.json");
  if (fs.existsSync(reportPath)) throw new Error(`depth-preflight-report-exists: ${reportPath}`);
  fs.mkdirSync(preflightRoot, { recursive: true });
  await input.extractFrame(input.shotVideoPath, inputImagePath);
  const result = await input.estimateDepth({
    schemaVersion: 1,
    projectId: input.projectId,
    shotId: input.shotId,
    inputImagePath,
    outputDepthPath,
    model: "depth-anything-v2-small",
  });
  const evidence = await buildFullPipelineDepthEvidence({
    result,
    projectId: input.projectId,
    shotId: input.shotId,
    preset: input.preset,
    inputImagePath,
    expectedDepthPath: outputDepthPath,
    evidenceRoot: preflightRoot,
    hashFile: input.hashFile,
  });
  if (!result.artifactPath || !fs.existsSync(result.artifactPath)) {
    throw new Error(`depth-preflight-artifact-missing: ${result.artifactPath ?? "(none)"}`);
  }
  const report: FullPipelineDepthPreflightReport = {
    schemaVersion: 1,
    status: "accepted",
    stage: "before-project-revision-writes",
    projectId: input.projectId,
    shotId: input.shotId,
    preset: input.preset,
    model: "depth-anything-v2-small",
    inputImagePath: relativeEvidencePath(preflightRoot, inputImagePath, "input"),
    outputDepthPath: evidence.depthMapPath,
    artifactPath: relativeEvidencePath(preflightRoot, result.artifactPath, "artifact"),
    inputSha256: evidence.inputSha256,
    outputSha256: evidence.outputSha256,
  };
  const tempPath = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, reportPath);
  return { report, reportPath, inputImagePath, outputDepthPath };
}

export async function buildFullPipelineDepthEvidence(
  input: BuildFullPipelineDepthEvidenceInput,
): Promise<RemotionCinematicEvidenceV1> {
  if (input.result.state !== "ready") {
    throw new Error(
      `cinematic-depth-blocked [${input.result.code}] artifact=${input.result.artifactPath ?? "(none)"}: ${input.result.message}`,
    );
  }
  const artifact = input.result.artifact;
  if (artifact.status !== "accepted"
    || artifact.projectId !== input.projectId
    || artifact.shotId !== input.shotId
    || artifact.model !== "depth-anything-v2-small") {
    throw new Error("cinematic-depth-artifact-identity-mismatch");
  }
  const outputPath = path.resolve(artifact.outputPath);
  if (outputPath !== path.resolve(input.expectedDepthPath)
    || !(input.fileExists ?? fs.existsSync)(outputPath)) {
    throw new Error(`cinematic-depth-output-path-invalid: ${artifact.outputPath}`);
  }
  const actualInputSha256 = await input.hashFile(input.inputImagePath);
  if (artifact.inputSha256 !== actualInputSha256) {
    throw new Error("cinematic-depth-input-sha-mismatch");
  }
  const actualOutputSha256 = await input.hashFile(outputPath);
  if (artifact.outputSha256 !== actualOutputSha256) {
    throw new Error("cinematic-depth-output-sha-mismatch");
  }
  const relativeDepthPath = path.relative(path.resolve(input.evidenceRoot), outputPath);
  if (!relativeDepthPath
    || relativeDepthPath === ".."
    || relativeDepthPath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeDepthPath)) {
    throw new Error(`cinematic-depth-evidence-path-invalid: ${artifact.outputPath}`);
  }
  return {
    schemaVersion: 1,
    preset: input.preset,
    model: artifact.model,
    inputSha256: artifact.inputSha256,
    outputSha256: artifact.outputSha256,
    depthMapPath: relativeDepthPath.split(path.sep).join("/"),
    width: artifact.width,
    height: artifact.height,
  };
}

export function buildFullPipelineCinematicDepthReport(input: {
  enabled: boolean;
  evidence: readonly FullPipelineCinematicDepthEvidenceRecord[];
}): FullPipelineCinematicDepthReport {
  return {
    enabled: input.enabled,
    evidence: input.evidence.map(({ shotId, clipId, evidence }) => ({
      shotId,
      clipId,
      evidence: {
        schemaVersion: evidence.schemaVersion,
        preset: evidence.preset,
        model: evidence.model,
        inputSha256: evidence.inputSha256,
        outputSha256: evidence.outputSha256,
        depthMapPath: evidence.depthMapPath,
        width: evidence.width,
        height: evidence.height,
      },
    })),
  };
}
