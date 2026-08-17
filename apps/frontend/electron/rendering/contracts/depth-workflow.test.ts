import { describe, expect, it } from "vitest";

import {
  DEPTH_CHANNELS,
  DEPTH_PREPARE_CHANNEL,
  DEPTH_PROBE_CHANNEL,
  DEPTH_ROLLBACK_CHANNEL,
  validateDepthRuntimeActionReply,
  validateDepthRuntimeLifecycleRequest,
  validateDepthRuntimeStatus,
} from "./depth-workflow";

const validStatus = {
  schemaVersion: 1,
  state: "ready",
  model: "depth-anything-v2-small",
  modelCacheDir: "/tmp/mystudio-depth-model",
  modelDownloaded: true,
  probe: {
    pythonAvailable: true,
    pythonVersion: "Python 3.12.7",
    workerProbe: "ready",
    workerToolVersion: "depth-estimation@0.1.0",
    modelWeightSha256: "a".repeat(64),
  },
  message: "深度运行时已就绪",
} as const;

describe("depth runtime lifecycle contracts", () => {
  it("publishes the canonical probe, prepare, and rollback channels", () => {
    expect(DEPTH_CHANNELS).toEqual([
      DEPTH_PROBE_CHANNEL,
      DEPTH_PREPARE_CHANNEL,
      DEPTH_ROLLBACK_CHANNEL,
    ]);
  });

  it("accepts a valid status and rejects schema, unknown fields, and relative cache paths", () => {
    expect(validateDepthRuntimeStatus(validStatus)).toMatchObject({ success: true });
    expect(validateDepthRuntimeStatus({ ...validStatus, schemaVersion: 2 })).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: "schemaVersion" })]),
    });
    expect(validateDepthRuntimeStatus({ ...validStatus, extra: true })).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: "extra" })]),
    });
    expect(validateDepthRuntimeStatus({ ...validStatus, modelCacheDir: "models/depth" })).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: "modelCacheDir" })]),
    });
    expect(validateDepthRuntimeStatus({
      ...validStatus,
      probe: { ...validStatus.probe, modelWeightSha256: "bad", extra: true },
    })).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "probe.modelWeightSha256" }),
        expect.objectContaining({ path: "probe.extra" }),
      ]),
    });
  });

  it("rejects malformed nested status and issues in an action reply", () => {
    const validReply = {
      schemaVersion: 1,
      success: true,
      status: validStatus,
    };
    expect(validateDepthRuntimeActionReply({ ...validReply, schemaVersion: 2 })).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: "schemaVersion" })]),
    });
    expect(validateDepthRuntimeActionReply({ ...validReply, extra: true })).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: "extra" })]),
    });

    const result = validateDepthRuntimeActionReply({
      schemaVersion: 1,
      success: false,
      status: { ...validStatus, modelCacheDir: "relative/cache" },
      issues: [{ path: "state", message: "状态无效", extra: "not allowed" }],
    });

    expect(result).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "status.modelCacheDir" }),
        expect.objectContaining({ path: "issues" }),
      ]),
    });
  });

  it("accepts the fixed default lifecycle request and rejects null, invalid, and unknown-field requests", () => {
    expect(validateDepthRuntimeLifecycleRequest({ schemaVersion: 1 })).toMatchObject({ success: true });
    expect(validateDepthRuntimeLifecycleRequest(null)).toMatchObject({
      success: false,
      issues: [expect.objectContaining({ path: "root" })],
    });
    expect(validateDepthRuntimeLifecycleRequest([])).toMatchObject({
      success: false,
      issues: [expect.objectContaining({ path: "root" })],
    });
    expect(validateDepthRuntimeLifecycleRequest({ schemaVersion: 1, extra: true })).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: "extra" })]),
    });
  });
});
