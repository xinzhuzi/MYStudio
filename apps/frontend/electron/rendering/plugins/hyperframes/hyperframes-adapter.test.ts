import fs from "node:fs/promises";
import { createHash } from "node:crypto";
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
      outputPath: path.join(root, "projects", "project-1", "video-workflow", "chapter-1", "r1", "hyperframes-overlay.mov"),
      windows: [],
    });
    expect(result).toMatchObject({ state: "ready", artifact: { status: "noop", generatedAt: 123 }, artifactPath: expect.any(String) });
    if (result.state === "ready" && result.artifactPath) {
      await expect(fs.readFile(result.artifactPath, "utf8")).resolves.toContain('"status": "noop"');
    }
  });

  it.each([
    { projectId: ".", chapterId: "chapter-1" },
    { projectId: "project-1", chapterId: ".." },
    { projectId: "project/1", chapterId: "chapter-1" },
  ])("returns invalid-request for unsafe identity segments %#", async ({ projectId, chapterId }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-hyperframes-invalid-id-"));
    const workspaceRoot = path.join(root, "workspace");
    const adapter = createHyperFramesAdapter({
      storageBasePath: root,
      workspaceRootForProject: () => workspaceRoot,
      execFile: async () => { throw new Error("must not spawn"); },
    });

    await expect(adapter.renderOverlay({
      schemaVersion: 1,
      projectId,
      chapterId,
      revision: 1,
      sourceArtifactSha256: hash,
      inputSha256: hash,
      width: 1920,
      height: 1080,
      fps: 30,
      alphaFormat: "prores-4444-mov",
      outputPath: path.join(workspaceRoot, "chapter-1", "r1", "hyperframes-overlay.mov"),
      windows: [],
    })).resolves.toMatchObject({ state: "blocked", code: "invalid-request" });
    await expect(fs.stat(workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked chapter before creating any directory outside the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-hyperframes-symlink-"));
    const workspaceRoot = path.join(root, "workspace");
    const externalRoot = path.join(root, "external");
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(externalRoot, { recursive: true });
    await fs.symlink(externalRoot, path.join(workspaceRoot, "chapter-1"));
    const adapter = createHyperFramesAdapter({
      storageBasePath: root,
      workspaceRootForProject: () => workspaceRoot,
      execFile: async () => { throw new Error("must not spawn"); },
    });

    await expect(adapter.renderOverlay({
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
      outputPath: path.join(workspaceRoot, "chapter-1", "r1", "hyperframes-overlay.mov"),
      windows: [],
    })).resolves.toMatchObject({ state: "blocked", code: "artifact-write-failed" });
    await expect(fs.stat(path.join(externalRoot, "r1"))).rejects.toMatchObject({ code: "ENOENT" });
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
      outputPath: "/storage/projects/project-1/video-workflow/chapter-1/r1/hyperframes-overlay.mov",
      windows: [{ slotId: "title", cueId: "cue-1", startUs: 0, durationUs: 1_000_000, templateId: "title-card", parameters: {} }],
    });
    expect(result).toMatchObject({ state: "blocked", code: "runtime-not-ready" });
  });

  it("rejects an output path outside the managed chapter revision before probing", async () => {
    let probeCalls = 0;
    const adapter = createHyperFramesAdapter({
      storageBasePath: "/storage",
      workspaceRootForProject: (projectId) => `/storage/projects/${projectId}/video-workflow`,
      probeRuntime: async (paths) => {
        probeCalls += 1;
        return { state: "needs-runtime", paths, missing: ["node22"], versions: {} };
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
      outputPath: "/tmp/unmanaged-overlay.mov",
      windows: [{ slotId: "title", cueId: "cue-1", startUs: 0, durationUs: 1_000_000, templateId: "title-card", parameters: {} }],
    });

    expect(result).toMatchObject({ state: "blocked", code: "output-path-invalid" });
    expect(probeCalls).toBe(0);
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
      windows: [{ slotId: "title", cueId: "cue-1", startUs: 0, durationUs: 1_000_000, templateId: "title-card", parameters: {} }],
    });
    expect(result).toMatchObject({ state: "blocked", code: "invalid-request" });
    expect(probeCalls).toBe(0);
    expect(spawnCalls).toBe(0);
  });

  it("passes the managed Node/CLI and shared FFmpeg paths to the worker", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-hyperframes-worker-"));
    const workerPath = path.join(root, "hyperframes-worker.cjs");
    const browserPath = path.join(root, "chrome-headless-shell");
    const electronExecutable = path.join(root, "electron");
    await fs.writeFile(workerPath, "worker", "utf8");
    await fs.writeFile(browserPath, "browser", "utf8");
    await fs.writeFile(electronExecutable, "electron", "utf8");
    let receivedEnv: NodeJS.ProcessEnv | undefined;
    const adapter = createHyperFramesAdapter({
      storageBasePath: root,
      electronExecutable,
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
        const outputBytes = Buffer.from("verified-overlay");
        await fs.writeFile(request.outputPath, outputBytes);
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
          outputSha256: createHash("sha256").update(outputBytes).digest("hex"),
          windows: request.windows,
          toolVersion: "hyperframes@0.7.109",
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
      outputPath: path.join(root, "projects", "project-1", "video-workflow", "chapter-1", "r1", "hyperframes-overlay.mov"),
      windows: [{ slotId: "title", cueId: "cue-1", startUs: -0, durationUs: 1_000_000, templateId: "title-card", parameters: {} }],
    });
    expect(result).toMatchObject({ state: "ready", artifact: { status: "accepted", toolVersion: "hyperframes@0.7.109" } });
    expect(receivedEnv?.MYSTUDIO_HYPERFRAMES_WORKER).toBe("1");
    expect(receivedEnv?.MYSTUDIO_HYPERFRAMES_CLI).toContain("hyperframes-profile/node_modules/hyperframes/bin/hyperframes.mjs");
    expect(receivedEnv?.MYSTUDIO_HYPERFRAMES_NODE).toBe(adapter.paths.electronExecutable);
    expect(adapter.paths.electronExecutable).toBe(electronExecutable);
  });

  it("preserves first-failure evidence and never reruns the worker in the same revision", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-hyperframes-worker-failure-"));
    const workerPath = path.join(root, "hyperframes-worker.cjs");
    const browserPath = path.join(root, "chrome-headless-shell");
    const electronExecutable = path.join(root, "electron");
    const workspaceRoot = path.join(root, "workspace");
    const revisionDir = path.join(workspaceRoot, "chapter-1", "r1");
    const artifactPath = path.join(revisionDir, "hyperframes-artifact.json");
    const managedOutputPath = path.join(revisionDir, "hyperframes-overlay.mov");
    await Promise.all([
      fs.writeFile(workerPath, "worker", "utf8"),
      fs.writeFile(browserPath, "browser", "utf8"),
      fs.writeFile(electronExecutable, "electron", "utf8"),
    ]);
    let workerCalls = 0;
    const adapter = createHyperFramesAdapter({
      storageBasePath: root,
      electronExecutable,
      workspaceRootForProject: () => workspaceRoot,
      workerPath,
      resolveBrowserPath: async () => browserPath,
      probeRuntime: async (paths) => ({ state: "ready", paths, missing: [], versions: {} }),
      execFile: async () => {
        workerCalls += 1;
        if (workerCalls === 1) {
          await fs.writeFile(managedOutputPath, "partial-overlay", "utf8");
          await fs.writeFile(artifactPath, '{"status":"blocked","diagnostic":"first failure"}', "utf8");
        }
        throw new Error(`worker failed ${workerCalls}`);
      },
    });

    await expect(adapter.renderOverlay({
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
      outputPath: managedOutputPath,
      windows: [{ slotId: "title", cueId: "cue-1", startUs: 0, durationUs: 1_000_000, templateId: "title-card", parameters: {} }],
    })).resolves.toMatchObject({ state: "blocked", code: "worker-failed", artifactPath });
    expect(workerCalls).toBe(1);
    await expect(fs.readFile(managedOutputPath, "utf8")).resolves.toBe("partial-overlay");
    await expect(fs.readFile(artifactPath, "utf8")).resolves.toContain("first failure");
  });

  it("surfaces the worker artifact's blocked reason and exec exit metadata on failure", async () => {
    // 08-24 观测性补:worker 非 accepted 时 exitCode=2 并把 blocked 原因写进
    // artifact;adapter 只报"Command failed"会吞掉真实根因(EEXIST/render-failed
    // 等),死机理排障必须能看见。硬死(无 artifact)时附 exit/signal。
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-hyperframes-worker-diag-"));
    const workerPath = path.join(root, "hyperframes-worker.cjs");
    const browserPath = path.join(root, "chrome-headless-shell");
    const electronExecutable = path.join(root, "electron");
    const workspaceRoot = path.join(root, "workspace");
    const revisionDir = path.join(workspaceRoot, "chapter-1", "r1");
    const artifactPath = path.join(revisionDir, "hyperframes-artifact.json");
    const managedOutputPath = path.join(revisionDir, "hyperframes-overlay.mov");
    await Promise.all([
      fs.writeFile(workerPath, "worker", "utf8"),
      fs.writeFile(browserPath, "browser", "utf8"),
      fs.writeFile(electronExecutable, "electron", "utf8"),
    ]);
    const makeAdapter = (execFileImpl: NonNullable<unknown>) => createHyperFramesAdapter({
      storageBasePath: root,
      electronExecutable,
      workspaceRootForProject: () => workspaceRoot,
      workerPath,
      resolveBrowserPath: async () => browserPath,
      probeRuntime: async (paths) => ({ state: "ready", paths, missing: [], versions: {} }),
      execFile: execFileImpl as never,
    });
    const request = {
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      sourceArtifactSha256: hash,
      inputSha256: hash,
      width: 1920,
      height: 1080,
      fps: 30,
      alphaFormat: "prores-4444-mov" as const,
      outputPath: managedOutputPath,
      windows: [{ slotId: "title", cueId: "cue-1", startUs: 0, durationUs: 1_000_000, templateId: "title-card" as never, parameters: {} }],
    } as unknown as Parameters<ReturnType<typeof createHyperFramesAdapter>["renderOverlay"]>[0];

    const blocked = await makeAdapter(async () => {
      await fs.writeFile(artifactPath, JSON.stringify({
        status: "blocked", code: "render-failed",
        message: "HyperFrames 输出已存在，拒绝覆盖: /x/r1/hyperframes-overlay.mov",
      }), "utf8");
      const error = new Error("Command failed: electron worker") as Error & { code: number; signal: null; killed: false };
      error.code = 2; error.signal = null; error.killed = false;
      throw error;
    }).renderOverlay(request);
    expect(blocked).toMatchObject({ state: "blocked", code: "worker-failed" });
    expect((blocked as { message: string }).message).toContain("render-failed");
    expect((blocked as { message: string }).message).toContain("拒绝覆盖");
    expect((blocked as { message: string }).message).toContain("exit=2");

    const hardDeath = await makeAdapter(async () => {
      const error = new Error("Command failed: electron worker") as Error & { code: number; signal: string; killed: boolean };
      error.code = 1; error.signal = "SIGKILL"; error.killed = true;
      throw error;
    }).renderOverlay(request);
    expect(hardDeath).toMatchObject({ state: "blocked", code: "worker-failed" });
    expect((hardDeath as { message: string }).message).toContain("signal=SIGKILL");
    expect((hardDeath as { message: string }).message).toContain("killed");
  });

  it("does not accept output when the managed revision directory becomes a symlink after worker launch", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-hyperframes-post-swap-"));
    const workerPath = path.join(root, "hyperframes-worker.cjs");
    const browserPath = path.join(root, "chrome-headless-shell");
    const electronExecutable = path.join(root, "electron");
    const workspaceRoot = path.join(root, "workspace");
    const revisionDir = path.join(workspaceRoot, "chapter-1", "r1");
    const externalRoot = path.join(root, "external");
    await Promise.all([
      fs.writeFile(workerPath, "worker", "utf8"),
      fs.writeFile(browserPath, "browser", "utf8"),
      fs.writeFile(electronExecutable, "electron", "utf8"),
      fs.mkdir(externalRoot, { recursive: true }),
    ]);
    const adapter = createHyperFramesAdapter({
      storageBasePath: root,
      electronExecutable,
      workspaceRootForProject: () => workspaceRoot,
      workerPath,
      resolveBrowserPath: async () => browserPath,
      probeRuntime: async (paths) => ({ state: "ready", paths, missing: [], versions: {} }),
      execFile: async (_file, args) => {
        const requestPath = args[args.indexOf("--request") + 1];
        const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
        await fs.rm(revisionDir, { recursive: true, force: true });
        await fs.symlink(externalRoot, revisionDir);
        const outputBytes = Buffer.from("external-overlay");
        await fs.writeFile(request.outputPath, outputBytes);
        await fs.writeFile(path.join(revisionDir, "hyperframes-artifact.json"), JSON.stringify({
          schemaVersion: 1,
          projectId: request.projectId,
          chapterId: request.chapterId,
          revision: request.revision,
          status: "accepted",
          sourceArtifactSha256: request.sourceArtifactSha256,
          inputSha256: request.inputSha256,
          alphaFormat: request.alphaFormat,
          outputPath: request.outputPath,
          outputSha256: createHash("sha256").update(outputBytes).digest("hex"),
          windows: request.windows,
          toolVersion: "hyperframes@0.7.109",
          generatedAt: 123,
        }), "utf8");
        return {};
      },
    });

    await expect(adapter.renderOverlay({
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
      outputPath: path.join(revisionDir, "hyperframes-overlay.mov"),
      windows: [{ slotId: "title", cueId: "cue-1", startUs: 0, durationUs: 1_000_000, templateId: "title-card", parameters: {} }],
    })).resolves.toMatchObject({ state: "blocked", code: "worker-failed" });
  });

  it.each([
    {
      name: "identity drift",
      expectedCode: "artifact-identity-mismatch",
      mutate: (artifact: Record<string, unknown>) => { artifact.projectId = "stale-project"; },
    },
    {
      name: "output SHA drift",
      expectedCode: "artifact-output-invalid",
      mutate: (artifact: Record<string, unknown>) => { artifact.outputSha256 = hash; },
    },
  ])("rejects accepted worker artifact $name", async ({ mutate, expectedCode }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-hyperframes-binding-"));
    const workerPath = path.join(root, "hyperframes-worker.cjs");
    const browserPath = path.join(root, "chrome-headless-shell");
    const electronExecutable = path.join(root, "electron");
    await Promise.all([
      fs.writeFile(workerPath, "worker", "utf8"),
      fs.writeFile(browserPath, "browser", "utf8"),
      fs.writeFile(electronExecutable, "electron", "utf8"),
    ]);
    const adapter = createHyperFramesAdapter({
      storageBasePath: root,
      electronExecutable,
      workspaceRootForProject: (projectId) => path.join(root, "projects", projectId, "video-workflow"),
      workerPath,
      resolveBrowserPath: async () => browserPath,
      probeRuntime: async (paths) => ({ state: "ready", paths, missing: [], versions: {} }),
      execFile: async (_file, args) => {
        const requestPath = args[args.indexOf("--request") + 1];
        const artifactPath = args[args.indexOf("--output") + 1];
        const request = JSON.parse(await fs.readFile(requestPath, "utf8")) as Record<string, unknown>;
        const outputPath = String(request.outputPath);
        const outputBytes = Buffer.from("verified-overlay");
        await fs.writeFile(outputPath, outputBytes);
        const artifact: Record<string, unknown> = {
          schemaVersion: 1,
          projectId: request.projectId,
          chapterId: request.chapterId,
          revision: request.revision,
          status: "accepted",
          sourceArtifactSha256: request.sourceArtifactSha256,
          inputSha256: request.inputSha256,
          alphaFormat: request.alphaFormat,
          outputPath,
          outputSha256: createHash("sha256").update(outputBytes).digest("hex"),
          windows: request.windows,
          toolVersion: "hyperframes@0.7.109",
          generatedAt: 123,
        };
        mutate(artifact);
        await fs.mkdir(path.dirname(artifactPath), { recursive: true });
        await fs.writeFile(artifactPath, JSON.stringify(artifact), "utf8");
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
      outputPath: path.join(root, "projects", "project-1", "video-workflow", "chapter-1", "r1", "hyperframes-overlay.mov"),
      windows: [{ slotId: "title", cueId: "cue-1", startUs: 0, durationUs: 1_000_000, templateId: "title-card", parameters: {} }],
    });

    expect(result).toMatchObject({ state: "blocked", code: expectedCode });
  });
});
