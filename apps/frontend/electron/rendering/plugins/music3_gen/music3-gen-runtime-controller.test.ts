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

describe("mlx-serve 指向路线(08-19-music3-mlxserv-connector)", () => {
  function makeWeightsDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mlxserv-weights-"));
    for (const name of [
      "language_model.safetensors",
      "rvq_depth_decoder.safetensors",
      "transformer.safetensors",
      "condition_encoder.safetensors",
      "vocoder.safetensors",
    ]) {
      fs.writeFileSync(path.join(dir, name), "x");
    }
    fs.mkdirSync(path.join(dir, "tokenizer"));
    fs.mkdirSync(path.join(dir, "music_tokenizer"));
    return dir;
  }

  function makeWavBytes(): Uint8Array {
    const buffer = new ArrayBuffer(44 + 8);
    const view = new DataView(buffer);
    const ascii = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + 8, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, 44100, true);
    view.setUint32(28, 44100 * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, 8, true);
    return new Uint8Array(buffer);
  }

  function okResponse(body: Uint8Array) {
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      text: async () => "",
    } as unknown as Response;
  }

  it("指向权重目录:完整性绿 + 状态透出", async () => {
    const weightsDir = makeWeightsDir();
    const controller = makeController(async () => ({ stdout: probePayload() }));
    controller.configureMlxServ({ weightsDir, binaryPath: "/nonexistent/mlx-serve" });
    const status = controller.status();
    expect(status.mlxServ?.weightsReady).toBe(true);
    expect(status.mlxServ?.binaryFound).toBe(false);
    fs.rmSync(weightsDir, { recursive: true, force: true });
  });

  it("目录不完整:明确原因,生成被拒", async () => {
    const partial = fs.mkdtempSync(path.join(os.tmpdir(), "mlxserv-partial-"));
    const controller = makeController(async () => ({ stdout: probePayload() }));
    controller.configureMlxServ({ weightsDir: partial, binaryPath: "/nonexistent/mlx-serve" });
    const result = await controller.generateMusic3({ prompt: "测试", seed: 7, seconds: 60, engine: "mlxserv", outputDir: "/tmp" });
    // 权重不就绪 → 回退 pocket 路线(探测桩 blocked)
    expect(result.status).toBe("blocked");
    expect(result.message).toContain("mlx-serve 权重未就绪");
    fs.rmSync(partial, { recursive: true, force: true });
  });

  it("生成成功:HTTP → WAV 落盘 + 元数据 + engine=mlx-serve", async () => {
    const weightsDir = makeWeightsDir();
    const fakeBinary = path.join(storageRoot, "fake-mlx-serve");
    fs.writeFileSync(fakeBinary, "#!/bin/sh\n");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlxserv-out-"));
    const wav = makeWavBytes();
    const fetchCalls: string[] = [];
    const controller = createMusic3GenRuntimeController({
      storageBasePath: storageRoot,
      backendRoot,
      execFileFn: async () => ({ stdout: probePayload() }),
      fetchFn: (async (url: unknown) => {
        const target = String(url);
        fetchCalls.push(target);
        if (target.endsWith("/v1/models")) return okResponse(new Uint8Array([0]));
        return okResponse(wav);
      }) as unknown as typeof fetch,
    });
    controller.configureMlxServ({ weightsDir, binaryPath: fakeBinary });
    const result = await controller.generateMusic3({ prompt: "仙侠紧张配乐", seed: 42, seconds: 60, engine: "mlxserv", outputDir: outDir });
    expect(result.status).toBe("accepted");
    expect(result.engine).toBe("mlx-serve");
    expect(result.samplingRate).toBe(44100);
    expect(result.outputSha256).toHaveLength(64);
    expect(fetchCalls.some((url) => url.endsWith("/v1/audio/music-generations"))).toBe(true);
    const written = fs.readFileSync((result as { outputPath: string }).outputPath);
    expect(written.byteLength).toBe(52);
    fs.rmSync(weightsDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("binary 缺失:blocked code=mlxserv-binary-missing + 安装指引", async () => {
    const weightsDir = makeWeightsDir();
    const controller = createMusic3GenRuntimeController({
      storageBasePath: storageRoot,
      backendRoot,
      execFileFn: async () => ({ stdout: probePayload() }),
      binaryCandidates: ["/nonexistent/a", "/nonexistent/b"],
    });
    controller.configureMlxServ({ weightsDir });
    const result = await controller.generateMusic3({ prompt: "测试", seed: 7, seconds: 60, engine: "mlxserv", outputDir: "/tmp" });
    expect(result.status).toBe("blocked");
    expect(result.code).toBe("mlxserv-binary-missing");
    expect(result.message).toContain("brew install mlx-serve");
    fs.rmSync(weightsDir, { recursive: true, force: true });
  });

  it("健康等待超时:blocked code=mlxserv-start-timeout(短预算注入)", async () => {
    const weightsDir = makeWeightsDir();
    const fakeBinary = path.join(storageRoot, "fake-mlx-serve-2");
    fs.writeFileSync(fakeBinary, "#!/bin/sh\n");
    const controller = createMusic3GenRuntimeController({
      storageBasePath: storageRoot,
      backendRoot,
      execFileFn: async () => ({ stdout: probePayload() }),
      healthTimeoutMs: 120,
      fetchFn: (async () => {
        throw new Error("connection refused");
      }) as unknown as typeof fetch,
      spawnProcess: ((_file, _args) => ({ on: () => ({}) })) as unknown as Parameters<typeof createMusic3GenRuntimeController>[0]["spawnProcess"],
    });
    controller.configureMlxServ({ weightsDir, binaryPath: fakeBinary });
    const result = await controller.generateMusic3({ prompt: "测试", seed: 7, seconds: 60, engine: "mlxserv", outputDir: "/tmp" });
    expect(result.status).toBe("blocked");
    expect(result.code).toBe("mlxserv-start-failed");
    fs.rmSync(weightsDir, { recursive: true, force: true });
  });
});

describe("mlxserv bf16 权重获取(installMlxServWeights)", () => {
  function progressFileOf(): string {
    return path.join(storageRoot, "python", "profiles", "music3-gen", "mlxserv-weights-progress.json");
  }

  function writeProgress(payload: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(progressFileOf()), { recursive: true });
    fs.writeFileSync(progressFileOf(), JSON.stringify(payload), "utf8");
  }

  function makeSpawnCapture() {
    const spawns: Array<{ file: string; args: string[] }> = [];
    const exitCallbacks: Array<() => void> = [];
    const spawnProcess = ((file: string, args: string[]) => {
      spawns.push({ file, args });
      return {
        on: (_event: string, callback: () => void) => {
          exitCallbacks.push(callback);
          return {};
        },
      };
    }) as unknown as Parameters<typeof createMusic3GenRuntimeController>[0]["spawnProcess"];
    return { spawns, exitCallbacks, spawnProcess };
  }

  function makeWeightsDirLocal(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mlxserv-weights-install-"));
    for (const name of [
      "language_model.safetensors",
      "rvq_depth_decoder.safetensors",
      "transformer.safetensors",
      "condition_encoder.safetensors",
      "vocoder.safetensors",
    ]) {
      fs.writeFileSync(path.join(dir, name), "x");
    }
    fs.mkdirSync(path.join(dir, "tokenizer"));
    fs.mkdirSync(path.join(dir, "music_tokenizer"));
    return dir;
  }

  function makeControllerWith(overrides: Partial<Parameters<typeof createMusic3GenRuntimeController>[0]> = {}) {
    const capture = makeSpawnCapture();
    const controller = createMusic3GenRuntimeController({
      storageBasePath: storageRoot,
      backendRoot,
      execFileFn: async () => ({ stdout: probePayload() }),
      spawnProcess: capture.spawnProcess,
      ...overrides,
    });
    return { controller, capture };
  }

  it("进行中拒绝重启 + status 透出安装状态", async () => {
    const { controller, capture } = makeControllerWith();
    writeProgress({ status: "downloading", stage: "download", progress: 42, updatedAt: Date.now() });
    const result = await controller.installMlxServWeights();
    expect(result.accepted).toBe(false);
    expect(result.message).toContain("进行中");
    expect(capture.spawns).toHaveLength(0);
    const status = controller.status();
    expect(status.mlxServWeightsInstall).toMatchObject({ status: "downloading", progress: 42 });
  });

  it("陈旧进度(心跳超时)视为中断:可重新发起且 status 报 error", async () => {
    const { controller, capture } = makeControllerWith();
    writeProgress({ status: "downloading", progress: 30, updatedAt: Date.now() - 10 * 60_000 });
    expect(controller.status().mlxServWeightsInstall?.status).toBe("error");
    expect(controller.status().mlxServWeightsInstall?.error).toContain("中断");
    const result = await controller.installMlxServWeights();
    expect(result.accepted).toBe(true);
    expect(capture.spawns).toHaveLength(1);
  });

  it("内存门禁:16GB/32GB 机器拒(bf16 需 48GB+);128GB 放行", async () => {
    const small = makeControllerWith({ totalMemBytes: () => 16 * 1024 ** 3 });
    const smallResult = await small.controller.installMlxServWeights();
    expect(smallResult.accepted).toBe(false);
    expect(smallResult.message).toContain("内存");
    expect(small.capture.spawns).toHaveLength(0);

    const mid = makeControllerWith({ totalMemBytes: () => 32 * 1024 ** 3 });
    expect((await mid.controller.installMlxServWeights()).accepted).toBe(false);
    expect(mid.capture.spawns).toHaveLength(0);

    const big = makeControllerWith({ totalMemBytes: () => 128 * 1024 ** 3 });
    const bigResult = await big.controller.installMlxServWeights();
    expect(bigResult.accepted).toBe(true);
    expect(big.capture.spawns).toHaveLength(1);
    expect(big.controller.status().hostTotalRamGb).toBe(128);
  });

  it("目标产物已完整:直接指向,不重复下载", async () => {
    const { controller } = makeControllerWith();
    const packDir = makeWeightsDirLocal();
    const target = path.join(storageRoot, "model", "minimax", "music3-mlxserv-bf16");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(packDir, target);
    const shortCircuit = await controller.installMlxServWeights();
    expect(shortCircuit.accepted).toBe(true);
    expect(shortCircuit.message).toContain("已就绪");
    expect(controller.status().mlxServ?.config.weightsDir).toBe(target);
  });

  it("正常发起:spawn 参数正确(staging 落 model/minimax/);完成后自动填 weightsDir", async () => {
    const { controller, capture } = makeControllerWith();
    const result = await controller.installMlxServWeights();
    expect(result.accepted).toBe(true);
    expect(capture.spawns).toHaveLength(1);
    expect(capture.spawns[0]?.args).toContain("music3_gen.install_mlxserv_weights");
    const staging = path.join(storageRoot, "model", "minimax", ".staging-music3-full");
    expect(fs.existsSync(staging)).toBe(true);
    const pack = path.join(storageRoot, "model", "minimax", "music3-mlxserv-bf16");
    // 模拟后端收尾:写 complete 进度 + 子进程退出
    writeProgress({ status: "complete", stage: "done", progress: 100, outputDir: pack, updatedAt: Date.now() });
    capture.exitCallbacks[0]?.();
    const config = JSON.parse(fs.readFileSync(path.join(storageRoot, "music3-mlxserv-config.json"), "utf8"));
    expect(config.weightsDir).toBe(pack);
    expect(controller.status().mlxServWeightsInstall?.status).toBe("complete");
  });

  it("子进程失败(error)后不动配置", async () => {
    const { controller, capture } = makeControllerWith();
    await controller.installMlxServWeights();
    writeProgress({ status: "error", stage: "download", error: "网络中断", updatedAt: Date.now() });
    capture.exitCallbacks[0]?.();
    expect(controller.status().mlxServ?.config.weightsDir).toBe("");
    expect(controller.status().mlxServWeightsInstall).toMatchObject({ status: "error", error: "网络中断" });
  });
});
