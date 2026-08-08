// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readManifest } from "./render-daojie-remotion-timeline";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeManifest(compositionIds: unknown[], remotionVersion = "4.0.499"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-daojie-timeline-manifest-"));
  roots.push(root);
  const bundle = path.join(root, ".cache", "remotion-bundle");
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(bundle, "manifest.json"), JSON.stringify({
    schemaVersion: 2,
    templateId: "mystudio-remotion-v1",
    templateVersion: "1.0.0",
    remotionVersion,
    compositionIds,
    compositionId: "DaojieTimeline",
    contentHash: "a".repeat(64),
  }), "utf8");
  return bundle;
}

describe("Daojie timeline bundle manifest", () => {
  it("accepts the exact ordered composition registry", () => {
    const bundle = writeManifest(["StoryboardShot", "ChapterVideo", "DaojieTimeline"]);
    expect(readManifest(bundle).compositionIds).toEqual([
      "StoryboardShot",
      "ChapterVideo",
      "DaojieTimeline",
    ]);
  });

  it.each([
    ["reordered", ["ChapterVideo", "StoryboardShot", "DaojieTimeline"]],
    ["duplicate", ["StoryboardShot", "ChapterVideo", "ChapterVideo"]],
    ["missing", ["StoryboardShot", "ChapterVideo"]],
    ["extra", ["StoryboardShot", "ChapterVideo", "DaojieTimeline", "Extra"]],
  ])("rejects %s composition IDs before the timeline render", (_label, compositionIds) => {
    const bundle = writeManifest(compositionIds);
    expect(() => readManifest(bundle)).toThrow(/compositionIds/);
  });
});
