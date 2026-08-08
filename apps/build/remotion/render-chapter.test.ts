import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { parseChapterSmokeShotCount } from "./render-chapter";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
});

describe("runChapterSmoke lifecycle", () => {
  it.each(["1", "2", "5"])("accepts dynamic chapter shot count %s", (rawValue) => {
    expect(parseChapterSmokeShotCount(rawValue)).toBe(Number(rawValue));
  });

  it("rejects invalid chapter shot counts", () => {
    expect(() => parseChapterSmokeShotCount("0")).toThrow("大于等于 1");
    expect(() => parseChapterSmokeShotCount("1.5")).toThrow("大于等于 1");
  });

  it("projects ChapterVideo from a V2 manifest without legacy audio bypasses", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "build/remotion/render-chapter.ts"),
      "utf8",
    );
    expect(source).toContain("createRemotionChapterManifestFingerprint");
    expect(source).toContain("chapterManifest,");
    expect(source).toContain("mediaUrlByBindingId: Object.fromEntries");
    expect(source).toContain("sharedAudioBindings");
    expect(source).toContain("analyzeRenderedAudioWindows");
    expect(source).toContain("role: \"voice\"");
    expect(source).toContain("role: role as \"bgm\" | \"ambience\"");
    expect(source).toContain("fadeInUs");
    expect(source).toContain("ducking: { enabled: duckingEnabled");
    expect(source).toContain("audioWindows");
    expect(source).toContain("ffmpegPostProcess: false");
    expect(source).toContain("path.resolve(previousCwd, process.env.MYSTUDIO_REMOTION_CHAPTER_REPORT)");
    expect(source).toContain("assertBundleMatchesRuntime");
    expect(source).not.toContain("compositionIds.includes");
    expect(source).not.toContain("chapterAudioClipIds");
    expect(source).not.toContain("sharedAudioTracks");
  });

  it("restores the caller cwd when the browser preflight fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-chapter-test-"));
    const bundlePath = path.join(root, "bundle");
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(
      path.join(bundlePath, "manifest.json"),
      JSON.stringify({
        schemaVersion: 2,
        templateId: "mystudio-remotion-v1",
        templateVersion: "1.0.0",
        remotionVersion: "4.0.499",
        compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
        compositionId: "DaojieTimeline",
        contentHash: "a".repeat(64),
      }),
      "utf8",
    );

    process.env.MYSTUDIO_REMOTION_BUNDLE = bundlePath;
    process.env.MYSTUDIO_REMOTION_CHAPTER_DIR = path.join(root, "chapter");
    process.env.MYSTUDIO_REMOTION_RUNTIME_DIR = path.join(root, "runtime");
    process.env.MYSTUDIO_REMOTION_BROWSER_EXECUTABLE = path.join(root, "missing-headless-shell");

    const previousCwd = process.cwd();
    const scriptPath = path.join(root, "cwd-probe.mts");
    const modulePath = path.resolve(process.cwd(), "build/remotion/render-chapter.ts");
    fs.writeFileSync(scriptPath, `
      import { runChapterSmoke } from ${JSON.stringify(modulePath)};
      const initialCwd = process.cwd();
      try {
        await runChapterSmoke();
        process.exitCode = 2;
      } catch (error) {
        console.log(JSON.stringify({ initialCwd, finalCwd: process.cwd(), error: String(error) }));
      }
    `, "utf8");
    const output = execFileSync(path.resolve(process.cwd(), "node_modules/.bin/vite-node"), [
      "--config", "frontend/config/vite.config.ts", scriptPath,
    ], {
      cwd: previousCwd,
      env: process.env,
      encoding: "utf8",
    });
    const result = JSON.parse(output.trim().split("\n").at(-1) ?? "{}");
    expect(result.error).toContain("不是可读文件");
    expect(result.finalCwd).toBe(previousCwd);
  });
});
