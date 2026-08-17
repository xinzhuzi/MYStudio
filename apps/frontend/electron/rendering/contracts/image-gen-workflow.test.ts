import { describe, expect, it } from "vitest";

import {
  IMAGE_GEN_CHANNELS,
  IMAGE_GEN_PREPARE_CHANNEL,
  IMAGE_GEN_PROBE_CHANNEL,
  IMAGE_GEN_ROLLBACK_CHANNEL,
  validateImageGenArtifact,
  validateImageGenRuntimeActionReply,
  validateImageGenRuntimeLifecycleRequest,
  validateImageGenRuntimeStatus,
} from "./image-gen-workflow";

const status = {
  schemaVersion: 1,
  state: "ready",
  activeModel: "sdxl-turbo",
  modelCacheDir: "/tmp/mystudio-image-model",
  modelDownloaded: true,
  pythonAvailable: true,
} as const;

describe("local image generation contract", () => {
  it("publishes the canonical lifecycle channels", () => {
    expect(IMAGE_GEN_CHANNELS).toEqual([
      IMAGE_GEN_PROBE_CHANNEL,
      IMAGE_GEN_PREPARE_CHANNEL,
      IMAGE_GEN_ROLLBACK_CHANNEL,
    ]);
  });

  it("rejects unknown fields, relative cache paths, and null requests", () => {
    expect(validateImageGenRuntimeStatus(status)).toMatchObject({ success: true });
    expect(validateImageGenRuntimeStatus({ ...status, extra: true })).toMatchObject({ success: false });
    expect(validateImageGenRuntimeStatus({ ...status, modelCacheDir: "models/image" })).toMatchObject({ success: false });
    expect(validateImageGenRuntimeLifecycleRequest(null)).toMatchObject({ success: false });
  });

  it("validates nested action status and fixed 1920x1080 artifact evidence", () => {
    expect(validateImageGenRuntimeActionReply({ schemaVersion: 1, success: true, status })).toMatchObject({ success: true });
    expect(validateImageGenRuntimeActionReply({ schemaVersion: 1, success: true, status: { ...status, extra: true } })).toMatchObject({ success: false });
    expect(validateImageGenArtifact({
      schemaVersion: 1,
      projectId: "project-1",
      status: "accepted",
      model: "sdxl-turbo",
      outputPath: "/tmp/image.png",
      outputSha256: "a".repeat(64),
      width: 1920,
      height: 1080,
      mediaRef: { kind: "image", path: "/tmp/image.png", contentSha256: "a".repeat(64) },
    })).toMatchObject({ success: true });
    expect(validateImageGenArtifact({
      schemaVersion: 1,
      projectId: "project-1",
      status: "accepted",
      model: "sdxl-turbo",
      outputPath: "/tmp/image.png",
      outputSha256: "a".repeat(64),
      width: 1024,
      height: 1024,
    })).toMatchObject({ success: false });
  });
});
