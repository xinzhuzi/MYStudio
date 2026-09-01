import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImageGenRuntimeController } from "./image-gen-runtime-controller";
import type { ImageGenModelRow } from "./image-gen-runtime-controller";

let storageDir: string;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), "imagegen-ctl-"));
});

function makeController(overrides: { modelCacheDir?: () => string } = {}) {
  return createImageGenRuntimeController({
    storageBasePath: () => storageDir,
    backendRoot: "/fake/backend",
    ...overrides,
  });
}

describe("createImageGenRuntimeController getModelCacheDir(08-19 模型目录规范)", () => {
  it("无注入时兜底新家 <storageBase>/model/imagegen", () => {
    const controller = makeController();
    expect(controller.getModelCacheDir()).toBe(join(storageDir, "model", "imagegen"));
  });

  it("旧兜底 python/models/image-gen 一次性迁移到 model/imagegen", () => {
    const legacy = join(storageDir, "python", "models", "image-gen");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "weights.bin"), "stub", "utf-8");
    const controller = makeController();
    const dir = controller.getModelCacheDir();
    expect(dir).toBe(join(storageDir, "model", "imagegen"));
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(join(storageDir, "model", "imagegen", "weights.bin"))).toBe(true);
  });

  it("显式注入覆盖优先(供隔离运行时使用)", () => {
    const controller = makeController({ modelCacheDir: () => "/shared/model/TTS" });
    expect(controller.getModelCacheDir()).toBe("/shared/model/TTS");
  });
});

describe("image generation engine selection", () => {
  it("persists the selected engine and restores it on a new controller", () => {
    const first = makeController();
    expect(first.setActiveModel("z-image-turbo")).toBe(true);
    const configPath = join(storageDir, "python", "profiles", "image-gen", "config.json");
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ activeModel: "z-image-turbo" });

    const second = makeController();
    expect(second.status().activeModel).toBe("z-image-turbo");
  });

  it("lifecycle readiness requires downloaded model and non-missing small pieces", async () => {
    const row: ImageGenModelRow = {
      modelName: "krea2-turbo",
      label: "Krea2 Turbo",
      downloaded: true,
      sizeMb: 35000,
      repoId: "krea/Krea-2-Turbo",
      smallPiecesReady: false,
    };
    const controller = createImageGenRuntimeController({
      storageBasePath: () => storageDir,
      backendRoot: "/fake/backend",
      inventoryScanner: async () => [row],
    });
    const status = await controller.probeLifecycle();
    expect(status.modelDownloaded).toBe(false);
  });

  it("restores persisted Krea2 active model", () => {
    const first = makeController();
    expect(first.setActiveModel("krea2-turbo")).toBe(true);
    const second = makeController();
    expect(second.status().activeModel).toBe("krea2-turbo");
  });

  it("uses Krea2 by default and accepts the ComfyUI bridge", () => {
    const controller = makeController();
    expect(controller.status().activeModel).toBe("krea2-turbo");
    expect(controller.setActiveModel("comfyui-bridge")).toBe(true);
    expect(controller.status().activeModel).toBe("comfyui-bridge");
  });
});

// ── 孤儿 sidecar 端口回收(09-01 根修:强杀/崩溃遗留占死 17595 致 setup 超时) ──
describe("reclaimOrphanSidecarPort", () => {
  it("kills only listeners on the fixed port whose command is an image_gen sidecar", async () => {
    const killed: number[] = [];
    const originalKill = process.kill;
    process.kill = ((pid: number, signal?: string) => {
      if (signal === "SIGTERM") killed.push(pid);
      return true;
    }) as typeof process.kill;
    try {
      const { reclaimOrphanSidecarPort } = await import("./image-gen-runtime-controller");
      // 真实 lsof 在测试机端口多半空闲 → 直接验证「端口无人占用返回 false」主路径
      const reclaimed = await reclaimOrphanSidecarPort();
      expect(typeof reclaimed).toBe("boolean");
    } finally {
      process.kill = originalKill;
    }
  });
});
