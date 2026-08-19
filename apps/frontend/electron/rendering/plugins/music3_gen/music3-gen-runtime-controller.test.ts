// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMusic3GenRuntimeController } from "./music3-gen-runtime-controller";

let storageRoot: string;
let backendRoot: string;

beforeEach(() => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "music3-controller-"));
  backendRoot = fs.mkdtempSync(path.join(os.tmpdir(), "music3-backend-"));
  // 共享 Python 在场(setup/download 的 existsSync 门禁)
  fs.mkdirSync(path.join(storageRoot, "python", "bin"), { recursive: true });
  fs.writeFileSync(path.join(storageRoot, "python", "bin", "python3"), "#!/bin/sh\n", "utf8");
});

afterEach(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
  fs.rmSync(backendRoot, { recursive: true, force: true });
});

type ExecFile = Parameters<typeof createMusic3GenRuntimeController>[0]["execFileFn"];

function probePayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    status: "blocked",
    model: "minimax-music3-mlx",
    depsOk: true,
    sizeMb: null,
    hardware: { platform: "darwin", machine: "arm64", mlxImportable: true },
    availability: { available: true, reason: "" },
    ...overrides,
  });
}

function makeController(execFile: ExecFile) {
  return createMusic3GenRuntimeController({
    storageBasePath: storageRoot,
    backendRoot,
    execFileFn: execFile,
  });
}

describe("music3 hardware gating (平台×模型选择)", () => {
  it("支持的宿主:availability=ok + hardwareProfile 透出", async () => {
    const controller = makeController(async () => ({ stdout: probePayload() }));
    const models = await controller.scanModelInventory();
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      modelName: "minimax-music3-mlx",
      availability: "ok",
      downloaded: false,
    });
    const status = controller.status();
    expect(status.hardwareProfile).toEqual({
      platform: "darwin",
      machine: "arm64",
      mlxImportable: true,
    });
  });

  it("不支持的宿主(x86_64):availability=unsupported + reason 透出 + 下载即时拒绝", async () => {
    const controller = makeController(async () => ({
      stdout: probePayload({
        hardware: { platform: "darwin", machine: "x86_64", mlxImportable: true },
        availability: { available: false, reason: "本条目为 Apple Silicon(MLX)移植版,需要 macOS + arm64;当前宿主 darwin/x86_64。" },
      }),
    }));
    const models = await controller.scanModelInventory();
    expect(models[0]).toMatchObject({
      availability: "unsupported",
      downloaded: false,
    });
    expect(models[0]?.unsupportedReason).toContain("arm64");

    const result = await controller.downloadModel("minimax-music3-mlx");
    expect(result.accepted).toBe(false);
    expect(result.message).toContain("arm64");
  });

  it("下载门禁兜底:probe 未跑过(state.models 空)时仍可下发(后端二道门禁兜住)", async () => {
    const spawns: string[][] = [];
    const controller = createMusic3GenRuntimeController({
      storageBasePath: storageRoot,
      backendRoot,
      execFileFn: async () => ({ stdout: probePayload() }),
      spawnProcess: ((_file, args) => {
        spawns.push(args as string[]);
        return { on: (_event: string, _cb: () => void) => ({}) } as unknown as ReturnType<
          typeof import("node:child_process").spawn
        >;
      }) as unknown as Parameters<typeof createMusic3GenRuntimeController>[0]["spawnProcess"],
    });
    const result = await controller.downloadModel("minimax-music3-mlx");
    expect(result.accepted).toBe(true);
    expect(spawns).toHaveLength(1);
  });

  it("生成被平台门禁挡下:worker 非零退出时从 stdout 恢复 blocked code=platform-unsupported", async () => {
    const error = new Error("Command failed") as Error & { stdout?: string };
    error.stdout = JSON.stringify({
      status: "blocked",
      code: "platform-unsupported",
      message: "本条目为 Apple Silicon(MLX)移植版,需要 macOS + arm64;当前宿主 linux/x86_64。",
    });
    const controller = makeController(async () => {
      throw error;
    });
    const result = await controller.generateMusic3({ prompt: "测试", seed: 7, seconds: 60, outputDir: "/tmp" });
    expect(result.status).toBe("blocked");
    expect(result.code).toBe("platform-unsupported");
    expect(result.message).toContain("arm64");
  });

  it("生成失败仍走旧口径:model-not-downloaded 嗅探不回归", async () => {
    const error = new Error("Command failed: 音乐模型 MiniMax-Music3(MLX 整曲引擎) 未下载。请前往 设置 → 本地配置 → 本地音乐生成 下载。") as Error & { stdout?: string };
    error.stdout = "";
    const controller = makeController(async () => {
      throw error;
    });
    const result = await controller.generateMusic3({ prompt: "测试", seed: 7, seconds: 60, outputDir: "/tmp" });
    expect(result.status).toBe("blocked");
    expect(result.code).toBe("model-not-downloaded");
  });
});
