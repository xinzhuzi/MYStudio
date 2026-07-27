import { describe, expect, it } from "vitest";
import {
  isRemotionBrowserState,
  validateRemotionBrowserDownloadProgress,
  validateRemotionBrowserStatus,
} from "./remotion-browser-status";

describe("isRemotionBrowserState", () => {
  it("accepts known states and rejects everything else", () => {
    expect(isRemotionBrowserState("ready")).toBe(true);
    expect(isRemotionBrowserState("update-required")).toBe(true);
    expect(isRemotionBrowserState("installed")).toBe(false);
    expect(isRemotionBrowserState(42)).toBe(false);
    expect(isRemotionBrowserState(undefined)).toBe(false);
  });
});

describe("validateRemotionBrowserStatus", () => {
  it("accepts a well-formed status", () => {
    const result = validateRemotionBrowserStatus({
      state: "ready",
      remotionVersion: "4.0.499",
      preparedForRemotionVersion: "4.0.499",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-object payload", () => {
    const result = validateRemotionBrowserStatus("nope");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.path).toBe("$");
    }
  });

  it("reports bad state and empty version together", () => {
    const result = validateRemotionBrowserStatus({
      state: "installed",
      remotionVersion: "  ",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.issues.map((issue) => issue.path);
      expect(paths).toContain("state");
      expect(paths).toContain("remotionVersion");
    }
  });

  it("rejects a non-string prepared version", () => {
    const result = validateRemotionBrowserStatus({
      state: "ready",
      remotionVersion: "4.0.499",
      preparedForRemotionVersion: 4,
    });
    expect(result.success).toBe(false);
  });
});

describe("validateRemotionBrowserDownloadProgress", () => {
  it("accepts a well-formed progress event", () => {
    const result = validateRemotionBrowserDownloadProgress({
      phase: "downloading",
      ratio: 0.5,
      remotionVersion: "4.0.499",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-range ratio", () => {
    const result = validateRemotionBrowserDownloadProgress({
      phase: "downloading",
      ratio: 1.5,
      remotionVersion: "4.0.499",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((i) => i.path)).toContain("ratio");
    }
  });

  it("rejects an unknown phase", () => {
    const result = validateRemotionBrowserDownloadProgress({
      phase: "installing",
      ratio: 0.5,
      remotionVersion: "4.0.499",
    });
    expect(result.success).toBe(false);
  });
});
