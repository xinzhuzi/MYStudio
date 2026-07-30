// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashBundleContent, verifyFixedRemotionBundle } from "./bundle-preflight.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "remotion-preflight-"));
  fs.mkdirSync(path.join(root, ".cache", "remotion-bundle"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { remotion: "4.0.499" }}));
  const dir = path.join(root, ".cache", "remotion-bundle");
  for (const file of ["index.html", "bundle.js", "bundle.js.map"]) fs.writeFileSync(path.join(dir, file), file);
  const contentHash = hashBundleContent(dir);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    schemaVersion: 2,
    templateId: "mystudio-remotion-v1",
    templateVersion: "1.0.0",
    remotionVersion: "4.0.499",
    compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
    compositionId: "DaojieTimeline",
    contentHash,
  }));
  return { root, dir };
}

describe("fixed Remotion bundle preflight", () => {
  it("accepts a valid bundle", () => expect(verifyFixedRemotionBundle({ appRoot: fixture().root }).manifest.compositionId).toBe("DaojieTimeline"));
  it("rejects missing manifest/files", () => {
    const { root, dir } = fixture(); fs.rmSync(path.join(dir, "manifest.json")); fs.rmSync(path.join(dir, "bundle.js"));
    expect(() => verifyFixedRemotionBundle({ appRoot: root })).toThrow(/manifest|bundle/);
  });
  it("rejects version drift and content drift", () => {
    const { root, dir } = fixture(); fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { remotion: "4.0.500" }}));
    expect(() => verifyFixedRemotionBundle({ appRoot: root })).toThrow(/版本漂移/);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { remotion: "4.0.499" }})); fs.appendFileSync(path.join(dir, "bundle.js"), "drift");
    expect(() => verifyFixedRemotionBundle({ appRoot: root })).toThrow(/contentHash/);
  });
  it("rejects a reordered or incomplete composition registry", () => {
    const { root, dir } = fixture();
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    manifest.compositionIds = ["ChapterVideo", "StoryboardShot", "DaojieTimeline"];
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    expect(() => verifyFixedRemotionBundle({ appRoot: root })).toThrow(/compositionIds/);
  });
});
