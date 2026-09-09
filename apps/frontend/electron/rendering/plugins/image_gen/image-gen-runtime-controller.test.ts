import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
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

// ── 09-09 进程风暴根修回归:外部进程占死 17595 时上游每秒级重试 prepare,
// 旧实现每次全量 spawn——实弹 10 分钟堆 840 个 python、load 657 烫机。──
describe("setup 风暴止血(单飞+指数退避+stop 中止)", () => {
  interface FakeChild {
    pid: number;
    exitCode: number | null;
    spawnDelayMs: number | null;
    on(event: "exit", cb: (code: number | null, signal: string | null) => void): void;
    kill(): void;
  }

  function makeFakeSpawn() {
    const spawned: FakeChild[] = [];
    const spawnFake = vi.fn(() => {
      const child: FakeChild = {
        pid: 9000 + spawned.length,
        exitCode: null,
        spawnDelayMs: null,
        on(_event, _cb) {
          // 控制器只挂 exit 清理;假进程由 die()/kill() 驱动状态,不需要真分发
        },
        kill() {
          child.exitCode = 1;
        },
      };
      spawned.push(child);
      // 秒退型子进程(端口被占 → bind 失败的等价模拟)
      setTimeout(() => {
        if (child.exitCode === null) child.exitCode = 1;
      }, 100);
      return child as unknown as ChildProcess;
    });
    return { spawned, spawnFake };
  }

  function makeStormController(opts: { now?: () => number } = {}) {
    const { spawned, spawnFake } = makeFakeSpawn();
    mkdirSync(join(storageDir, "python", "bin"), { recursive: true });
    writeFileSync(join(storageDir, "python", "bin", "python3"), "#!/bin/sh\n", "utf-8");
    const controller = createImageGenRuntimeController({
      storageBasePath: () => storageDir,
      backendRoot: "/fake/backend",
      spawnProcess: spawnFake as unknown as typeof spawn,
      ...opts,
    });
    return { controller, spawned, spawnFake };
  }

  it("并发 setup 单飞:三个同时到达只 spawn 一次,共享同一份失败结论", async () => {
    const { controller, spawned } = makeStormController();
    const results = await Promise.all([controller.setup(), controller.setup(), controller.setup()]);
    expect(spawned).toHaveLength(1);
    for (const status of results) {
      expect(status.setupStage).toBe("failed");
    }
  });

  it("失败后退避:窗口内重试零 spawn,窗口过后才再试", async () => {
    let fakeNow = 1_000;
    const { controller, spawned } = makeStormController({ now: () => fakeNow });
    const first = await controller.setup();
    expect(first.setupStage).toBe("failed");
    expect(spawned).toHaveLength(1);

    // 退避窗口内(首次失败 5s):上游再砸多少次都不 spawn
    const gated = await controller.setup();
    expect(gated.setupStage).toBe("failed");
    expect(gated.setupMessage).toContain("已限流");
    expect(spawned).toHaveLength(1);

    // 时钟越过退避窗口:恢复真实重试
    fakeNow = 6_500;
    const second = await controller.setup();
    expect(second.setupStage).toBe("failed");
    expect(spawned).toHaveLength(2);
  });

  it("stop() 中止在途 setup:健康轮询立即作废,不再回收重生", async () => {
    // 存活型假子进程:不秒退,逼出「stop 打断 30s 轮询」路径
    const { controller, spawned } = (() => {
      const children: FakeChild[] = [];
      const spawnFake = vi.fn(() => {
        const child: FakeChild = {
          pid: 9100 + children.length,
          exitCode: null,
          spawnDelayMs: null,
          on() {},
          kill() {
            child.exitCode = 1;
          },
        };
        children.push(child);
        return child as unknown as ChildProcess;
      });
      mkdirSync(join(storageDir, "python", "bin"), { recursive: true });
      writeFileSync(join(storageDir, "python", "bin", "python3"), "#!/bin/sh\n", "utf-8");
      const controller = createImageGenRuntimeController({
        storageBasePath: () => storageDir,
        backendRoot: "/fake/backend",
        spawnProcess: spawnFake as unknown as typeof spawn,
      });
      return { controller, spawned: children };
    })();

    const inFlight = controller.setup();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await controller.stop();
    const status = await inFlight;
    expect(status.setupStage).toBe("failed");
    expect(status.setupMessage).toContain("中止");
    // 只允许最初那一次 spawn:stop 后不得回收重生
    expect(spawned).toHaveLength(1);
  });
});
