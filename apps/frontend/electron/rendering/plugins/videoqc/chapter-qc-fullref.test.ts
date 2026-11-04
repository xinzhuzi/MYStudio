import { describe, expect, it } from "vitest";

import { buildFullRefGraph, compareFullReferencePair } from "./chapter-qc-fullref";
import { parsePsnrSummary, parseSsimSummary, parseVmafScore } from "./parse-ffmpeg-probe";
import type { QcCommandRunner } from "./chapter-qc-fftools";

// 真实收尾行(/tmp/dist_blur.mp4 vs /tmp/009-reuse.mp4,ffmpeg 7.1.1 本机实跑)
const VMAF_STDERR = "[Parsed_libvmaf_0 @ 0x95651cd80] VMAF score: 0.000000\n";
const SSIM_STDERR =
  "[Parsed_ssim_0 @ 0x862466580] SSIM Y:0.665837 (4.760414) U:0.961971 (14.198826) V:0.954462 (13.416261) All:0.763297 (6.257956)\n";
const PSNR_STDERR =
  "[Parsed_psnr_0 @ 0xb32539380] PSNR y:27.058306 u:42.076972 v:41.017107 average:28.742085 min:28.043151 max:29.503214\n";

describe("全参考收尾行解析", () => {
  it("三件各取所见,格式不合返回 undefined", () => {
    expect(parseVmafScore(VMAF_STDERR)).toBe(0);
    expect(parseSsimSummary(SSIM_STDERR)).toEqual({
      y: 0.665837,
      u: 0.961971,
      v: 0.954462,
      all: 0.763297,
      allDb: 6.257956,
    });
    expect(parsePsnrSummary(PSNR_STDERR)).toEqual({
      y: 27.058306,
      u: 42.076972,
      v: 41.017107,
      average: 28.742085,
      min: 28.043151,
      max: 29.503214,
    });
    expect(parseVmafScore("")).toBeUndefined();
    expect(parseSsimSummary("SSIM Y:nan")).toBeUndefined();
    expect(parsePsnrSummary("no psnr")).toBeUndefined();
  });
});

describe("buildFullRefGraph", () => {
  it("规格已对齐时直连,不插无谓 scale", () => {
    expect(buildFullRefGraph("vmaf", undefined)).toBe("[0:v][1:v]libvmaf");
    expect(buildFullRefGraph("ssim", undefined)).toBe("[0:v][1:v]ssim");
  });

  it("尺寸不一致只拉待检流,基准流不动", () => {
    expect(buildFullRefGraph("psnr", { width: 608, height: 352 })).toBe(
      "[1:v]scale=608:352:flags=bicubic[d];[0:v][d]psnr",
    );
  });

  it("帧率不一致同时补 fps", () => {
    expect(buildFullRefGraph("vmaf", { width: 1344, height: 768, fps: 24 })).toBe(
      "[1:v]scale=1344:768:flags=bicubic,fps=24[d];[0:v][d]libvmaf",
    );
  });
});

function probeRunner(probes: Record<string, unknown>): QcCommandRunner {
  return async (file, args) => {
    if (file.includes("ffprobe")) {
      const target = args[args.length - 1];
      return { stdout: JSON.stringify(probes[target] ?? { streams: [], format: {} }), stderr: "" };
    }
    if (args.join(" ").includes("libvmaf")) return { stdout: "", stderr: VMAF_STDERR };
    if (args.join(" ").includes("ssim")) return { stdout: "", stderr: SSIM_STDERR };
    if (args.join(" ").includes("psnr")) return { stdout: "", stderr: PSNR_STDERR };
    return { stdout: "", stderr: "" };
  };
}

function probe(width: number, height: number, fps: number) {
  return {
    streams: [
      { codec_type: "video", codec_name: "h264", width, height, avg_frame_rate: `${fps}/1` },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: "9.416000" },
  };
}

describe("compareFullReferencePair", () => {
  it("同规格三件全出且 geometry.scaled=false", async () => {
    const result = await compareFullReferencePair({
      referencePath: "/tmp/ref.mp4",
      distortedPath: "/tmp/dist.mp4",
      runner: probeRunner({ "/tmp/ref.mp4": probe(608, 352, 24), "/tmp/dist.mp4": probe(608, 352, 24) }),
    });
    expect(result.scores).toEqual({
      vmaf: 0,
      ssim: { y: 0.665837, u: 0.961971, v: 0.954462, all: 0.763297, allDb: 6.257956 },
      psnr: { y: 27.058306, u: 42.076972, v: 41.017107, average: 28.742085, min: 28.043151, max: 29.503214 },
    });
    expect(result.geometry.scaled).toBe(false);
    expect(result.errors).toEqual({});
  });

  it("跨档(480P vs 960P)记 scaled=true", async () => {
    const result = await compareFullReferencePair({
      referencePath: "/tmp/hi.mp4",
      distortedPath: "/tmp/lo.mp4",
      metrics: ["vmaf"],
      runner: probeRunner({ "/tmp/hi.mp4": probe(1344, 768, 24), "/tmp/lo.mp4": probe(608, 352, 24) }),
    });
    expect(result.geometry.scaled).toBe(true);
    expect(result.metrics).toEqual(["vmaf"]);
    expect(result.scores.ssim).toBeUndefined();
  });

  it("单指标 throw 不阻断其余,失败记账进 errors", async () => {
    const runner: QcCommandRunner = async (file, args) => {
      if (file.includes("ffprobe")) {
        return { stdout: JSON.stringify(probe(608, 352, 24)), stderr: "" };
      }
      if (args.join(" ").includes("libvmaf")) throw new Error("vmaf boom");
      return { stdout: "", stderr: SSIM_STDERR };
    };
    const result = await compareFullReferencePair({
      referencePath: "/tmp/ref.mp4",
      distortedPath: "/tmp/dist.mp4",
      metrics: ["vmaf", "ssim"],
      runner,
    });
    expect(result.errors.vmaf).toBe("vmaf boom");
    expect(result.scores.ssim?.all).toBe(0.763297);
  });
});
