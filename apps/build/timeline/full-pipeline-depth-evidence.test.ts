import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { DepthAdapterResult } from "@rendering/plugins/depth/depth-adapter";
import {
  buildFullPipelineCinematicDepthReport,
  buildFullPipelineDepthEvidence,
} from "./full-pipeline-depth-evidence";

const INPUT_SHA = "a".repeat(64);
const OUTPUT_SHA = "b".repeat(64);

function readyResult(outputPath: string): DepthAdapterResult {
  return {
    state: "ready",
    artifact: {
      schemaVersion: 1,
      projectId: "project-a",
      shotId: "shot-1",
      status: "accepted",
      model: "depth-anything-v2-small",
      inputSha256: INPUT_SHA,
      outputSha256: OUTPUT_SHA,
      outputPath,
      width: 1024,
      height: 576,
      depthRange: { min: 0, max: 1 },
      toolVersion: "depth-estimation@0.1.0",
      generatedAt: 1,
    },
  };
}

describe("full-pipeline depth evidence", () => {
  it("fails closed with the adapter code and artifact path", async () => {
    const hashFile = vi.fn(async () => INPUT_SHA);

    await expect(buildFullPipelineDepthEvidence({
      result: {
        state: "blocked",
        code: "runtime-not-ready",
        message: "模型未准备",
        artifactPath: "/tmp/depth-artifact.json",
      },
      projectId: "project-a",
      shotId: "shot-1",
      preset: "cinematic-dolly-in",
      inputImagePath: "/tmp/input.png",
      expectedDepthPath: "/tmp/depth/depth.png",
      evidenceRoot: "/tmp",
      hashFile,
    })).rejects.toThrow("runtime-not-ready] artifact=/tmp/depth-artifact.json");
    expect(hashFile).not.toHaveBeenCalled();
  });

  it("binds identity, actual file hashes, and a relative depth path", async () => {
    const evidenceRoot = path.resolve("/tmp/remotion-output");
    const inputImagePath = path.join(evidenceRoot, "depth-frame-shot-1.png");
    const outputPath = path.join(evidenceRoot, "depth", "shot-1", "depth.png");
    const hashFile = vi.fn(async (filePath: string) => filePath === inputImagePath ? INPUT_SHA : OUTPUT_SHA);

    await expect(buildFullPipelineDepthEvidence({
      result: readyResult(outputPath),
      projectId: "project-a",
      shotId: "shot-1",
      preset: "cinematic-parallax-lr",
      inputImagePath,
      expectedDepthPath: outputPath,
      evidenceRoot,
      hashFile,
      fileExists: () => true,
    })).resolves.toEqual({
      schemaVersion: 1,
      preset: "cinematic-parallax-lr",
      model: "depth-anything-v2-small",
      inputSha256: INPUT_SHA,
      outputSha256: OUTPUT_SHA,
      depthMapPath: "depth/shot-1/depth.png",
      width: 1024,
      height: 576,
    });
    expect(hashFile).toHaveBeenCalledTimes(2);
  });

  it("rejects output bytes that do not match the artifact SHA", async () => {
    const evidenceRoot = path.resolve("/tmp/remotion-output");
    const inputImagePath = path.join(evidenceRoot, "input.png");
    const outputPath = path.join(evidenceRoot, "depth.png");

    await expect(buildFullPipelineDepthEvidence({
      result: readyResult(outputPath),
      projectId: "project-a",
      shotId: "shot-1",
      preset: "cinematic-dolly-in",
      inputImagePath,
      expectedDepthPath: outputPath,
      evidenceRoot,
      hashFile: async (filePath) => filePath === inputImagePath ? INPUT_SHA : "c".repeat(64),
      fileExists: () => true,
    })).rejects.toThrow("cinematic-depth-output-sha-mismatch");
  });

  it("rejects an artifact from another shot", async () => {
    const evidenceRoot = path.resolve("/tmp/remotion-output");
    const inputImagePath = path.join(evidenceRoot, "input.png");
    const outputPath = path.join(evidenceRoot, "depth.png");
    const result = readyResult(outputPath);
    if (result.state !== "ready") throw new Error("expected ready fixture");
    result.artifact.shotId = "shot-2";

    await expect(buildFullPipelineDepthEvidence({
      result,
      projectId: "project-a",
      shotId: "shot-1",
      preset: "cinematic-dolly-in",
      inputImagePath,
      expectedDepthPath: outputPath,
      evidenceRoot,
      hashFile: async (filePath) => filePath === inputImagePath ? INPUT_SHA : OUTPUT_SHA,
      fileExists: () => true,
    })).rejects.toThrow("cinematic-depth-artifact-identity-mismatch");
  });

  it("rejects input bytes that do not match the artifact SHA", async () => {
    const evidenceRoot = path.resolve("/tmp/remotion-output");
    const inputImagePath = path.join(evidenceRoot, "input.png");
    const outputPath = path.join(evidenceRoot, "depth.png");

    await expect(buildFullPipelineDepthEvidence({
      result: readyResult(outputPath),
      projectId: "project-a",
      shotId: "shot-1",
      preset: "cinematic-dolly-in",
      inputImagePath,
      expectedDepthPath: outputPath,
      evidenceRoot,
      hashFile: async (filePath) => filePath === inputImagePath ? "c".repeat(64) : OUTPUT_SHA,
      fileExists: () => true,
    })).rejects.toThrow("cinematic-depth-input-sha-mismatch");
  });

  it("rejects a depth artifact outside the evidence root", async () => {
    const evidenceRoot = path.resolve("/tmp/remotion-output");
    const inputImagePath = path.join(evidenceRoot, "input.png");
    const outputPath = path.resolve("/tmp/outside-depth/depth.png");

    await expect(buildFullPipelineDepthEvidence({
      result: readyResult(outputPath),
      projectId: "project-a",
      shotId: "shot-1",
      preset: "cinematic-dolly-in",
      inputImagePath,
      expectedDepthPath: outputPath,
      evidenceRoot,
      hashFile: async (filePath) => filePath === inputImagePath ? INPUT_SHA : OUTPUT_SHA,
      fileExists: () => true,
    })).rejects.toThrow("cinematic-depth-evidence-path-invalid");
  });

  it("serializes chapter evidence without capability URLs or raw paths", () => {
    const report = buildFullPipelineCinematicDepthReport({
      enabled: true,
      evidence: [{
        shotId: "shot-1",
        clipId: "clip-1",
        evidence: {
          schemaVersion: 1,
          preset: "cinematic-dolly-in",
          model: "depth-anything-v2-small",
          inputSha256: INPUT_SHA,
          outputSha256: OUTPUT_SHA,
          depthMapPath: "depth/shot-1/depth.png",
          width: 1024,
          height: 576,
        },
      }],
    });

    expect(report).toEqual({
      enabled: true,
      evidence: [{
        shotId: "shot-1",
        clipId: "clip-1",
        evidence: {
          schemaVersion: 1,
          preset: "cinematic-dolly-in",
          model: "depth-anything-v2-small",
          inputSha256: INPUT_SHA,
          outputSha256: OUTPUT_SHA,
          depthMapPath: "depth/shot-1/depth.png",
          width: 1024,
          height: 576,
        },
      }],
    });
    expect(JSON.stringify(report)).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(report)).not.toContain("/tmp/");
  });

  it("keeps the CLI depth wiring fail-closed and records per-shot evidence", () => {
    const source = fs.readFileSync(new URL("./run-full-pipeline.ts", import.meta.url), "utf8");
    const evidenceIndex = source.indexOf("await buildFullPipelineDepthEvidence({");
    const mediaMapIndex = source.indexOf("const mediaUrlByClipId = buildMediaUrlMap");

    expect(evidenceIndex).toBeGreaterThan(-1);
    expect(mediaMapIndex).toBeGreaterThan(evidenceIndex);
    expect(source).toContain("session.register(depthAssetId, depthPath)");
    expect(source).toContain("cinematicDepth: buildFullPipelineCinematicDepthReport({");
    expect(source).not.toContain("depth estimation blocked");
  });
});
