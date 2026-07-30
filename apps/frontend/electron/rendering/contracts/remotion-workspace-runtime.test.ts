import { describe, expect, it } from "vitest";
import {
  validateRemotionWorkspaceRuntimeReply,
} from "./remotion-workspace-runtime";

const valid = {
  schemaVersion: 1,
  templateId: "mystudio-remotion-v1",
  templateVersion: "1.0.0",
  remotionVersion: "4.0.499",
  bundleContentHash: "a".repeat(64),
  compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
};

describe("Remotion workspace runtime reply", () => {
  it("accepts the fixed metadata contract", () => {
    expect(validateRemotionWorkspaceRuntimeReply(valid).success).toBe(true);
  });

  it.each([
    ["templateId", "other"],
    ["templateVersion", "2.0.0"],
    ["remotionVersion", "^4.0.499"],
    ["bundleContentHash", "short"],
    ["compositionIds", ["ChapterVideo", "StoryboardShot", "DaojieTimeline"]],
  ])("rejects caller/runtime metadata drift in %s", (key, value) => {
    const result = validateRemotionWorkspaceRuntimeReply({ ...valid, [key]: value });
    expect(result.success).toBe(false);
  });
});
