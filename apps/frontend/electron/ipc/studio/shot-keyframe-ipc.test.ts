// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// electron 的 ipcMain 在 node 环境不可用——注册层单测只测抽帧/探测内核与
// 契约常量;通道注册由 main-ipc-contract.test.ts 全仓枚举守护。
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));

import {
  extractShotKeyframeFrames,
  probeShotVideo,
  sampleUniformTimestamps,
  SHOT_KEYFRAME_EXTRACT_CHANNEL,
  SHOT_VIDEO_PROBE_CHANNEL,
  type ShotKeyframeCommandRunner,
  type ShotKeyframeExtractRequestV1,
} from "./shot-keyframe-ipc";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shot-kf-ipc-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeProjectVideo(projectId: string, relativePath: string): string {
  const filePath = path.join(dataDir, "_p", projectId, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from("fake-mp4"));
  return `project-file://${encodeURIComponent(projectId)}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function ffprobeRunner(durationS: number, extra: { fps?: string; nbFrames?: string } = {}): ShotKeyframeCommandRunner {
  return async (file) => {
    if (file.includes("ffprobe")) {
      return {
        stdout: JSON.stringify({
          streams: [{
            codec_type: "video",
            width: 1920,
            height: 1080,
            avg_frame_rate: extra.fps ?? "30/1",
            ...(extra.nbFrames !== undefined ? { nb_frames: extra.nbFrames } : {}),
          }],
          format: { duration: String(durationS) },
        }),
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };
}

describe("sampleUniformTimestamps", () => {
  it("含首帧 0 与近尾帧,严格递增", () => {
    const stamps = sampleUniformTimestamps(10, 3);
    expect(stamps).toHaveLength(3);
    expect(stamps[0]).toBe(0);
    expect(stamps[1]).toBeCloseTo(5, 5);
    expect(stamps[2]).toBeGreaterThan(9.9);
    expect(stamps[2]).toBeLessThanOrEqual(10);
    for (let index = 1; index < stamps.length; index += 1) {
      expect(stamps[index]).toBeGreaterThan(stamps[index - 1]);
    }
  });

  it("9 帧档同样首帧 0;非法时长返回空", () => {
    expect(sampleUniformTimestamps(6, 9)[0]).toBe(0);
    expect(sampleUniformTimestamps(6, 9)).toHaveLength(9);
    expect(sampleUniformTimestamps(0, 3)).toEqual([]);
    expect(sampleUniformTimestamps(Number.NaN, 3)).toEqual([]);
  });
});

describe("probeShotVideo", () => {
  it("解析时长/帧率;容器带 nb_frames 时不标记估算", async () => {
    const probe = await probeShotVideo("/tmp/x.mp4", ffprobeRunner(8.5, { fps: "25/1", nbFrames: "213" }));
    expect(probe.durationS).toBe(8.5);
    expect(probe.fps).toBe(25);
    expect(probe.frameCount).toBe(213);
    expect(probe.frameCountEstimated).toBeUndefined();
    expect(probe.width).toBe(1920);
  });

  it("缺 nb_frames 时按 duration×fps 估算并标记", async () => {
    const probe = await probeShotVideo("/tmp/x.mp4", ffprobeRunner(10, { fps: "30/1" }));
    expect(probe.frameCount).toBe(300);
    expect(probe.frameCountEstimated).toBe(true);
  });

  it("无视频流/坏 JSON 抛错(调用侧转失败应答)", async () => {
    await expect(probeShotVideo("/tmp/x.mp4", async () => ({ stdout: "not-json", stderr: "" }))).rejects.toThrow();
    await expect(
      probeShotVideo("/tmp/x.mp4", async () => ({ stdout: JSON.stringify({ streams: [] }), stderr: "" })),
    ).rejects.toThrow(/视频流|时长/);
  });
});

describe("extractShotKeyframeFrames", () => {
  const baseRequest = (videoUrl: string): ShotKeyframeExtractRequestV1 => ({
    schemaVersion: 1,
    projectId: "p1",
    videoUrl,
    relativeOutDir: "media/storyboard-keyframes/chapter-001/sb-1",
    fileStem: "sb-1",
    mode: { kind: "single", timestampS: 2.5 },
  });

  it("单帧模式:ffmpeg 按时刻抽帧,返回 project-file URL", async () => {
    const videoUrl = writeProjectVideo("p1", "remotion/outputs/shots/chapter-001/sb-1/h3/a_v1_1.mp4");
    const calls: Array<[string, string[]]> = [];
    const runner: ShotKeyframeCommandRunner = async (file, args) => {
      calls.push([file, args]);
      if (file.includes("ffprobe")) return ffprobeRunner(6)(file, args);
      // 模拟 ffmpeg 产出帧文件(输出路径是最后一个参数)
      fs.writeFileSync(args[args.length - 1], Buffer.from("jpg"));
      return { stdout: "", stderr: "" };
    };
    const reply = await extractShotKeyframeFrames(baseRequest(videoUrl), { getDataDir: () => dataDir, runner });
    expect(reply.success).toBe(true);
    expect(reply.durationS).toBe(6);
    expect(reply.frames).toHaveLength(1);
    expect(reply.frames[0]?.timestampS).toBe(2.5);
    expect(reply.frames[0]?.url).toMatch(/^project-file:\/\/p1\/media\/storyboard-keyframes\/chapter-001\/sb-1\/sb-1-01-2500ms\.jpg$/);
    const ffmpegCall = calls.find(([file]) => file.includes("ffmpeg"));
    expect(ffmpegCall).toBeTruthy();
    expect(ffmpegCall?.[1]).toContain("-frames:v");
    expect(ffmpegCall?.[1]).toContain("-ss");
  });

  it("单帧时刻越界被钳到时长内;均匀采样 3/5/9 校验", async () => {
    const videoUrl = writeProjectVideo("p1", "remotion/out.mp4");
    const runner: ShotKeyframeCommandRunner = async (file, args) => {
      if (file.includes("ffprobe")) return ffprobeRunner(6)(file, args);
      fs.writeFileSync(args[args.length - 1], Buffer.from("jpg"));
      return { stdout: "", stderr: "" };
    };
    const late = await extractShotKeyframeFrames(
      { ...baseRequest(videoUrl), mode: { kind: "single", timestampS: 99 } },
      { getDataDir: () => dataDir, runner },
    );
    expect(late.success).toBe(true);
    expect(late.frames[0]?.timestampS).toBeLessThanOrEqual(6);

    const badCount = await extractShotKeyframeFrames(
      { ...baseRequest(videoUrl), mode: { kind: "uniform", count: 7 } } as unknown as ShotKeyframeExtractRequestV1,
      { getDataDir: () => dataDir, runner },
    );
    expect(badCount.success).toBe(false);
    expect(badCount.message).toContain("3/5/9");

    const uniform = await extractShotKeyframeFrames(
      { ...baseRequest(videoUrl), mode: { kind: "uniform", count: 3 } },
      { getDataDir: () => dataDir, runner },
    );
    expect(uniform.success).toBe(true);
    expect(uniform.frames).toHaveLength(3);
    expect(uniform.frames[0]?.timestampS).toBe(0);
  });

  it("安全门:绝对路径/越界目录/跨项目 URL/坏词干一律拒绝", async () => {
    const runner = ffprobeRunner(6);
    const deps = { getDataDir: () => dataDir, runner };
    expect((await extractShotKeyframeFrames(
      { ...baseRequest("/tmp/abs.mp4") } as ShotKeyframeExtractRequestV1,
      deps,
    )).success).toBe(false);
    expect((await extractShotKeyframeFrames(
      { ...baseRequest(writeProjectVideo("p1", "a/b.mp4")), relativeOutDir: "../escape" },
      deps,
    )).success).toBe(false);
    expect((await extractShotKeyframeFrames(
      { ...baseRequest(writeProjectVideo("other", "a/b.mp4")) },
      deps,
    )).success).toBe(false);
    expect((await extractShotKeyframeFrames(
      { ...baseRequest(writeProjectVideo("p1", "a/b.mp4")), fileStem: "../bad" },
      deps,
    )).success).toBe(false);
  });

  it("视频文件不存在=失败应答(不抛出;UI 走禁用态而非报错弹窗)", async () => {
    const reply = await extractShotKeyframeFrames(
      baseRequest("project-file://p1/nope/missing.mp4"),
      { getDataDir: () => dataDir, runner: ffprobeRunner(6) },
    );
    expect(reply.success).toBe(false);
    expect(reply.message).toContain("不存在");
  });

  it("个别帧失败不拖垮整批:成功帧照常返回", async () => {
    const videoUrl = writeProjectVideo("p1", "remotion/out.mp4");
    const runner: ShotKeyframeCommandRunner = async (file, args) => {
      if (file.includes("ffprobe")) return ffprobeRunner(9)(file, args);
      // 第 2 帧时刻 4.5s 失败,其余成功
      if (args.includes("4.500")) throw new Error("boom");
      fs.writeFileSync(args[args.length - 1], Buffer.from("jpg"));
      return { stdout: "", stderr: "" };
    };
    const reply = await extractShotKeyframeFrames(
      { ...baseRequest(videoUrl), mode: { kind: "uniform", count: 3 } },
      { getDataDir: () => dataDir, runner },
    );
    expect(reply.success).toBe(true);
    expect(reply.frames).toHaveLength(2);
    expect(reply.message).toContain("第 2 帧");
  });
});

describe("channel contract", () => {
  it("通道名纳入全仓 IPC 契约(main-ipc-contract.test.ts 枚举守护)", () => {
    expect(SHOT_KEYFRAME_EXTRACT_CHANNEL).toBe("shot-keyframe-extract");
    expect(SHOT_VIDEO_PROBE_CHANNEL).toBe("shot-video-probe");
  });
});
