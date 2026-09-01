// @vitest-environment node
/**
 * main 装配模块冒烟(08-31-electron-main-assembly-split 验收4):
 * 拆出的装配模块可被单测直接 import——main-env 零依赖直测;
 * main-native-bridge 以 vi.mock 屏蔽 electron/路径副作用后直测,
 * 钉死 bind 门语义:未装配即调用必须显式报错,装配后链路可跑通。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./main-paths", () => ({
  getDataDir: () => "/tmp/mystudio-smoke-data",
  projectRootFor: (projectId: string) => `/tmp/mystudio-smoke-data/_p/${projectId}`,
  resolveStudioSourcePath: (sourcePath: string) => sourcePath,
}));
vi.mock("./main-hosted-studio", () => ({
  getHostedStudioChapterContext: () => undefined,
}));
vi.mock("./main-chapter-projection", () => ({
  evaluateVideoWorkflowChapterGate: async () => ({ accepted: true }),
}));
vi.mock("../storage/studio-workflow-store-io", () => ({
  readStudioWorkflowStore: () => null,
}));
vi.mock("../storage/storage-paths", () => ({
  parseProjectFileUrl: () => null,
  resolveProjectScopedFilePath: () => "",
}));
vi.mock("@rendering/plugins/remotion/studio", () => ({
  RemotionStudioRenderQueueBridge: class {
    // biome-ignore lint: 测试替身按选项透传
    constructor(public readonly options: Record<string, unknown>) {}
  },
  createReadyRemotionChapterJob: async () => ({ inputHash: "smoke-hash" }),
}));

import { MAIN_DIST, RENDERER_DIST, RENDERER_INDEX_HTML, isBackgroundSmoke } from "./main-env";
import { bindNativeBridgeRuntime, buildManagedVideoUseChapterRun, nativeStudioQueueBridge } from "./main-native-bridge";

describe("main-env 常量族(零依赖直测)", () => {
  it("构建输出目录与入口形态就位", () => {
    expect(MAIN_DIST).toEqual(expect.any(String));
    expect(RENDERER_DIST).toEqual(expect.any(String));
    expect(RENDERER_INDEX_HTML).toContain("index.html");
    expect(typeof isBackgroundSmoke).toBe("boolean");
  });
});

describe("main-native-bridge 装配冒烟(bind 门语义)", () => {
  it("未装配时经桥取任务会显式报错(防静默错装配)", () => {
    const bridge = nativeStudioQueueBridge as unknown as {
      options: { getJob: (id: string) => unknown };
    };
    expect(() => bridge.options.getJob("job-1")).toThrow(/bindNativeBridgeRuntime 未被调用/);
  });

  it("装配后 buildManagedVideoUseChapterRun 产出 video-use 章运行结构", () => {
    bindNativeBridgeRuntime({
      remotionVersion: "4.0.0-smoke",
      remotionBundlePath: "/tmp/mystudio-smoke-bundle",
      remotionRuntime: { controller: { probeStatus: async () => ({ status: { state: "ready" } }) } },
      remotionChapterManifestService: { read: async () => ({}) },
      remotionQueue: {
        enqueueChapter: async () => ({ accepted: true, job: { jobId: "smoke-job" } }),
        getJob: () => null,
        cancelJob: () => null,
      },
      videoUseAdapter: {
        paths: {
          pythonExecutable: "/tmp/python3",
          ffmpegExecutable: "/tmp/ffmpeg",
          ffprobeExecutable: "/tmp/ffprobe",
          videoUseLockPath: "/tmp/nonexistent-lock",
          videoUseMarkerPath: "/tmp/marker",
        },
      },
    } as Parameters<typeof bindNativeBridgeRuntime>[0]);

    const run = buildManagedVideoUseChapterRun({
      projectId: "p1",
      chapterId: "c1",
      revision: 3,
      mode: "clean-mp4",
      shots: [{ shotId: "s1", videoPath: "/tmp/v.mp4", audioPath: "/tmp/a.wav" }],
      sourceSha256: "0".repeat(64),
      audioSha256: "0".repeat(64),
      textSha256: "0".repeat(64),
    } as Parameters<typeof buildManagedVideoUseChapterRun>[0]);

    expect(run.schemaVersion).toBe(1);
    expect(run.runtime.profileId).toBe("video-use-managed-python-v1");
    expect(run.runtime.packageLockSha256).toBe("0".repeat(64)); // 锁文件缺失回退全零
    expect(run.shots[0]!.videoPath).toBe("/tmp/v.mp4");
  });
});
