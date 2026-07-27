import { describe, expect, it } from "vitest";
import {
  REMOTION_RUNTIME_DOWNLOAD_CHANNEL,
  REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT,
  REMOTION_RUNTIME_STATUS_CHANNEL,
  isRemotionRuntimeChannel,
  validateRemotionRuntimeDownloadProgressEvent,
  validateRemotionRuntimeDownloadRequest,
  validateRemotionRuntimeStatusRequest,
  validateRemotionRuntimeStatusReply,
} from "./remotion-runtime-ipc";

describe("remotion runtime IPC channels", () => {
  it("fixes the design-mandated channel names", () => {
    expect(REMOTION_RUNTIME_STATUS_CHANNEL).toBe("remotion-runtime-status");
    expect(REMOTION_RUNTIME_DOWNLOAD_CHANNEL).toBe("remotion-runtime-download");
    expect(REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT).toBe(
      "remotion-runtime-download-progress",
    );
  });

  it("recognizes only known invoke channels", () => {
    expect(isRemotionRuntimeChannel("remotion-runtime-status")).toBe(true);
    expect(isRemotionRuntimeChannel("remotion-runtime-download")).toBe(true);
    expect(isRemotionRuntimeChannel("delete-image")).toBe(false);
  });
});

describe("validateRemotionRuntimeDownloadRequest", () => {
  it("accepts undefined, null and empty object", () => {
    expect(validateRemotionRuntimeDownloadRequest(undefined).success).toBe(true);
    expect(validateRemotionRuntimeDownloadRequest(null).success).toBe(true);
    expect(validateRemotionRuntimeDownloadRequest({}).success).toBe(true);
  });

  it("rejects any caller-controlled fields", () => {
    const result = validateRemotionRuntimeDownloadRequest({ version: "5.0.0" });
    expect(result.success).toBe(false);
  });

  it("rejects arrays", () => {
    expect(validateRemotionRuntimeDownloadRequest([]).success).toBe(false);
  });
});

describe("validateRemotionRuntimeStatusRequest", () => {
  it("accepts no payload and rejects caller-controlled fields", () => {
    expect(validateRemotionRuntimeStatusRequest(undefined).success).toBe(true);
    expect(validateRemotionRuntimeStatusRequest({}).success).toBe(true);
    expect(validateRemotionRuntimeStatusRequest({ browserExecutable: "/tmp/chrome" }).success).toBe(false);
  });
});

describe("validateRemotionRuntimeStatusReply", () => {
  it("accepts a valid status and rejects a bad state", () => {
    expect(
      validateRemotionRuntimeStatusReply({
        state: "ready",
        remotionVersion: "4.0.499",
      }).success,
    ).toBe(true);
    expect(
      validateRemotionRuntimeStatusReply({
        state: "installing",
        remotionVersion: "4.0.499",
      }).success,
    ).toBe(false);
  });
});

describe("validateRemotionRuntimeDownloadProgressEvent", () => {
  it("accepts a valid progress event and rejects an out-of-range ratio", () => {
    expect(
      validateRemotionRuntimeDownloadProgressEvent({
        phase: "downloading",
        ratio: 0.4,
        remotionVersion: "4.0.499",
      }).success,
    ).toBe(true);
    expect(
      validateRemotionRuntimeDownloadProgressEvent({
        phase: "downloading",
        ratio: 1.5,
        remotionVersion: "4.0.499",
      }).success,
    ).toBe(false);
  });
});
