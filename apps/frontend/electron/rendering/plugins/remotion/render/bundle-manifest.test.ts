// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  BUNDLE_MANIFEST_FILE_NAME,
  REMOTION_BUNDLE_DIR_NAME,
  assertBundleMatchesRuntime,
  resolveRemotionBundleDir,
  resolveRemotionBundleManifestPath,
  validateBundleManifest,
} from "./bundle-manifest";

const VALID_HASH = "a".repeat(64);

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    templateId: "mystudio-remotion-v1",
    templateVersion: "1.0.0",
    remotionVersion: "4.0.499",
    compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
    compositionId: "DaojieTimeline",
    contentHash: VALID_HASH,
    ...overrides,
  };
}

describe("resolveRemotionBundleDir", () => {
  it("pins the bundle under the app cache dir", () => {
    expect(resolveRemotionBundleDir("/workspace/apps")).toBe(
      `/workspace/apps/.cache/${REMOTION_BUNDLE_DIR_NAME}`,
    );
  });

  it("requires an absolute app root", () => {
    expect(() => resolveRemotionBundleDir("apps")).toThrow("绝对路径");
  });

  it("resolves the manifest path inside the bundle dir", () => {
    expect(resolveRemotionBundleManifestPath("/workspace/apps")).toBe(
      `/workspace/apps/.cache/${REMOTION_BUNDLE_DIR_NAME}/${BUNDLE_MANIFEST_FILE_NAME}`,
    );
  });
});

describe("validateBundleManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateBundleManifest(validManifest());
    expect(result.success).toBe(true);
  });

  it("rejects a non-object", () => {
    const result = validateBundleManifest("nope");
    expect(result.success).toBe(false);
  });

  it("rejects a wrong schema version", () => {
    const result = validateBundleManifest(validManifest({ schemaVersion: 1 }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-exact remotion version", () => {
    const result = validateBundleManifest(validManifest({ remotionVersion: "^4.0.499" }));
    expect(result.success).toBe(false);
  });

  it("rejects an empty compositionId", () => {
    const result = validateBundleManifest(validManifest({ compositionId: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects template drift and reordered composition IDs", () => {
    expect(validateBundleManifest(validManifest({ templateVersion: "2.0.0" })).success)
      .toBe(false);
    expect(validateBundleManifest(validManifest({
      compositionIds: ["ChapterVideo", "StoryboardShot", "DaojieTimeline"],
    })).success).toBe(false);
  });

  it.each([
    ["duplicate", ["StoryboardShot", "ChapterVideo", "ChapterVideo"]],
    ["missing", ["StoryboardShot", "ChapterVideo"]],
    ["extra", ["StoryboardShot", "ChapterVideo", "DaojieTimeline", "Extra"]],
  ])("rejects a %s composition registry", (_label, compositionIds) => {
    expect(validateBundleManifest(validManifest({ compositionIds })).success).toBe(false);
  });

  it("rejects a malformed contentHash", () => {
    const result = validateBundleManifest(validManifest({ contentHash: "short" }));
    expect(result.success).toBe(false);
  });
});

describe("assertBundleMatchesRuntime", () => {
  it("passes when bundle and runtime versions match", () => {
    expect(() =>
      assertBundleMatchesRuntime(validManifest(), "4.0.499"),
    ).not.toThrow();
  });

  it("throws before browser launch when versions mismatch", () => {
    expect(() =>
      assertBundleMatchesRuntime(validManifest(), "4.0.500"),
    ).toThrow("版本不一致");
  });

  it("throws when the manifest itself is invalid", () => {
    expect(() =>
      assertBundleMatchesRuntime({ schemaVersion: 2 }, "4.0.499"),
    ).toThrow();
  });
});
