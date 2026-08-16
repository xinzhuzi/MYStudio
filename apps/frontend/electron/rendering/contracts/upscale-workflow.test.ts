// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  UPSCALE_SCHEMA_VERSION,
  blockedUpscaleArtifact,
  validateUpscaleArtifact,
  validateUpscaleRunRequest,
  validateUpscaleRuntimeActionReply,
  validateUpscaleRuntimeLifecycleRequest,
  validateUpscaleRuntimeStatus,
  type UpscaleRunRequestV1,
} from "@rendering/contracts/upscale-workflow";

const HEX64 = "a".repeat(64);

const validRequest: UpscaleRunRequestV1 = {
  schemaVersion: UPSCALE_SCHEMA_VERSION,
  projectId: "p1",
  model: "realesrgan-x4plus-anime-6b",
  inputImagePath: "workflow-images/chapter-001/wf1/gen-node.png",
  outputImagePath: "workflow-images/chapter-001/wf1/up4x-node.png",
};

describe("upscale workflow contracts", () => {
  it("accepts a valid run request with optional shotId", () => {
    const result = validateUpscaleRunRequest(validRequest);
    expect(result.success).toBe(true);
    const withShot = validateUpscaleRunRequest({ ...validRequest, shotId: "shot-1" });
    expect(withShot.success).toBe(true);
  });

  it("accepts local-image:// media references", () => {
    const localImage = {
      ...validRequest,
      inputImagePath: "local-image://workflow/gen-image.png",
      outputImagePath: "local-image://workflow/up4x-gen-image.png",
    };
    expect(validateUpscaleRunRequest(localImage).success).toBe(true);
    expect(validateUpscaleRunRequest({ ...validRequest, inputImagePath: "local-image://" }).success).toBe(false);
    expect(validateUpscaleRunRequest({ ...validRequest, inputImagePath: "local-image://../x.png" }).success).toBe(false);
  });

  it("rejects absolute paths, traversal, backslashes and unknown models", () => {
    expect(validateUpscaleRunRequest({ ...validRequest, inputImagePath: "/abs/path.png" }).success).toBe(false);
    expect(validateUpscaleRunRequest({ ...validRequest, outputImagePath: "../escape.png" }).success).toBe(false);
    expect(validateUpscaleRunRequest({ ...validRequest, inputImagePath: "a\\b.png" }).success).toBe(false);
    expect(validateUpscaleRunRequest({ ...validRequest, model: "waifu2x" }).success).toBe(false);
    expect(validateUpscaleRunRequest({ ...validRequest, projectId: "p/1" }).success).toBe(false);
    expect(validateUpscaleRunRequest({ ...validRequest, shotId: "bad shot" }).success).toBe(false);
    expect(validateUpscaleRunRequest({ ...validRequest, extra: true }).success).toBe(false);
  });

  it("validates artifacts including hex digests and positive dimensions", () => {
    const validArtifact = {
      schemaVersion: 1,
      projectId: "p1",
      shotId: "unknown",
      status: "accepted",
      model: "realesrgan-x4plus",
      method: "super_res",
      scale: 4,
      inputSha256: HEX64,
      outputSha256: "b".repeat(64),
      outputPath: "/abs/out.png",
      width: 4096,
      height: 6144,
      toolVersion: "upscale@0.1.0",
      generatedAt: Date.now(),
    };
    expect(validateUpscaleArtifact(validArtifact).success).toBe(true);
    expect(validateUpscaleArtifact({ ...validArtifact, width: 0 }).success).toBe(false);
    expect(validateUpscaleArtifact({ ...validArtifact, outputSha256: "xyz" }).success).toBe(false);
    expect(validateUpscaleArtifact({ ...validArtifact, scale: -1 }).success).toBe(false);
    expect(validateUpscaleArtifact({ ...validArtifact, elapsedSeconds: 1.5 }).success).toBe(true);
    expect(validateUpscaleArtifact({ ...validArtifact, outputBytes: 12345 }).success).toBe(true);
    expect(validateUpscaleArtifact({ ...validArtifact, outputBytes: -1 }).success).toBe(false);
    expect(validateUpscaleArtifact({ ...validArtifact, outputBytes: "12kb" }).success).toBe(false);
  });

  it("validates lifecycle request/status/action reply shapes", () => {
    expect(validateUpscaleRuntimeLifecycleRequest({ schemaVersion: 1 }).success).toBe(true);
    expect(validateUpscaleRuntimeLifecycleRequest({ schemaVersion: 2 }).success).toBe(false);
    expect(validateUpscaleRuntimeLifecycleRequest({ schemaVersion: 1, extra: 1 }).success).toBe(false);

    const validStatus = {
      schemaVersion: 1,
      state: "ready",
      activeModel: "realesrgan-x4plus-anime-6b",
      modelCacheDir: "/tmp/UpscaleModel",
      modelDownloaded: true,
    };
    expect(validateUpscaleRuntimeStatus(validStatus).success).toBe(true);
    expect(validateUpscaleRuntimeStatus({ ...validStatus, state: "weird" }).success).toBe(false);
    expect(validateUpscaleRuntimeStatus({ ...validStatus, modelCacheDir: "relative/path" }).success).toBe(false);

    const validReply = {
      schemaVersion: 1,
      success: true,
      status: validStatus,
    };
    expect(validateUpscaleRuntimeActionReply(validReply).success).toBe(true);
    expect(validateUpscaleRuntimeActionReply({ ...validReply, success: "yes" }).success).toBe(false);
  });

  it("builds a zero-field blocked artifact for error responses", () => {
    const blocked = blockedUpscaleArtifact(validRequest, "model-not-downloaded", "未下载", "upscale@0.1.0");
    expect(blocked).toMatchObject({
      status: "blocked",
      model: "realesrgan-x4plus-anime-6b",
      inputSha256: "0".repeat(64),
      outputSha256: "0".repeat(64),
      code: "model-not-downloaded",
      message: "未下载",
    });
  });
});
