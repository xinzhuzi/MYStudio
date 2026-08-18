import { describe, expect, it } from "vitest";
import { runStructuralLayer } from "./chapter-qc-structural";
import type { QcCommandRunner } from "./chapter-qc-fftools";
import { buildShotSpans } from "./chapter-qc-timeline";
import type { VideoUseEdlEntryV1, VideoUseSubtitleCueV1 } from "../../contracts/video-workflow";
import { qcProbeMedia } from "./chapter-qc-fftools";

function ffprobeRunner(durationS = 134): QcCommandRunner {
  const payload = {
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30/1" },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: String(durationS), bit_rate: "12000000" },
  };
  return async () => ({ stdout: JSON.stringify(payload), stderr: "" });
}

function edl(shotId: string, startS: number, durationS: number): VideoUseEdlEntryV1 {
  return { shotId, sourcePath: `/x/${shotId}`, sourceInS: 0, sourceOutS: durationS, timelineStartS: startS, durationS };
}

function cue(cueId: string, shotId: string, text: string): VideoUseSubtitleCueV1 {
  return { cueId, shotId, text, startUs: 0, durationUs: 1_000_000, source: "alignment" };
}

const healthySpans = buildShotSpans([edl("s1", 0, 67), edl("s2", 67, 67)]);

describe("runStructuralLayer", () => {
  it("健康输入零 finding,probe 透出", async () => {
    const result = await runStructuralLayer({
      videoPath: "/tmp/v.mp4",
      spans: healthySpans,
      cues: [cue("c1", "s1", "晏燎抬手")],
      scriptText: "晏燎抬手",
      runner: ffprobeRunner(),
    });
    expect(result.findings).toEqual([]);
    expect(result.probe?.durationS).toBe(134);
    expect(result.notes).toEqual([]);
  });

  it("缺音轨=blocker", async () => {
    const result = await runStructuralLayer({
      videoPath: "/tmp/v.mp4",
      spans: healthySpans,
      cues: [],
      runner: async () => ({
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30/1" }],
          format: { duration: "134.0" },
        }),
        stderr: "",
      }),
    });
    const blocker = result.findings.find((f) => f.code === "chapter-qc.audio.missing-track");
    expect(blocker?.severity).toBe("blocker");
  });

  it("时长截断=blocker 且带差值证据", async () => {
    const result = await runStructuralLayer({
      videoPath: "/tmp/v.mp4",
      spans: healthySpans,
      cues: [],
      runner: ffprobeRunner(120),
    });
    const truncated = result.findings.find((f) => f.code === "chapter-qc.duration.truncated");
    expect(truncated?.severity).toBe("blocker");
    expect(truncated?.evidence).toMatchObject({ plannedS: 134, actualS: 120 });
  });

  it("分辨率与渲染设置不符=warn", async () => {
    const result = await runStructuralLayer({
      videoPath: "/tmp/v.mp4",
      spans: healthySpans,
      cues: [],
      expectedWidth: 1080,
      runner: ffprobeRunner(),
    });
    expect(result.findings.some((f) => f.code === "chapter-qc.video.resolution-mismatch")).toBe(true);
  });

  it("计划旁白超成片时长=语音挤压计划侧信号", async () => {
    const result = await runStructuralLayer({
      videoPath: "/tmp/v.mp4",
      spans: healthySpans,
      cues: [],
      plannedVoiceDurationUs: 150_000_000, // 150s > 134s
      runner: ffprobeRunner(),
    });
    const squeeze = result.findings.find((f) => f.code === "chapter-qc.audio.speech-compressed-planned");
    expect(squeeze?.severity).toBe("warn");
  });

  it("无 EDL 降级:时间轴子项跳过并记 note", async () => {
    const result = await runStructuralLayer({
      videoPath: "/tmp/v.mp4",
      spans: [],
      cues: [],
      runner: ffprobeRunner(),
    });
    expect(result.findings).toEqual([]);
    expect(result.notes.some((note) => note.startsWith("no-edl"))).toBe(true);
  });

  it("probe 失败=blocker 且不再产其他 finding", async () => {
    const result = await runStructuralLayer({
      videoPath: "/tmp/missing.mp4",
      spans: healthySpans,
      cues: [],
      runner: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: "chapter-qc.probe.failed", severity: "blocker" });
    expect(result.probe).toBeUndefined();
  });

  it("字幕错字经 L1 报 text-mismatch(带 shotId)", async () => {
    const result = await runStructuralLayer({
      videoPath: "/tmp/v.mp4",
      spans: healthySpans,
      cues: [cue("c1", "s1", "晏燎抬手剑光如虹斩向道口县城上空")],
      scriptText: "晏燎抬手剑光如虹斩向道口镇上空",
      runner: ffprobeRunner(),
    });
    const mismatch = result.findings.find((f) => f.code === "chapter-qc.subtitle.text-mismatch");
    expect(mismatch?.shotId).toBe("s1");
    expect(mismatch?.severity).toBe("warn");
  });
});

describe("qcProbeMedia 帧率解析", () => {
  it("分数帧率与整数帧率均可解析", async () => {
    const make = (rate: string) =>
      qcProbeMedia("/tmp/v.mp4", async () => ({
        stdout: JSON.stringify({
          streams: [
            { codec_type: "video", codec_name: "h264", width: 1, height: 1, avg_frame_rate: rate },
            { codec_type: "audio", codec_name: "aac" },
          ],
          format: { duration: "10" },
        }),
        stderr: "",
      }));
    expect((await make("30000/1001")).fps).toBeCloseTo(29.97, 2);
    expect((await make("30/1")).fps).toBe(30);
    expect((await make("0/0")).fps).toBeUndefined();
  });
});
