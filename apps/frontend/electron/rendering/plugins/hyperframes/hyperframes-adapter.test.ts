import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHyperFramesAdapter } from "./hyperframes-adapter";

const hash = "a".repeat(64);

describe("HyperFrames adapter", () => {
  it("writes an auditable no-op artifact when the chapter has no overlay windows", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-hyperframes-"));
    const adapter = createHyperFramesAdapter({
      storageBasePath: root,
      workspaceRootForProject: (projectId) => path.join(root, "projects", projectId, "video-workflow"),
      probeRuntime: async (paths) => ({ state: "needs-runtime", paths, missing: ["node22"], versions: {} }),
      execFile: async () => { throw new Error("must not spawn for no-op"); },
      now: () => 123,
    });
    const result = await adapter.renderOverlay({
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      sourceArtifactSha256: hash,
      inputSha256: hash,
      width: 1920,
      height: 1080,
      fps: 30,
      alphaFormat: "prores-4444-mov",
      outputPath: path.join(root, "overlay.mov"),
      windows: [],
    });
    expect(result).toMatchObject({ state: "ready", artifact: { status: "noop", generatedAt: 123 }, artifactPath: expect.any(String) });
    if (result.state === "ready" && result.artifactPath) {
      await expect(fs.readFile(result.artifactPath, "utf8")).resolves.toContain('"status": "noop"');
    }
  });

  it("blocks a non-empty overlay when the runtime is not ready", async () => {
    const adapter = createHyperFramesAdapter({
      storageBasePath: "/storage",
      workspaceRootForProject: (projectId) => `/storage/projects/${projectId}/video-workflow`,
      probeRuntime: async (paths) => ({ state: "needs-runtime", paths, missing: ["node22"], versions: {}, message: "Node 22 未准备" }),
      execFile: async () => { throw new Error("must not spawn"); },
    });
    const result = await adapter.renderOverlay({
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      sourceArtifactSha256: hash,
      inputSha256: hash,
      width: 1920,
      height: 1080,
      fps: 30,
      alphaFormat: "prores-4444-mov",
      outputPath: "/storage/overlay.mov",
      windows: [{ slotId: "title", startUs: 0, durationUs: 1_000_000, templateId: "title-card", parameters: {} }],
    });
    expect(result).toMatchObject({ state: "blocked", code: "runtime-not-ready" });
  });

  it("rejects PNG sequence before probing or spawning the worker", async () => {
    let probeCalls = 0;
    let spawnCalls = 0;
    const adapter = createHyperFramesAdapter({
      storageBasePath: "/storage",
      workspaceRootForProject: (projectId) => `/storage/projects/${projectId}/video-workflow`,
      probeRuntime: async (paths) => {
        probeCalls += 1;
        return { state: "ready", paths, missing: [], versions: {} };
      },
      workerPath: "/storage/hyperframes-worker.cjs",
      resolveBrowserPath: async () => "/storage/chrome-headless-shell",
      execFile: async () => {
        spawnCalls += 1;
        throw new Error("must not spawn");
      },
    });
    const result = await adapter.renderOverlay({
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      sourceArtifactSha256: hash,
      inputSha256: hash,
      width: 1920,
      height: 1080,
      fps: 30,
      alphaFormat: "png-sequence",
      outputPath: "/storage/overlay-frames",
      windows: [{ slotId: "title", startUs: 0, durationUs: 1_000_000, templateId: "title-card", parameters: {} }],
    });
    expect(result).toMatchObject({ state: "blocked", code: "invalid-request" });
    expect(probeCalls).toBe(0);
    expect(spawnCalls).toBe(0);
  });

  it("passes the managed Node/CLI and shared FFmpeg paths to the worker", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-hyperframes-worker-"));
    const workerPath = path.join(root, "hyperframes-worker.cjs");
    const browserPath = path.join(root, "chrome-headless-shell");
    await fs.writeFile(workerPath, "worker", "utf8");
    await fs.writeFile(browserPath, "browser", "utf8");
    let receivedEnv: NodeJS.ProcessEnv | undefined;
    const adapter = createHyperFramesAdapter({
      storageBasePath: root,
      workspaceRootForProject: (projectId) => path.join(root, "projects", projectId, "video-workflow"),
      workerPath,
      resolveBrowserPath: async () => browserPath,
      probeRuntime: async (paths) => ({
        state: "ready",
        paths,
        missing: [],
        versions: { python: "Python 3.12.4", node: "v22.14.0", ffmpeg: "ffmpeg 7", ffprobe: "ffprobe 7" },
      }),
      execFile: async (_file, args, options) => {
        receivedEnv = options.env;
        const requestPath = args[args.indexOf("--request") + 1];
        const artifactPath = args[args.indexOf("--output") + 1];
        const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
        await fs.mkdir(path.dirname(artifactPath), { recursive: true });
        await fs.writeFile(artifactPath, JSON.stringify({
          schemaVersion: 1,
          projectId: request.projectId,
          chapterId: request.chapterId,
          revision: request.revision,
          status: "accepted",
          sourceArtifactSha256: request.sourceArtifactSha256,
          inputSha256: request.inputSha256,
          alphaFormat: request.alphaFormat,
          outputPath: request.outputPath,
          outputSha256: hash,
          windows: request.windows,
          toolVersion: "hyperframes@0.7.101",
          generatedAt: 123,
        }), "utf8");
        return {};
      },
    });
    const result = await adapter.renderOverlay({
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      sourceArtifactSha256: hash,
      inputSha256: hash,
      width: 1920,
      height: 1080,
      fps: 30,
      alphaFormat: "prores-4444-mov",
      outputPath: path.join(root, "overlay.mov"),
      windows: [{ slotId: "title", startUs: 0, durationUs: 1_000_000, templateId: "title-card", parameters: {} }],
    });
    expect(result).toMatchObject({ state: "ready", artifact: { status: "accepted", toolVersion: "hyperframes@0.7.101" } });
    expect(receivedEnv?.MYSTUDIO_HYPERFRAMES_WORKER).toBe("1");
    expect(receivedEnv?.MYSTUDIO_HYPERFRAMES_CLI).toContain("hyperframes-profile/node_modules/hyperframes/bin/hyperframes.mjs");
    expect(receivedEnv?.MYSTUDIO_HYPERFRAMES_NODE).toBe(adapter.paths.electronExecutable);
  });
});
