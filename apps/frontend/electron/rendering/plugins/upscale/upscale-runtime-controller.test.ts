// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUpscaleRuntimeController } from "./upscale-runtime-controller";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "upscale-controller-"));
}

let storageRoot: string;
let backendRoot: string;
let projectRoot: string;

beforeEach(() => {
  storageRoot = tempDir();
  backendRoot = tempDir();
  projectRoot = tempDir();
});

afterEach(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
  fs.rmSync(backendRoot, { recursive: true, force: true });
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function makeController(options: {
  execFile?: Parameters<typeof createUpscaleRuntimeController>[0]["execFile"];
  resolveProjectFilePath?: (projectId: string, relativePath: string) => string | null;
  resolveLocalMediaPath?: (url: string) => string | null;
} = {}) {
  return createUpscaleRuntimeController({
    storageBasePath: storageRoot,
    backendRoot,
    ...(options.resolveLocalMediaPath ? { resolveLocalMediaPath: options.resolveLocalMediaPath } : {}),
    resolveProjectFilePath: options.resolveProjectFilePath ?? ((_projectId: string, relativePath: string) => {
      try {
        const resolved = path.resolve(projectRoot, relativePath);
        if (!resolved.startsWith(projectRoot + path.sep)) return null;
        return resolved;
      } catch {
        return null;
      }
    }),
    ...(options.execFile ? { execFile: options.execFile } : {}),
  });
}

function writeMarker() {
  const profileDir = path.join(storageRoot, "python", "profiles", "upscale");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "profile.json"), "{}", "utf8");
  return profileDir;
}

const VALID_REQUEST = {
  schemaVersion: 1,
  projectId: "p1",
  model: "realesrgan-x4plus-anime-6b",
  inputImagePath: "workflow-images/wf1/gen.png",
  outputImagePath: "workflow-images/wf1/up4x-gen.png",
};

function makeArtifact(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectId: "p1",
    shotId: "unknown",
    status: "accepted",
    model: "realesrgan-x4plus-anime-6b",
    method: "super_res",
    scale: 4,
    inputSha256: "a".repeat(64),
    outputSha256: "b".repeat(64),
    outputPath: path.join(projectRoot, "workflow-images/wf1/up4x-gen.png"),
    width: 4096,
    height: 6144,
    toolVersion: "upscale@0.1.0",
    generatedAt: 1,
  };
}

describe("upscale runtime controller", () => {
  it("runUpscale fails closed without a project path resolver", async () => {
    writeMarker();
    const controller = createUpscaleRuntimeController({ storageBasePath: storageRoot, backendRoot });
    const result = await controller.runUpscale(VALID_REQUEST);
    expect(result.artifact).toMatchObject({ status: "blocked", code: "path-resolution-unavailable" });
  });

  it("runUpscale rejects invalid requests and cross-directory outputs", async () => {
    writeMarker();
    const controller = makeController();
    const invalid = await controller.runUpscale({ ...VALID_REQUEST, inputImagePath: "/abs.png" });
    expect(invalid.artifact.code).toBe("invalid-request");
    const escaped = await controller.runUpscale({
      ...VALID_REQUEST,
      outputImagePath: "workflow-images/other-dir/up4x-gen.png",
    });
    expect(escaped.artifact.code).toBe("output-outside-input-dir");
    const traversal = await controller.runUpscale({
      ...VALID_REQUEST,
      outputImagePath: "../up4x-gen.png",
    });
    expect(traversal.artifact.code).toBe("invalid-request");
  });

  it("runUpscale rejects when the runtime marker is missing", async () => {
    const controller = makeController();
    const result = await controller.runUpscale(VALID_REQUEST);
    expect(result.artifact).toMatchObject({ status: "blocked", code: "runtime-not-ready" });
  });

  it("runUpscale resolves relative paths, runs the worker, and returns the artifact", async () => {
    const profileDir = writeMarker();
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const inputIndex = args.indexOf("--input");
      const outputIndex = args.indexOf("--output");
      const request = JSON.parse(fs.readFileSync(args[inputIndex + 1], "utf8")) as Record<string, string>;
      expect(request.inputImagePath).toBe(path.join(projectRoot, "workflow-images/wf1/gen.png"));
      expect(request.outputImagePath).toBe(path.join(projectRoot, "workflow-images/wf1/up4x-gen.png"));
      fs.writeFileSync(
        args[outputIndex + 1],
        JSON.stringify(makeArtifact()),
        "utf8",
      );
      return { stdout: "", stderr: "" };
    });
    const controller = makeController({ execFile });
    const result = await controller.runUpscale(VALID_REQUEST);
    expect(result.artifact).toMatchObject({ status: "accepted", scale: 4, method: "super_res" });
    expect(execFile).toHaveBeenCalledOnce();
    // The per-run workspace under the profile dir must be cleaned up.
    const runsDir = path.join(profileDir, "runs");
    expect(fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : []).toHaveLength(0);
  });

  it("runUpscale surfaces the persisted blocked artifact when the worker exits non-zero", async () => {
    writeMarker();
    const blockedArtifact = {
      ...makeArtifact(),
      status: "blocked",
      method: "",
      scale: 0,
      outputPath: "",
      width: 0,
      height: 0,
      code: "model-not-downloaded",
      message: "超分模型未下载",
    };
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const outputIndex = args.indexOf("--output");
      fs.writeFileSync(args[outputIndex + 1], JSON.stringify(blockedArtifact), "utf8");
      throw new Error("worker exited with code 2");
    });
    const controller = makeController({ execFile });
    const result = await controller.runUpscale(VALID_REQUEST);
    expect(result.artifact).toMatchObject({ status: "blocked", code: "model-not-downloaded" });
  });

  it("runUpscale synthesizes a worker-failed artifact when nothing is persisted", async () => {
    writeMarker();
    const execFile = vi.fn(async () => {
      throw new Error("spawn ENOENT");
    });
    const controller = makeController({ execFile });
    const result = await controller.runUpscale(VALID_REQUEST);
    expect(result.artifact).toMatchObject({ status: "blocked", code: "worker-failed" });
  });

  it("setActiveModel validates against the catalog and persists the choice", async () => {
    writeMarker();
    const controller = makeController();
    expect(controller.setActiveModel("waifu2x").success).toBe(false);
    expect(controller.setActiveModel("realesrgan-x4plus").success).toBe(true);
    expect(controller.status().activeModel).toBe("realesrgan-x4plus");
    const configPath = path.join(storageRoot, "UpscaleModel", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { activeModel?: string };
    expect(config.activeModel).toBe("realesrgan-x4plus");
  });

  it("scanModelInventory parses rows and marks the active model downloaded", async () => {
    writeMarker();
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("upscale.model_inventory")) {
        return {
          stdout: JSON.stringify({
            models: [
              {
                modelName: "realesrgan-x4plus-anime-6b",
                label: "动漫插画 6B(默认)",
                downloaded: true,
                sizeMb: 18,
                file: "RealESRGAN_x4plus_anime_6B.pth",
                scale: 4,
                cacheDir: path.join(storageRoot, "UpscaleModel/RealESRGAN_x4plus_anime_6B.pth"),
              },
            ],
            cacheDir: path.join(storageRoot, "UpscaleModel"),
          }),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });
    const controller = makeController({ execFile });
    const inventory = await controller.scanModelInventory();
    expect(inventory.models).toHaveLength(1);
    expect(controller.status().modelDownloaded).toBe(true);
    expect(controller.status().modelCacheDir).toBe(path.join(storageRoot, "UpscaleModel"));
  });

  it("serializes concurrent runs so only one worker executes at a time", async () => {
    writeMarker();
    const events: string[] = [];
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const outputIndex = args.indexOf("--output");
      events.push(`start:${args[outputIndex - 1] === "--input" ? outputIndex : outputIndex}`);
      events.push(`worker-start-${events.length}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(args[outputIndex + 1], JSON.stringify(makeArtifact()), "utf8");
      return { stdout: "", stderr: "" };
    });
    const controller = makeController({ execFile });
    const first = controller.runUpscale(VALID_REQUEST);
    const second = controller.runUpscale({
      ...VALID_REQUEST,
      outputImagePath: "workflow-images/wf1/up4x-other.png",
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a.artifact.status).toBe("accepted");
    expect(b.artifact.status).toBe("accepted");
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it("resolves local-image:// references through the media-root resolver", async () => {
    writeMarker();
    const mediaRoot = path.join(storageRoot, "media");
    const categoryDir = path.join(mediaRoot, "workflow");
    fs.mkdirSync(categoryDir, { recursive: true });
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const inputIndex = args.indexOf("--input");
      const request = JSON.parse(fs.readFileSync(args[inputIndex + 1], "utf8")) as Record<string, string>;
      expect(request.inputImagePath).toBe(path.join(categoryDir, "gen-image.png"));
      expect(request.outputImagePath).toBe(path.join(categoryDir, "up4x-gen-image.png"));
      const outputIndex = args.indexOf("--output");
      fs.writeFileSync(args[outputIndex + 1], JSON.stringify(makeArtifact()), "utf8");
      return { stdout: "", stderr: "" };
    });
    const controller = makeController({
      execFile,
      resolveLocalMediaPath: (url) => {
        const match = url.match(/^local-image:\/\/([^/]+)\/(.+)$/);
        return match ? path.join(mediaRoot, match[1], match[2]) : null;
      },
    });
    const result = await controller.runUpscale({
      schemaVersion: 1,
      projectId: "p1",
      model: "realesrgan-x4plus-anime-6b",
      inputImagePath: "local-image://workflow/gen-image.png",
      outputImagePath: "local-image://workflow/up4x-gen-image.png",
    });
    expect(result.artifact.status).toBe("accepted");
  });
});

