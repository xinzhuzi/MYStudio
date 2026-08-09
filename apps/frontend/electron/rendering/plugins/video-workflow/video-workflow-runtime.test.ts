import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSharedToolchainEnv,
  buildHyperFramesProfileMarker,
  buildVideoUseProfileMarker,
  probeHyperFramesRuntime,
  probeVideoUseRuntime,
  probeVideoWorkflowAlignmentRuntime,
  probeVideoWorkflowRuntime,
  resolveVideoWorkflowRuntimePaths,
  isHyperFramesDoctorReady,
} from "./video-workflow-runtime";

const hash = "a".repeat(64);

const originalToolchainEnv = {
  ffmpeg: process.env.MYSTUDIO_FFMPEG_PATH,
  ffprobe: process.env.MYSTUDIO_FFPROBE_PATH,
  browser: process.env.HYPERFRAMES_BROWSER_PATH,
};

beforeEach(() => {
  process.env.MYSTUDIO_FFMPEG_PATH = "/shared/ffmpeg";
  process.env.MYSTUDIO_FFPROBE_PATH = "/shared/ffprobe";
  process.env.HYPERFRAMES_BROWSER_PATH = "/shared/chrome-headless-shell";
});

afterEach(() => {
  if (originalToolchainEnv.ffmpeg === undefined) delete process.env.MYSTUDIO_FFMPEG_PATH;
  else process.env.MYSTUDIO_FFMPEG_PATH = originalToolchainEnv.ffmpeg;
  if (originalToolchainEnv.ffprobe === undefined) delete process.env.MYSTUDIO_FFPROBE_PATH;
  else process.env.MYSTUDIO_FFPROBE_PATH = originalToolchainEnv.ffprobe;
  if (originalToolchainEnv.browser === undefined) delete process.env.HYPERFRAMES_BROWSER_PATH;
  else process.env.HYPERFRAMES_BROWSER_PATH = originalToolchainEnv.browser;
});

describe("video workflow runtime", () => {
  it("reuses storage python and keeps independent profile markers", () => {
    const paths = resolveVideoWorkflowRuntimePaths("/tmp/mystudio-storage", "darwin");
    expect(paths.pythonExecutable).toBe("/tmp/mystudio-storage/python/bin/python3");
    expect(paths.videoUseProfileDir).toBe("/tmp/mystudio-storage/python/profiles/video-use");
    expect(paths.videoUseUpstreamRoot).toBe("/tmp/mystudio-storage/python/profiles/video-use/upstream");
    expect(paths.videoUseLockPath).toContain("requirements-video-use.lock");
    expect(paths.nodeExecutable).toBe("/tmp/mystudio-storage/node22/bin/node");
    expect(paths.hyperFramesCliPath).toBe("/tmp/mystudio-storage/node22/profiles/hyperframes/node_modules/.bin/hyperframes");
    expect(buildVideoUseProfileMarker(paths, hash).profileId).toBe("video-use-managed-python-v1");
    expect(buildHyperFramesProfileMarker(paths).npmVersion).toBe("0.7.101");
  });

  it("passes the bundled macOS FFmpeg dylib directory to child processes", () => {
    const paths = resolveVideoWorkflowRuntimePaths("/tmp/mystudio-storage", "darwin");
    const env = buildSharedToolchainEnv({
      ffmpegExecutable: "/opt/mystudio/compositor/ffmpeg",
      ffprobeExecutable: "/opt/mystudio/compositor/ffprobe",
    }, { PATH: "/managed/node22/bin" });
    expect(env.MYSTUDIO_FFMPEG_PATH).toBe("/opt/mystudio/compositor/ffmpeg");
    expect(env.MYSTUDIO_FFPROBE_PATH).toBe("/opt/mystudio/compositor/ffprobe");
    if (process.platform === "darwin") expect(env.DYLD_LIBRARY_PATH).toContain("/opt/mystudio/compositor");
    expect(env.PATH).toContain("/managed/node22/bin");
    expect(paths.ffmpegExecutable).toBe("/shared/ffmpeg");
  });

  it("reports missing shared runtimes without downloading or creating a venv", async () => {
    const paths = resolveVideoWorkflowRuntimePaths("/tmp/mystudio-storage", "darwin");
    const result = await probeVideoWorkflowRuntime(paths, {
      fileExists: () => false,
      execFile: async () => ({ stdout: "", stderr: "" }),
    });
    expect(result.state).toBe("needs-runtime");
    expect(result.missing).toContain("managed-python");
    expect(result.missing).toContain("node22");
  });

  it("allows alignment to reuse managed Python before video-use and Node profiles exist", async () => {
    const paths = resolveVideoWorkflowRuntimePaths("/tmp/mystudio-storage", "darwin");
    const result = await probeVideoWorkflowAlignmentRuntime(paths, {
      fileExists: (filePath) => filePath === paths.pythonExecutable,
      execFile: async () => ({ stdout: "Python 3.12.7", stderr: "" }),
    });
    expect(result.state).toBe("ready");
    expect(result.missing).toEqual([]);
    expect(result.versions.python).toBe("Python 3.12.7");
  });

  it("allows video-use to run before Node 22/HyperFrames is prepared", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-video-use-runtime-"));
    try {
      const paths = resolveVideoWorkflowRuntimePaths(root, "darwin");
      fs.mkdirSync(path.dirname(paths.videoUseLockPath), { recursive: true });
      fs.writeFileSync(paths.videoUseLockPath, "lock\n", "utf8");
      fs.writeFileSync(paths.videoUseMarkerPath, JSON.stringify(buildVideoUseProfileMarker(
        paths,
        crypto.createHash("sha256").update("lock\n").digest("hex"),
      )), "utf8");
      const result = await probeVideoUseRuntime(paths, {
        fileExists: (filePath) => filePath === paths.pythonExecutable
          || filePath === paths.videoUseMarkerPath
          || filePath === paths.videoUseLockPath,
        execFile: async (_file, args) => ({
          stdout: args[0] === "--version" ? "Python 3.12.7" : "ffmpeg version 7.1.1",
          stderr: "",
        }),
      });
      expect(result.state).toBe("ready");
      expect(result.missing).toEqual([]);
      expect(result.missing).not.toContain("node22");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows HyperFrames to probe independently from managed Python", async () => {
    const paths = resolveVideoWorkflowRuntimePaths("/tmp/mystudio-storage", "darwin");
    const result = await probeHyperFramesRuntime(paths, {
      fileExists: (filePath) => filePath === paths.nodeExecutable
        || filePath === paths.hyperFramesMarkerPath
        || filePath === paths.hyperFramesCliPath
        || filePath === paths.hyperFramesBrowserPath
        || filePath === paths.ffmpegExecutable
        || filePath === paths.ffprobeExecutable,
      execFile: async (_file, args) => {
        if (args[0] === "--version") return { stdout: "v22.14.0", stderr: "" };
        if (args.includes("doctor") && args.includes("--json")) return { stdout: JSON.stringify({
          ok: true,
          checks: [
            { name: "Version", ok: true },
            { name: "Node.js", ok: true },
            { name: "FFmpeg", ok: true },
            { name: "FFprobe", ok: true },
            { name: "Chrome", ok: true },
          ],
        }), stderr: "" };
        if (args.includes("browser") && args.includes("path")) return { stdout: `${paths.hyperFramesBrowserPath}\n`, stderr: "" };
        return { stdout: "ffmpeg version 7.1.1", stderr: "" };
      },
    });
    expect(result.state).toBe("ready");
    expect(result.missing).toEqual([]);
    expect(result.versions.browser).toBe(paths.hyperFramesBrowserPath);
  });

  it("fails closed on doctor ok=false without attempting browser path or ensure", async () => {
    const paths = resolveVideoWorkflowRuntimePaths("/tmp/mystudio-storage", "darwin");
    const calls: string[][] = [];
    const result = await probeHyperFramesRuntime(paths, {
      fileExists: (filePath) => filePath === paths.nodeExecutable
        || filePath === paths.hyperFramesMarkerPath
        || filePath === paths.hyperFramesCliPath
        || filePath === paths.hyperFramesBrowserPath
        || filePath === paths.ffmpegExecutable
        || filePath === paths.ffprobeExecutable,
      execFile: async (_file, args) => {
        calls.push(args);
        if (args[0] === "--version") return { stdout: "v22.14.0", stderr: "" };
        return { stdout: JSON.stringify({ ok: false, checks: [{ name: "Chrome", ok: false }] }), stderr: "" };
      },
    });
    expect(result.state).toBe("blocked");
    expect(result.missing).toContain("hyperframes-doctor");
    expect(calls.some((args) => args.includes("browser") && args.includes("path"))).toBe(false);
  });

  it("accepts HyperFrames doctor failures that are optional authoring integrations", () => {
    expect(isHyperFramesDoctorReady({
      ok: false,
      checks: [
        { name: "Version", ok: true },
        { name: "Node.js", ok: true },
        { name: "FFmpeg", ok: true },
        { name: "FFprobe", ok: true },
        { name: "Chrome", ok: true },
        { name: "whisper-cpp", ok: false },
        { name: "TTS (Kokoro)", ok: false },
      ],
    })).toBe(true);
    expect(isHyperFramesDoctorReady({
      ok: false,
      checks: [
        { name: "Version", ok: true },
        { name: "Node.js", ok: true },
        { name: "FFmpeg", ok: false },
        { name: "FFprobe", ok: true },
        { name: "Chrome", ok: true },
      ],
    })).toBe(false);
  });

  it("requires an absolute browser path and never invokes browser ensure implicitly", async () => {
    const paths = resolveVideoWorkflowRuntimePaths("/tmp/mystudio-storage", "darwin");
    const result = await probeHyperFramesRuntime({ ...paths, hyperFramesBrowserPath: "" }, {
      fileExists: (filePath) => filePath === paths.nodeExecutable
        || filePath === paths.hyperFramesMarkerPath
        || filePath === paths.hyperFramesCliPath
        || filePath === paths.ffmpegExecutable
        || filePath === paths.ffprobeExecutable,
      execFile: async (_file, args) => ({
        stdout: args[0] === "--version" ? "v22.14.0" : "",
        stderr: "",
      }),
    });
    expect(result.state).toBe("needs-runtime");
    expect(result.missing).toEqual(["browser-path"]);
  });

  it("does not leave a partial marker when writing a valid marker", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-video-runtime-"));
    const paths = resolveVideoWorkflowRuntimePaths(root, "darwin");
    const marker = buildHyperFramesProfileMarker(paths, 1);
    fs.mkdirSync(path.dirname(paths.hyperFramesMarkerPath), { recursive: true });
    fs.writeFileSync(paths.hyperFramesMarkerPath, JSON.stringify(marker), "utf8");
    expect(JSON.parse(fs.readFileSync(paths.hyperFramesMarkerPath, "utf8"))).toMatchObject({ profileId: "hyperframes-node22-v1" });
  });
});
