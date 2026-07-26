import { describe, expect, it } from "vitest";
import {
  validateRemotionBrowserWorkerCommand,
  validateRemotionBrowserWorkerEvent,
} from "./remotion-browser-worker-protocol";

const command = {
  schemaVersion: 1,
  requestId: "request-1",
  action: "status",
  remotionVersion: "4.0.499",
};

describe("validateRemotionBrowserWorkerCommand", () => {
  it("accepts the fixed status/download command shape", () => {
    expect(validateRemotionBrowserWorkerCommand(command).success).toBe(true);
    expect(validateRemotionBrowserWorkerCommand({ ...command, action: "download" }).success).toBe(true);
  });

  it("rejects caller-controlled browser source or executable fields", () => {
    expect(validateRemotionBrowserWorkerCommand({ ...command, source: "mirror" }).success).toBe(false);
    expect(validateRemotionBrowserWorkerCommand({ ...command, executablePath: "/tmp/chrome" }).success).toBe(false);
  });
});

describe("validateRemotionBrowserWorkerEvent", () => {
  it("accepts a ready result only with an absolute executable path", () => {
    const base = {
      kind: "result",
      requestId: "request-1",
      status: { state: "ready", remotionVersion: "4.0.499" },
    };
    expect(validateRemotionBrowserWorkerEvent({ ...base, executablePath: "/runtime/headless-shell" }).success).toBe(true);
    expect(validateRemotionBrowserWorkerEvent(base).success).toBe(false);
    expect(validateRemotionBrowserWorkerEvent({ ...base, executablePath: "relative/chrome" }).success).toBe(false);
  });

  it("rejects malformed progress and unknown event fields", () => {
    expect(validateRemotionBrowserWorkerEvent({
      kind: "progress",
      requestId: "request-1",
      progress: { phase: "downloading", ratio: Number.NaN, remotionVersion: "4.0.499" },
    }).success).toBe(false);
    expect(validateRemotionBrowserWorkerEvent({
      kind: "error",
      requestId: "request-1",
      message: "failed",
      token: "must-not-cross",
    }).success).toBe(false);
  });
});
