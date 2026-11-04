import { describe, expect, it } from "vitest";

import {
  buildFaceFindings,
  FACE_READABLE_MIN_RATIO,
  FACE_SAMPLE_FRAMES,
  parseFaceWorkerJson,
  readFaceSignals,
  runChapterQcFace,
  type FaceCommandRunner,
} from "./chapter-qc-face";

/**
 * 全部 fixture 都是 2026-11-02 用托管 Python 现跑 `python -m face_qc.worker --json` 抓回的原文,
 * 手搓 payload 会让门永远绿(1031 卡帧门的教训)。
 * 来源:ch1_h3_matrix_1029/{h3_edition_final,h3_chapter_draft,win_h3_004,win_h3_008}.mp4
 * 与 /tmp/nope.mp4、截断的 /tmp/corrupt_1102.mp4。
 */

// 608×352 成片:51 张脸只有 18 张够大(中位短边 22.1px < 24px 可辨线)
const CHAPTER_608 = '{"schemaVersion": 1, "video": "../output/ch1_h3_matrix_1029/h3_edition_final.mp4", "model": "yunet-face@cv2-5.0.0", "status": "ok", "durationS": 202.333, "inputSize": 512, "scoreThreshold": 0.6, "minReadableFacePx": 24, "samplesRequested": 24, "framesRead": 24, "framesWithFace": 13, "coverage": 0.542, "faceCount": 51, "readableFaceCount": 18, "readableRatio": 0.353, "medianFaceShortSidePx": 22.1, "maxFaceScore": 0.895, "driftDistanceP50": 0.061, "driftDistanceP95": 0.127, "driftPairs": 7}';

// 同一章 1920×1080:50 张脸全可辨(中位 71.1px)——变量只有分辨率
const CHAPTER_1080 = '{"schemaVersion": 1, "video": "../output/ch1_h3_matrix_1029/h3_chapter_draft.mp4", "model": "yunet-face@cv2-5.0.0", "status": "ok", "durationS": 194.39, "inputSize": 512, "scoreThreshold": 0.6, "minReadableFacePx": 24, "samplesRequested": 24, "framesRead": 24, "framesWithFace": 13, "coverage": 0.542, "faceCount": 50, "readableFaceCount": 50, "readableRatio": 1.0, "medianFaceShortSidePx": 71.1, "maxFaceScore": 0.88, "driftDistanceP50": 0.0725, "driftDistanceP95": 0.1697, "driftPairs": 7}';

// 背面镜头:整章 0 脸,worker 对不可算的比值发 null(不是 0)
const ZERO_FACE = '{"schemaVersion": 1, "video": "../output/ch1_h3_matrix_1029/win_h3_008.mp4", "model": "yunet-face@cv2-5.0.0", "status": "ok", "durationS": 7.292, "inputSize": 512, "scoreThreshold": 0.6, "minReadableFacePx": 24, "samplesRequested": 24, "framesRead": 24, "framesWithFace": 0, "coverage": 0.0, "faceCount": 0, "readableFaceCount": 0, "readableRatio": null, "medianFaceShortSidePx": null, "maxFaceScore": null, "driftDistanceP50": null, "driftDistanceP95": null, "driftPairs": 0}';

// 单帧 1 张小脸(win_h3_004):readableRatio 真 0.0,不是缺失
const ONE_UNREADABLE_FACE = '{"schemaVersion": 1, "video": "../output/ch1_h3_matrix_1029/win_h3_004.mp4", "model": "yunet-face@cv2-5.0.0", "status": "ok", "durationS": 14.375, "inputSize": 512, "scoreThreshold": 0.6, "minReadableFacePx": 24, "samplesRequested": 24, "framesRead": 24, "framesWithFace": 1, "coverage": 0.042, "faceCount": 1, "readableFaceCount": 0, "readableRatio": 0.0, "medianFaceShortSidePx": 22.7, "maxFaceScore": 0.634, "driftDistanceP50": null, "driftDistanceP95": null, "driftPairs": 0}';

const MODEL_MISSING = '{"schemaVersion": 1, "video": "h3_002.mp4", "model": "yunet-face", "status": "needs-runtime", "code": "model-not-downloaded", "message": "模型文件不存在: /tmp/does-not-exist.onnx"}';
const VIDEO_UNOPENABLE = '{"schemaVersion": 1, "video": "/tmp/nope.mp4", "model": "yunet-face", "status": "needs-runtime", "code": "scan-failed", "message": "cv2 打不开视频"}';
// 截断 mp4:头部时长读得到但一帧都解不出来 → status 仍是 ok,framesRead 0
const NO_DECODABLE_FRAME = '{"schemaVersion": 1, "video": "/tmp/corrupt_1102.mp4", "model": "yunet-face@cv2-5.0.0", "status": "ok", "durationS": 9.417, "inputSize": 512, "scoreThreshold": 0.6, "minReadableFacePx": 24, "samplesRequested": 24, "framesRead": 0, "framesWithFace": 0, "coverage": null, "faceCount": 0, "readableFaceCount": 0, "readableRatio": null, "medianFaceShortSidePx": null, "maxFaceScore": null, "driftDistanceP50": null, "driftDistanceP95": null, "driftPairs": 0}';

function recordingRunner(stdout: string): { runner: FaceCommandRunner; calls: Array<{ file: string; args: string[]; cwd: string; pythonPath: string }> } {
  const calls: Array<{ file: string; args: string[]; cwd: string; pythonPath: string }> = [];
  return {
    calls,
    runner: async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd, pythonPath: options.env.PYTHONPATH ?? "" });
      return { stdout: `${stdout}\n`, stderr: "" };
    },
  };
}

const baseInput = {
  videoPath: "/storage/qc/h3_edition_final.mp4",
  pythonExecutable: "/storage/python/bin/python3",
  backendRoot: "/app/apps/backend",
};

describe("parseFaceWorkerJson", () => {
  it("取末条非空行;垃圾与空串返回 null(不许当「人脸没问题」)", () => {
    expect(parseFaceWorkerJson(`\n${CHAPTER_608}\n`)?.status).toBe("ok");
    expect(parseFaceWorkerJson("Traceback ...")).toBeNull();
    expect(parseFaceWorkerJson("")).toBeNull();
  });
});

describe("readFaceSignals(真机载荷)", () => {
  it("608×352 成片:51 脸 / 18 可辨 / readableRatio 0.353 / 中位短边 22.1px", () => {
    const signals = readFaceSignals(JSON.parse(CHAPTER_608));
    expect(signals).toMatchObject({
      framesRead: 24,
      framesWithFace: 13,
      coverage: 0.542,
      faceCount: 51,
      readableFaceCount: 18,
      readableRatio: 0.353,
      minReadableFacePx: 24,
      medianFaceShortSidePx: 22.1,
      driftDistanceP50: 0.061,
      driftDistanceP95: 0.127,
      driftPairs: 7,
      model: "yunet-face@cv2-5.0.0",
    });
  });

  it("worker 发 null 的比值不落进 signals(Number(null)===0 会把「算不出」读成 0)", () => {
    const signals = readFaceSignals(JSON.parse(ZERO_FACE));
    expect(signals.readableRatio).toBeUndefined();
    expect(signals.medianFaceShortSidePx).toBeUndefined();
    expect(signals.driftDistanceP50).toBeUndefined();
    expect(signals.coverage).toBe(0); // 真 0(采到帧但一张脸没有)与 null 必须分流
    expect(signals.driftPairs).toBe(0);
  });
});

describe("runChapterQcFace", () => {
  it("按 -m face_qc.worker 在 backendRoot 起跑,PYTHONPATH 指回 backend,采样数走常量", async () => {
    const { runner, calls } = recordingRunner(CHAPTER_608);
    await runChapterQcFace({ ...baseInput, runner });
    expect(calls[0]!.file).toBe(baseInput.pythonExecutable);
    expect(calls[0]!.args.slice(0, 2)).toEqual(["-m", "face_qc.worker"]);
    expect(calls[0]!.args).toContain("--video");
    expect(calls[0]!.args[calls[0]!.args.indexOf("--video") + 1]).toBe(baseInput.videoPath);
    expect(calls[0]!.args[calls[0]!.args.indexOf("--samples") + 1]).toBe(String(FACE_SAMPLE_FRAMES));
    expect(calls[0]!.args).toContain("--json");
    expect(calls[0]!.cwd).toBe(baseInput.backendRoot);
    expect(calls[0]!.pythonPath).toBe(baseInput.backendRoot);
  });

  it("ok → available 并带证据", async () => {
    const outcome = await runChapterQcFace({ ...baseInput, runner: recordingRunner(CHAPTER_608).runner });
    expect(outcome.available).toBe(true);
    expect(outcome.signals?.faceCount).toBe(51);
  });

  it("needs-runtime(模型未下载)→ available=false 带码,不当成通过", async () => {
    const outcome = await runChapterQcFace({ ...baseInput, runner: recordingRunner(MODEL_MISSING).runner });
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toContain("needs-runtime(model-not-downloaded)");
  });

  it("needs-runtime(cv2 打不开视频)→ available=false 带码", async () => {
    const outcome = await runChapterQcFace({ ...baseInput, runner: recordingRunner(VIDEO_UNOPENABLE).runner });
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toContain("needs-runtime(scan-failed)");
  });

  it("ok 但一帧都没解出来(截断 mp4)→ 无证据,原因写明不是「人脸没问题」", async () => {
    const outcome = await runChapterQcFace({ ...baseInput, runner: recordingRunner(NO_DECODABLE_FRAME).runner });
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toContain("0 帧可读");
    expect(outcome.signals?.framesRead).toBe(0);
  });

  it("输出垃圾 / python 起不来 → 一律 available=false,不抛错", async () => {
    const garbage = await runChapterQcFace({ ...baseInput, runner: recordingRunner("not json").runner });
    expect(garbage.available).toBe(false);
    expect(garbage.reason).toContain("无法解析");

    const crashed = await runChapterQcFace({
      ...baseInput,
      runner: async () => {
        throw new Error("spawn ENOENT");
      },
    });
    expect(crashed.available).toBe(false);
    expect(crashed.reason).toContain("人脸调用异常");
  });
});

describe("buildFaceFindings", () => {
  it("恒有一条 info 汇总,证据整包挂上(供审计回看)", () => {
    const findings = buildFaceFindings(readFaceSignals(JSON.parse(CHAPTER_608)));
    const summary = findings.find((finding) => finding.code === "chapter-qc.face.summary");
    expect(summary?.layer).toBe("vision");
    expect(summary?.severity).toBe("info");
    expect(summary?.message).toContain("51");
    expect(summary?.evidence).toMatchObject({ faceCount: 51, readableRatio: 0.353 });
  });

  it("608×352 成片(0.353 < 线 0.5)→ 追一条 warn 声明「无法自动判」", () => {
    const findings = buildFaceFindings(readFaceSignals(JSON.parse(CHAPTER_608)));
    const warn = findings.find((finding) => finding.code === "chapter-qc.face.unreadable");
    expect(warn?.severity).toBe("warn");
    expect(warn?.message).toContain("无法自动判");
    expect(warn?.evidence).toMatchObject({ readableRatio: 0.353, minReadableFacePx: 24 });
    expect(FACE_READABLE_MIN_RATIO).toBe(0.5);
  });

  it("同章 1080P(可辨率 1.0)→ 只有汇总,不喊狼来了", () => {
    const codes = buildFaceFindings(readFaceSignals(JSON.parse(CHAPTER_1080))).map((finding) => finding.code);
    expect(codes).toEqual(["chapter-qc.face.summary"]);
  });

  it("零检出章(背面镜头已亲检为合理内容)→ 不出不可判 warn", () => {
    const codes = buildFaceFindings(readFaceSignals(JSON.parse(ZERO_FACE))).map((finding) => finding.code);
    expect(codes).toEqual(["chapter-qc.face.summary"]);
  });

  it("检到 1 张小脸(readableRatio 真 0.0)→ 出 warn,和「算不出」不是一回事", () => {
    const findings = buildFaceFindings(readFaceSignals(JSON.parse(ONE_UNREADABLE_FACE)));
    expect(findings.map((finding) => finding.code)).toEqual([
      "chapter-qc.face.summary",
      "chapter-qc.face.unreadable",
    ]);
  });
});
