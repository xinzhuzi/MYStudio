// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashBundleContent } from "./bundle-preflight.mjs";
import { inspectPackagedRemotionApp } from "./verify-packaged-remotion.mjs";

describe("packaged Remotion runtime", () => {
  it("requires the fixed bundle manifest and unpacked arm64 compositor", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-packaged-remotion-"));
    const appPath = path.join(root, "漫影工作室.app");
    const resources = path.join(appPath, "Contents", "Resources");
    const bundle = path.join(resources, "remotion-bundle");
    const compositor = path.join(resources, "app.asar.unpacked", "node_modules", "@remotion", "compositor-darwin-arm64");
    fs.mkdirSync(bundle, { recursive: true });
    fs.mkdirSync(compositor, { recursive: true });
    fs.writeFileSync(path.join(resources, "app.asar"), "fixture", "utf8");
    writeFixedBundleFixture(bundle);
    const workerChunkPath = writeWorkerFixture(resources);
    for (const name of ["ffmpeg", "ffprobe", "remotion"]) fs.writeFileSync(path.join(compositor, name), "fixture", "utf8");
    try {
      const listAsarEntries = () => ["/out/main.js", "/node_modules/remotion/index.js"];
      expect(inspectPackagedRemotionApp(appPath, {
        listAsarEntries,
        readRemotionVersion: () => "4.0.499",
      }).manifest.remotionVersion).toBe("4.0.499");
      fs.rmSync(workerChunkPath);
      expect(() => inspectPackagedRemotionApp(appPath, {
        listAsarEntries,
        readRemotionVersion: () => "4.0.499",
      })).toThrow("缺少解包 chunk");
      fs.writeFileSync(workerChunkPath, "module.exports = {};\n", "utf8");
      fs.appendFileSync(path.join(bundle, "bundle.js"), "tampered");
      expect(() => inspectPackagedRemotionApp(appPath, {
        listAsarEntries,
        readRemotionVersion: () => "4.0.499",
      })).toThrow("contentHash");
      fs.writeFileSync(path.join(bundle, "bundle.js"), "//# sourceMappingURL=bundle.js.map\n", "utf8");
      fs.rmSync(path.join(bundle, "bundle.js.map"));
      expect(() => inspectPackagedRemotionApp(appPath, {
        listAsarEntries,
        readRemotionVersion: () => "4.0.499",
      })).toThrow("bundle.js.map");
      fs.writeFileSync(path.join(bundle, "bundle.js.map"), "{}", "utf8");
      fs.rmSync(path.join(compositor, "ffprobe"));
      expect(() => inspectPackagedRemotionApp(appPath, {
        listAsarEntries,
        readRemotionVersion: () => "4.0.499",
      })).toThrow("ffprobe");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    "/node_modules/@remotion/bundler/index.js",
    "/node_modules/@remotion/cli/index.js",
    "/node_modules/.remotion/chrome-headless-shell/chrome",
    "/.agents/skills/remotion-best-practices/SKILL.md",
    "/skills-lock.json",
  ])("拒绝打包禁止资源 %s", (forbiddenEntry) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-packaged-remotion-forbidden-"));
    const appPath = createPackagedFixture(root);
    try {
      expect(() => inspectPackagedRemotionApp(appPath, {
        listAsarEntries: () => ["/out/main.js", forbiddenEntry],
        readRemotionVersion: () => "4.0.499",
      })).toThrow("禁止的 Remotion 开发/浏览器资源");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an unpacked worker with a bare renderer require", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-packaged-remotion-worker-root-"));
    const appPath = createPackagedFixture(root);
    const workerPath = path.join(
      appPath,
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "out",
      "main",
      "remotion-render-worker.cjs",
    );
    fs.writeFileSync(
      workerPath,
      'require("@remotion/renderer");\nrequire("./chunks/remotion-render-output-fixture.cjs");\n',
      "utf8",
    );
    try {
      expect(() => inspectPackagedRemotionApp(appPath, {
        listAsarEntries: () => ["/out/main.js", "/node_modules/remotion/index.js"],
        readRemotionVersion: () => "4.0.499",
      })).toThrow("app.asar.unpacked 裸加载");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function createPackagedFixture(root: string): string {
  const appPath = path.join(root, "漫影工作室.app");
  const resources = path.join(appPath, "Contents", "Resources");
  const bundle = path.join(resources, "remotion-bundle");
  const compositor = path.join(resources, "app.asar.unpacked", "node_modules", "@remotion", "compositor-darwin-arm64");
  fs.mkdirSync(bundle, { recursive: true });
  fs.mkdirSync(compositor, { recursive: true });
  fs.writeFileSync(path.join(resources, "app.asar"), "fixture", "utf8");
  writeFixedBundleFixture(bundle);
  writeWorkerFixture(resources);
  for (const name of ["ffmpeg", "ffprobe", "remotion"]) fs.writeFileSync(path.join(compositor, name), "fixture", "utf8");
  return appPath;
}

function writeWorkerFixture(resources: string): string {
  const workerDirectory = path.join(resources, "app.asar.unpacked", "out", "main");
  const chunkDirectory = path.join(workerDirectory, "chunks");
  const chunkPath = path.join(chunkDirectory, "remotion-render-output-fixture.cjs");
  fs.mkdirSync(chunkDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(workerDirectory, "remotion-render-worker.cjs"),
    [
      'const {createRequire} = require("node:module");',
      'const path = require("node:path");',
      'const appAsarPath = path.join(process.resourcesPath, "app.asar");',
      'createRequire(path.join(appAsarPath, "package.json"))("@remotion/renderer");',
      'require("./chunks/remotion-render-output-fixture.cjs");',
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(chunkPath, "module.exports = {};\n", "utf8");
  return chunkPath;
}

function writeFixedBundleFixture(bundle: string): void {
  fs.writeFileSync(path.join(bundle, "index.html"), "<!doctype html>", "utf8");
  fs.writeFileSync(path.join(bundle, "bundle.js"), "//# sourceMappingURL=bundle.js.map\n", "utf8");
  fs.writeFileSync(path.join(bundle, "bundle.js.map"), "{}", "utf8");
  fs.writeFileSync(path.join(bundle, "manifest.json"), JSON.stringify({
    schemaVersion: 2,
    templateId: "mystudio-remotion-v1",
    templateVersion: "1.0.0",
    remotionVersion: "4.0.499",
    compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
    compositionId: "DaojieTimeline",
    contentHash: hashBundleContent(bundle),
  }), "utf8");
}
