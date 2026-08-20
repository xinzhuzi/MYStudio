import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVideoQcRuntimeController } from "./dover-runtime-controller";

let storageDir: string;

function makeController(
  execFileImpl: (file: string, args: string[]) => Promise<{ stdout?: string; stderr?: string }>,
) {
  return createVideoQcRuntimeController({
    storageBasePath: () => storageDir,
    backendRoot: "/fake/backend",
    execFile: async (file, args) => execFileImpl(file, args),
    now: () => 1_700_000_000_000,
  });
}

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), "dover-ctl-"));
});

afterAll(() => {
  // beforeEach 每测新建,统一清最后一个即可;残留 tmp 由系统清理
});

describe("createVideoQcRuntimeController", () => {
  it("probe blocked(model-not-downloaded)映射进状态", async () => {
    const controller = makeController(async (_file, args) => {
      if (args.includes("--probe")) {
        return {
          stdout: JSON.stringify({
            status: "blocked",
            model: { status: "blocked", code: "model-not-downloaded", message: "观感评分模型未下载" },
          }),
        };
      }
      if (args.includes("model_inventory")) {
        return { stdout: JSON.stringify({ models: [], cacheDir: join(storageDir, "VideoQcModel") }) };
      }
      return { stdout: "" };
    });
    const status = await controller.refresh();
    expect(status.modelReady).toBe(false);
    expect(status.modelCode).toBe("model-not-downloaded");
    expect(controller.status().modelCacheDir).toBeTruthy();
  });

  it("probe ready → modelReady 且 download complete", async () => {
    const controller = makeController(async (_file, args) => {
      if (args.includes("--probe")) {
        return {
          stdout: JSON.stringify({ status: "ready", model: { status: "ready" } }),
        };
      }
      if (args.includes("model_inventory")) {
        return {
          stdout: JSON.stringify({
            models: [{ name: "dover-mobile", label: "DOVER", downloaded: true, sizeMb: 40, pinned: false }],
            cacheDir: join(storageDir, "VideoQcModel"),
          }),
        };
      }
      return { stdout: "" };
    });
    const status = await controller.refresh();
    expect(status.modelReady).toBe(true);
    expect(status.downloadStatus).toBe("complete");
  });

  it("setModelCacheDir 持久化 config.json 并校验绝对路径", async () => {
    const controller = makeController(async () => ({ stdout: "" }));
    const bad = await controller.setModelCacheDir("relative/path");
    expect(bad.success).toBe(false);
    const target = join(storageDir, "model", "videoqc");
    const good = await controller.setModelCacheDir(target);
    expect(good.success).toBe(true);
    const config = JSON.parse(readFileSync(join(storageDir, "model", "videoqc", "config.json"), "utf-8"));
    expect(config.modelCacheDir).toBe(target);
  });

  it("旧 VideoQcModel 根一次性迁移到 model/videoqc(基线随迁)", async () => {
    const legacy = join(storageDir, "VideoQcModel");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "baselines.json"), "{}", "utf-8");
    const controller = makeController(async () => ({ stdout: "" }));
    controller.recordBaseline("default", 0.7); // 首次根解析触发一次性迁移(同卷 rename)
    const home = join(storageDir, "model", "videoqc");
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(join(home, "baselines.json"))).toBe(true);
    expect(controller.getModelCacheDir()).toBe(home);
  });

  it("readDownloadProgress 读进度 JSON", async () => {
    const controller = makeController(async () => ({ stdout: "" }));
    const profileDir = join(storageDir, "python", "profiles", "video-qc");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "download-progress.json"),
      JSON.stringify({ status: "downloading", progress: 42, current: 100, total: 240 }),
      "utf-8",
    );
    expect(controller.readDownloadProgress()).toMatchObject({ status: "downloading", progress: 42 });
  });

  it("runVideoQcScore:blocked artifact 映射;accepted 分数校验", async () => {
    const controller = makeController(async (_file, args) => {
      if (args.includes("--run")) {
        const outputIndex = args.indexOf("--output");
        const outputPath = args[outputIndex + 1];
        mkdirSync(join(outputPath, ".."), { recursive: true });
        writeFileSync(
          outputPath,
          JSON.stringify({
            status: "accepted",
            overall: { fused: 0.72, aesthetic: 0.75, technical: 0.68 },
            slices: [{ shotId: "s1", fused: 0.4 }],
            elapsedMs: 1400,
          }),
          "utf-8",
        );
        return { stdout: "" };
      }
      return { stdout: "" };
    });
    const accepted = await controller.runVideoQcScore({
      projectId: "p", chapterId: "c", videoPath: "/tmp/v.mp4", mode: "whole",
    });
    expect(accepted.status).toBe("accepted");
    if (accepted.status === "accepted") {
      expect(accepted.overall.fused).toBeCloseTo(0.72, 3);
      expect(accepted.slices?.[0]).toEqual({ shotId: "s1", fused: 0.4 });
    }

    const blockedController = makeController(async () => ({ stdout: "" }));
    const blocked = await blockedController.runVideoQcScore({
      projectId: "p", chapterId: "c", videoPath: "/tmp/v.mp4", mode: "whole",
    });
    expect(blocked.status).toBe("blocked");
    if (blocked.status === "blocked") {
      expect(blocked.code).toBe("worker-failed");
    }
  });

  it("baselines:在线更新均值/方差", async () => {
    const controller = makeController(async () => ({ stdout: "" }));
    mkdirSync(join(storageDir, "model", "videoqc"), { recursive: true });
    controller.recordBaseline("default", 0.7);
    controller.recordBaseline("default", 0.8);
    controller.recordBaseline("default", 0.9);
    const baselines = controller.readBaselines();
    expect(baselines.default.sampleCount).toBe(3);
    expect(baselines.default.meanFused).toBeCloseTo(0.8, 5);
    expect(baselines.default.sigma).toBeGreaterThan(0.05);
    expect(existsSync(join(storageDir, "model", "videoqc", "baselines.json"))).toBe(true);
  });
});
