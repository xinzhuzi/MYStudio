import fs from "node:fs";
import path from "node:path";

import type { CinematicCameraPreset } from "@rendering/plugins/remotion/composition/composition-props";
import type { DepthAdapterResult } from "@rendering/plugins/depth/depth-adapter";
import type { RemotionCinematicEvidenceV1 } from "@/types/remotion-workspace";

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
