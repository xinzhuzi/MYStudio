import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildVideoUseAlignmentArgs, buildVideoUseWorkerArgs, createVideoUseAdapter } from "./video-use-adapter";

describe("video-use adapter", () => {
  it("passes only explicit managed paths to the Python worker", () => {
    expect(buildVideoUseWorkerArgs({
      moduleName: "video_use.worker",
      inputPath: "/storage/project/chapter/r1/video-use-run.json",
      alignmentPath: "/storage/project/chapter/r1/alignment.json",
      outputPath: "/storage/project/chapter/r1/video-use-artifact.json",
      profilePath: "/storage/python/profiles/video-use/profile.json",
      ffmpegPath: "/usr/local/bin/ffmpeg",
      ffprobePath: "/usr/local/bin/ffprobe",
    })).toEqual([
      "-m", "video_use.worker", "--run", "--input", "/storage/project/chapter/r1/video-use-run.json",
      "--alignment", "/storage/project/chapter/r1/alignment.json",
      "--output", "/storage/project/chapter/r1/video-use-artifact.json", "--profile", "/storage/python/profiles/video-use/profile.json",
      "--ffmpeg", "/usr/local/bin/ffmpeg", "--ffprobe", "/usr/local/bin/ffprobe",
    ]);
  });

  it("keeps canonical alignment as a separate managed-Python stage", () => {
    expect(buildVideoUseAlignmentArgs({
      moduleName: "video_use.worker",
      inputPath: "/storage/project/chapter/r1/video-use-run.json",
      outputPath: "/storage/project/chapter/r1/alignment.json",
    })).toEqual([
      "-m", "video_use.worker", "--align", "--input", "/storage/project/chapter/r1/video-use-run.json",
      "--output", "/storage/project/chapter/r1/alignment.json",
    ]);
  });

  it("fails closed before spawning when managed runtime is not ready", async () => {
    const adapter = createVideoUseAdapter({
      storageBasePath: "/storage",
      backendRoot: "/repo/apps/backend",
      workspaceRootForProject: (projectId) => `/storage/projects/${projectId}/video-use`,
      probeRuntime: async (paths) => ({ state: "needs-runtime", paths, missing: ["managed-python"], versions: {}, message: "请先准备 Python" }),
      execFile: async () => { throw new Error("must not spawn"); },
    });
    const result = await adapter.probe();
    expect(result.state).toBe("blocked");
    expect(result.message).toContain("Python");
  });

  it("surfaces a missing local Whisper model from the video-use probe", async () => {
    const adapter = createVideoUseAdapter({
      storageBasePath: "/storage",
      backendRoot: "/repo/apps/backend",
      workspaceRootForProject: (projectId) => `/storage/projects/${projectId}/video-use`,
      probeRuntime: async (paths) => ({ state: "ready", paths, missing: [], versions: { python: "Python 3.12.7" } }),
      execFile: async () => {
        throw Object.assign(new Error("alignment blocked"), {
          stdout: JSON.stringify({ status: "blocked", code: "alignment-model-missing", message: "本地模型未准备" }),
        });
      },
    });

    await expect(adapter.probe()).resolves.toMatchObject({
      state: "blocked",
      code: "alignment-model-missing",
      message: "本地模型未准备",
    });
  });

  it("passes alignment to the formal worker and preserves its blocked code", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-video-use-"));
    const hash = "a".repeat(64);
    let call = 0;
    const environments: Array<NodeJS.ProcessEnv | undefined> = [];
    const adapter = createVideoUseAdapter({
      storageBasePath: root,
      backendRoot: "/repo/apps/backend",
      workspaceRootForProject: (projectId) => path.join(root, "projects", projectId, "video-use"),
      probeAlignmentRuntime: async (paths) => ({ state: "ready", paths, missing: [], versions: { python: "Python 3.12.7" } }),
      probeRuntime: async (paths) => ({ state: "ready", paths, missing: [], versions: { python: "Python 3.12.7", ffmpeg: "ffmpeg 7", ffprobe: "ffprobe 7" } }),
      execFile: async (_file, args, commandOptions) => {
        call += 1;
        environments.push(commandOptions.env);
        const outputPath = args[args.indexOf("--output") + 1];
        if (args.includes("--align")) {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, JSON.stringify({ schemaVersion: 1, status: "ready", projectId: "project-1", chapterId: "chapter-1", revision: 1, shots: [] }), "utf8");
          return {};
        }
        const error = Object.assign(new Error("worker blocked"), {
          stdout: JSON.stringify({ code: "upstream-helper-failed", message: "helper failed" }),
        });
        throw error;
      },
    });
    const result = await adapter.runChapter({
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      mode: "editable-edl",
      stage: "preparing",
      timeUnit: "seconds",
      shots: [{
        shotId: "shot-1",
        videoPath: "/media/shot.mp4",
        audioPath: "/media/shot.wav",
        ttsSpokenText: "测试",
        sourceSha256: hash,
        audioSha256: hash,
        textSha256: hash,
        durationUs: 1_000_000,
      }],
      sourceSha256: hash,
      audioSha256: hash,
      textSha256: hash,
      featureFlags: { alignment: true, edl: true, subtitles: true, grade: true, preview: true, selfEval: true },
      runtime: { profileId: "video-use", pythonExecutable: "/python", ffmpegExecutable: "/ffmpeg", ffprobeExecutable: "/ffprobe", packageLockSha256: hash, markerPath: "/profile.json" },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(result).toMatchObject({ state: "blocked", code: "upstream-helper-failed" });
    expect(call).toBe(2);
    expect(environments[0]?.MANYING_TTS_MODELS_DIR).toBe(path.join(root, "tts-models"));
    expect(environments[0]?.VOICEBOX_MODELS_DIR).toBe(path.join(root, "tts-models"));
  });
});
