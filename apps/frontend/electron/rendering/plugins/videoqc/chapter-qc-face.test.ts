import { describe, expect, it } from "vitest";

import {
  buildFaceFindings,
  FACE_READABLE_MIN_RATIO,
  FACE_SAMPLE_FRAMES,
  parseFaceWorkerJson,
  readFaceSignals,
  runChapterQcFace,
  runChapterQcFaceCrops,
  summarizeFaceCrops,
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
  it("未标定几何异常计数不能变成人物证据", () => {
    const signals = readFaceSignals({ ...JSON.parse(CHAPTER_608), geometryAnomalyFlags: 7 });
    expect(signals).not.toHaveProperty("geometryAnomalyFlags");
  });
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

/* ---- 1107 吸收件②:人脸裁片台账 ----
 * 下面三条 payload 同样是托管 Python 现跑 `python -m face_qc.worker --at ... --crop-out ... --json` 的原文:
 *   /tmp/try.mp4(720×1296 真人,全出片,短边 52.8–110.5px,小脸走插值)——这里留的是 2 点请求那条趟,
 *     统计字段与 crops 条数对齐(worker 的 index 恒为 `--at` 的位次,由 runChapterQcFaceCrops 硬校验)
 *   /tmp/noface-src2.mp4(ffmpeg testsrc2 图案,3 点全 no-face——空证据不是失败)
 *   /tmp/face-seg.mp4(1.208s 短片,请求 4 点只解出 1 帧,其余 read-failed)
 */
const CROPS_ALL = '{"schemaVersion": 1, "video": "/tmp/try.mp4", "model": "yunet-face@cv2-5.0.0", "status": "ok", "mode": "crops", "timestampsRequested": 2, "framesRead": 2, "framesWithoutFace": 0, "cropCount": 2, "cropErrors": 0, "cropBoxMargin": 1.5, "cropMinSidePx": 256, "crops": [{"index": 0, "tS": 0.633, "status": "crop", "file": "face-crop-000-t0.633.jpg", "box": [264.0, 435.3, 52.8, 109.3], "faceShortSidePx": 52.8, "facesInFrame": 2, "cropPx": [256, 256], "upscaled": true}, {"index": 1, "tS": 10.05, "status": "crop", "file": "face-crop-001-t10.050.jpg", "box": [96.0, 314.6, 110.5, 225.4], "faceShortSidePx": 110.5, "facesInFrame": 2, "cropPx": [320, 338], "upscaled": false}]}';

// 条数齐、形状齐,但 index 不跟位次走(第 2 条回 7):调用点 `midFrames[crop.index]` 会把这条静默丢掉,
// 「人脸裁片 2/2 镜」就成了假满——本层禁的正是把缺证藏进统计。
const CROPS_MISPOSED = CROPS_ALL
  .replace('"index": 1, "tS": 10.05', '"index": 7, "tS": 10.05')
  .replace("face-crop-001-t10.050.jpg", "face-crop-007-t10.050.jpg");

const CROPS_NO_FACE = '{"schemaVersion": 1, "video": "/tmp/noface-src2.mp4", "model": "yunet-face@cv2-5.0.0", "status": "ok", "mode": "crops", "timestampsRequested": 3, "framesRead": 3, "framesWithoutFace": 3, "cropCount": 0, "cropErrors": 0, "cropBoxMargin": 1.5, "cropMinSidePx": 256, "crops": [{"index": 0, "tS": 0.633, "status": "no-face"}, {"index": 1, "tS": 1.898, "status": "no-face"}, {"index": 2, "tS": 3.164, "status": "no-face"}]}';

// 1.2s 的片子被要到 99.5s:解不出帧的那几条必须是台账里的 read-failed,不能只是「少几条」
const CROPS_READ_FAILED = '{"schemaVersion": 1, "video": "/tmp/face-seg.mp4", "model": "yunet-face@cv2-5.0.0", "status": "ok", "mode": "crops", "timestampsRequested": 4, "framesRead": 1, "framesWithoutFace": 0, "cropCount": 1, "cropErrors": 3, "cropBoxMargin": 1.5, "cropMinSidePx": 256, "crops": [{"index": 0, "tS": 0.633, "status": "crop", "file": "face-crop-000-t0.633.jpg", "box": [906.1, 6.6, 140.0, 147.3], "faceShortSidePx": 140.0, "facesInFrame": 2, "cropPx": [298, 256], "upscaled": true}, {"index": 1, "tS": 1.898, "status": "read-failed"}, {"index": 2, "tS": 3.164, "status": "read-failed"}, {"index": 3, "tS": 99.5, "status": "read-failed"}]}';

const CROP_OUT_REQUIRED = '{"schemaVersion": 1, "video": "/tmp/try.mp4", "model": "yunet-face", "status": "failed", "code": "crop-out-required", "message": "--at 必须配 --crop-out(裁片落盘目录)"}';

const cropInput = {
  ...baseInput,
  timestamps: [0.633, 1.898, 3.164],
  cropsDir: "/storage/qc/chapters/c1/vision-frames",
};

describe("runChapterQcFaceCrops", () => {
  it("时间点按镜序逗号送、裁片落进 vision-frames 目录", async () => {
    const { runner, calls } = recordingRunner(CROPS_ALL);
    await runChapterQcFaceCrops({ ...cropInput, timestamps: [0.633, 1.898, 3.164, 10.05], runner });
    expect(calls[0]!.args.slice(0, 2)).toEqual(["-m", "face_qc.worker"]);
    expect(calls[0]!.args[calls[0]!.args.indexOf("--at") + 1]).toBe("0.633,1.898,3.164,10.050");
    expect(calls[0]!.args[calls[0]!.args.indexOf("--crop-out") + 1]).toBe(cropInput.cropsDir);
    expect(calls[0]!.args).toContain("--json");
    expect(calls[0]!.args).not.toContain("--samples");
    expect(calls[0]!.pythonPath).toBe(baseInput.backendRoot);
  });

  it("没有镜中点时不 spawns:空请求不是「这章没脸」的证据", async () => {
    const { runner, calls } = recordingRunner(CROPS_NO_FACE);
    const outcome = await runChapterQcFaceCrops({ ...cropInput, timestamps: [], runner });
    expect(calls).toHaveLength(0);
    expect(outcome).toEqual({ available: true, crops: [] });
  });

  it("全量裁片台账逐条可读:文件名/框/短边/放大决策都留档", async () => {
    const outcome = await runChapterQcFaceCrops({ ...cropInput, timestamps: [0.633, 10.05], runner: recordingRunner(CROPS_ALL).runner });
    expect(outcome.available).toBe(true);
    expect(outcome.crops).toEqual([
      { index: 0, tS: 0.633, status: "crop", file: "face-crop-000-t0.633.jpg", box: [264, 435.3, 52.8, 109.3], faceShortSidePx: 52.8, facesInFrame: 2, cropPx: [256, 256], upscaled: true },
      { index: 1, tS: 10.05, status: "crop", file: "face-crop-001-t10.050.jpg", box: [96, 314.6, 110.5, 225.4], faceShortSidePx: 110.5, facesInFrame: 2, cropPx: [320, 338], upscaled: false },
    ]);
    expect(summarizeFaceCrops(outcome.crops)).toEqual({ produced: 2, noFace: 0, gaps: 0 });
  });

  it("index 不是位次就整批按缺证收:条数齐也不能让裁片静默找不到镜", async () => {
    const outcome = await runChapterQcFaceCrops({ ...cropInput, timestamps: [0.633, 10.05], runner: recordingRunner(CROPS_MISPOSED).runner });
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toContain("index 错位");
    // 台账原样回传:哪几条出了片仍要看得见,只是这一批不许顶替成「五官特写有证据」
    expect(outcome.crops.map((crop) => crop.index)).toEqual([0, 7]);
  });

  it("无脸帧是空证据不是失败:台账齐 → available", async () => {
    const outcome = await runChapterQcFaceCrops({ ...cropInput, runner: recordingRunner(CROPS_NO_FACE).runner });
    expect(outcome.available).toBe(true);
    expect(summarizeFaceCrops(outcome.crops)).toEqual({ produced: 0, noFace: 3, gaps: 0 });
  });

  it("read-failed 计入 gaps(调用方据此把五官特写记成缺证)", async () => {
    const outcome = await runChapterQcFaceCrops({
      ...cropInput,
      timestamps: [0.633, 1.898, 3.164, 99.5],
      runner: recordingRunner(CROPS_READ_FAILED).runner,
    });
    expect(outcome.available).toBe(true);
    expect(outcome.crops.map((crop) => crop.status)).toEqual(["crop", "read-failed", "read-failed", "read-failed"]);
    expect(summarizeFaceCrops(outcome.crops)).toEqual({ produced: 1, noFace: 0, gaps: 3 });
  });

  it("台账条数 ≠ 请求条数 = 缺证,绝不读成「这些镜没有脸」", async () => {
    const outcome = await runChapterQcFaceCrops({ ...cropInput, timestamps: [0.633, 1.898, 3.164], runner: recordingRunner(CROPS_READ_FAILED).runner });
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toContain("台账 4 条 ≠ 请求 3 条");
    expect(outcome.crops).toHaveLength(4);
  });

  it("接线错(--at 没配 --crop-out)与 worker 没进裁片模式都回 available=false", async () => {
    const miswired = await runChapterQcFaceCrops({ ...cropInput, runner: recordingRunner(CROP_OUT_REQUIRED).runner });
    expect(miswired.available).toBe(false);
    expect(miswired.reason).toContain("failed(crop-out-required)");

    const wrongMode = await runChapterQcFaceCrops({ ...cropInput, runner: recordingRunner(CHAPTER_608).runner });
    expect(wrongMode.available).toBe(false);
    expect(wrongMode.reason).toContain("mode 不是 crops");
  });

  it("半截台账条目(缺 index/tS/status)不进台账→条数对不上即缺证", async () => {
    const halfBaked = '{"status": "ok", "mode": "crops", "crops": [{"index": 0, "tS": 0.633, "status": "crop", "file": "a.jpg"}, {"index": 1, "status": "crop", "file": "b.jpg"}, {"tS": 3.1, "status": "crop", "file": "c.jpg"}, {"index": 2, "tS": 3.164, "status": "unknown"}]}';
    const outcome = await runChapterQcFaceCrops({ ...cropInput, runner: recordingRunner(halfBaked).runner });
    expect(outcome.available).toBe(false);
    expect(outcome.crops).toHaveLength(1);
  });

  it("输出垃圾 / python 起不来 → available=false 带原因,不抛错", async () => {
    const garbage = await runChapterQcFaceCrops({ ...cropInput, runner: recordingRunner("Traceback (most recent call last)").runner });
    expect(garbage.available).toBe(false);
    expect(garbage.reason).toContain("无法解析");

    const crashed = await runChapterQcFaceCrops({
      ...cropInput,
      runner: async () => {
        throw new Error("spawn ENOENT");
      },
    });
    expect(crashed.available).toBe(false);
    expect(crashed.reason).toContain("人脸裁片调用异常");
  });
});
