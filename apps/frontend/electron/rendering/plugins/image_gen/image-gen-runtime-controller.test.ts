import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImageGenRuntimeController } from "./image-gen-runtime-controller";

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
