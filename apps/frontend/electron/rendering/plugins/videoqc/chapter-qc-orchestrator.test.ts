import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { runChapterQc, readReport } from "./chapter-qc-orchestrator";
import { resolveVadPythonExecutable } from "./chapter-qc-vad";
import { legacyStudioWorkflowStorePath } from "../../../storage/studio-workflow-store-io";
import {
  QC_CALIBRATION_MIN_RED_CASES,
  calibrationCaseId,
  readCalibrationStore,
  writeCalibrationStore,
} from "./chapter-qc-calibration";
import type { ChapterQcCalibrationCaseV1, ChapterQcRequirementVerdict } from "./chapter-qc-types";
import { CHAPTER_QC_WEIGHT_TOTAL } from "./chapter-qc-registry";

// 集成测试用真实 ffmpeg/ffprobe 合成 8s 成片,走完整 L1+L2 链;
// 环境无 ffmpeg 时跳过(CI 依赖与 build 脚本同款假设)。
const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const itFfmpeg = ffmpegAvailable ? it : it.skip;

// QC 侧车(VAD + YuNet 人脸)走真机托管 Python:解释器与人脸权重都在位才跑,
// 缺任何一件整组 skip——这条门证明的是「应用侧接线」,不是「Worker 能不能算」。
const sidecarStorageBase = join(homedir(), "Library", "Application Support", "漫影工作室");
const sidecarBackendRoot = resolve(__dirname, "../../../../../backend");
const sidecarAvailable = ffmpegAvailable
  && existsSync(resolveVadPythonExecutable(sidecarStorageBase))
  && existsSync(join(sidecarStorageBase, "comfyui", "models", "videoqc", "face_detection_yunet.onnx"));
const itSidecar = sidecarAvailable ? it : it.skip;

let dir: string;
let videoPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "qc-orch-"));
  videoPath = join(dir, "current.mp4");
  if (!ffmpegAvailable) return;
  execFileSync(
    "ffmpeg",
    [
      "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=8",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      videoPath,
    ],
    { stdio: "ignore" },
  );
}, 120_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runChapterQc 集成(真实 ffmpeg)", () => {
  itFfmpeg("成片不存在返回 null", async () => {
    const result = await runChapterQc(
      {
        remotionWorkspaceRootForProject: () => dir,
        videoUseWorkspaceRootForProject: () => join(dir, "video-use"),
        dataRoot: join(dir, "data"),
      },
      { projectId: "p1", chapterId: "c-missing" },
    );
    expect(result).toBeNull();
  });

  itFfmpeg("无工件/无 store 降级仍产出报告:L1+L2 通过,观感 skip,语义 pending", async () => {
    const deps = {
      remotionWorkspaceRootForProject: () => dir,
      videoUseWorkspaceRootForProject: () => join(dir, "video-use"),
      dataRoot: join(dir, "data"),
    };
    // current.mp4 放在 outputs/chapters/c-001/ 约定位置
    const { mkdirSync, copyFileSync } = await import("node:fs");
    mkdirSync(join(dir, "outputs", "chapters", "c-001"), { recursive: true });
    copyFileSync(videoPath, join(dir, "outputs", "chapters", "c-001", "current.mp4"));

    const report = await runChapterQc(deps, { projectId: "p1", chapterId: "c-001" });
    expect(report).not.toBeNull();
    expect(report!.layers.structural.status).toBe("passed");
    expect(report!.layers.ffmpegScan.status).toBe("passed");
    expect(report!.layers.aesthetic.status).toBe("skipped");
    expect(report!.layers.aesthetic.reason).toBe("skipped-no-controller");
    expect(report!.layers.semantic.status).toBe("pending");
    expect(report!.durationS).toBeGreaterThan(7.5);
    expect(report!.outputSha256).toMatch(/^[0-9a-f]{64}$/);

    // 取证口径必须落盘:三态板只说得出「哪一维没证据」,说不出「证据是怎么来的」。
    // 无 store、无 render-plan 这两条退化只有 notes 一个出口,丢了就永久看不见。
    expect(report!.notes).toContain("no-workflow-store");
    expect(report!.notes).toContain("render-plan 缺失,镜区间退回 artifact EDL 口径(未压缩,镜归因可能漂移)");

    // 报告落盘可读
    const persisted = await readReport(deps, { projectId: "p1", chapterId: "c-001" });
    expect(persisted?.summary).toEqual(report!.summary);
    expect(persisted?.notes).toEqual(report!.notes);
    expect(existsSync(join(dir, "qc", "chapters", "c-001", "current.json"))).toBe(true);
  }, 180_000);

  itFfmpeg("骨干接线落地:render-plan 时间轴 + 分镜声明 → 期望②/供给⓪/逐镜台账/标定③全进报告并落盘", async () => {
    const deps = {
      remotionWorkspaceRootForProject: () => dir,
      videoUseWorkspaceRootForProject: () => join(dir, "video-use"),
      dataRoot: join(dir, "data"),
      now: () => 1_700_000_000_000,
    };
    const { mkdirSync, copyFileSync, writeFileSync } = await import("node:fs");
    const chapterId = "c-backbone";
    mkdirSync(join(dir, "outputs", "chapters", chapterId), { recursive: true });
    copyFileSync(videoPath, join(dir, "outputs", "chapters", chapterId, "current.mp4"));
    // 时间轴权威=render-plan:三镜各 2.5s,无转场压缩
    mkdirSync(join(dir, "jobs", "chapter", chapterId), { recursive: true });
    writeFileSync(
      join(dir, "jobs", "chapter", chapterId, "current-render-plan.json"),
      JSON.stringify({
        renderSettings: { fps: 30 },
        clips: [
          { id: "c1", trackKind: "video", startUs: 0, durationUs: 2_500_000, source: { kind: "storyboardVideo", evidence: { storyboardId: "sb-1" } } },
          { id: "c2", trackKind: "video", startUs: 2_500_000, durationUs: 2_500_000, source: { kind: "storyboardVideo", evidence: { storyboardId: "sb-2" } } },
          { id: "c3", trackKind: "video", startUs: 5_000_000, durationUs: 2_500_000, source: { kind: "storyboardVideo", evidence: { storyboardId: "sb-3" } } },
        ],
        transitions: [],
        effects: [],
      }),
      "utf-8",
    );
    // 分镜声明侧:sb-1 要动(sb-2 显式定格、sb-3 空镜),三镜都 ready 且都没声明台词
    mkdirSync(join(dir, "data"), { recursive: true });
    const storePath = legacyStudioWorkflowStorePath(deps.dataRoot, "bb1");
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      state: {
        storyboards: [
          { id: "sb-1", episodeId: chapterId, duration: 2.5, durationTarget: 2.5, state: "ready",
            shotSemantics: { personFree: false, shotSize: "中景", cameraMove: "推" }, videoDesc: "推镜入殿" },
          { id: "sb-2", episodeId: chapterId, duration: 2.5, state: "ready", shotFx: { motion: "hold" }, videoDesc: "牌匾定格" },
          { id: "sb-3", episodeId: chapterId, duration: 2.5, state: "ready", shotSemantics: { personFree: true } },
          { id: "sb-9", episodeId: "c-other", duration: 2.5, state: "ready" },
        ],
      },
    }), "utf-8");

    const report = await runChapterQc(deps, { projectId: "bb1", chapterId });
    expect(report).not.toBeNull();

    // 骨干②:声明变成可对照的逐镜断言(镜号来自 render-plan 时间轴)
    const expectations = report!.expectations!;
    expect(expectations.shots.map((shot) => shot.shotId)).toEqual(["sb-1", "sb-2", "sb-3"]);
    expect(expectations.shots.map((shot) => shot.ordinal)).toEqual([1, 2, 3]);
    expect(expectations.shots.map((shot) => shot.assertions.motion)).toEqual(["expected", "forbidden", "forbidden"]);
    expect(expectations.shots[0].provenance.motion).toContain("cameraMove=推");
    expect(expectations.coverage.find((row) => row.key === "speech")).toMatchObject({ expected: 0, forbidden: 0, unknown: 3 });

    // 骨干⓪:供给自检 11 项,时间轴口径认 render-plan,无台词声明 ⇒ subtitle 缺证而非硬矛盾
    const supply = report!.supplyChecks!;
    expect(supply.checks).toHaveLength(11);
    const check = (checkId: string) => supply.checks.find((item) => item.checkId === checkId);
    expect(check("timeline-authority")).toMatchObject({ verdict: "ok", detail: expect.stringContaining("render-plan") });
    expect(check("expectations-declared")).toMatchObject({ verdict: "ok", detail: "3 镜带期望" });
    expect(check("shot-spans")).toMatchObject({ verdict: "ok", detail: "3 镜" });
    expect(check("shot-readiness")).toMatchObject({ verdict: "ok" });
    expect(check("subtitle-material")).toMatchObject({ verdict: "gap" });
    expect(supply.blocked).toBe(0);
    expect(report!.findings.some((finding) => finding.code === "chapter-qc.supply.gap")).toBe(true);
    const supplyRow = report!.requirements!.find((item) => item.requirementId === "supply-integrity");
    expect(supplyRow?.verdict).toBe("unverified");

    // 骨干②的证据前提:L2 同趟产出逐镜台账(运动 + 语音),逐镜门才有对照物
    const scanSignals = report!.scanSignals!;
    expect(scanSignals.shotMotion!.map((row) => row.shotId)).toEqual(["sb-1", "sb-2", "sb-3"]);
    for (const row of scanSignals.shotMotion!) {
      expect(row.sampleCount, row.shotId).toBeGreaterThanOrEqual(3);
      expect(row.tiMean, row.shotId).toBeGreaterThan(0);
      expect(row.staticFrameRatio, row.shotId).toBeGreaterThanOrEqual(0);
    }
    expect(scanSignals.shotSpeech).toHaveLength(3);

    // 骨干③:单章样本撑不起带 ⇒ 逐镜动态门只能缺证,且写明差几条
    // 画带剔本章:库里只有本章这一条时,凭数=0 条、本系列攒数=1 条,两个数都要在板上。
    expect(report!.calibration!.seriesId).toBe("bb1");
    expect(report!.calibration!.caseCount).toBe(0);
    const staticBaseline = report!.calibration!.baselines.find((item) => item.signalId === "motion.staticFrameRatio");
    expect(staticBaseline?.sampleCount).toBe(0);
    expect(staticBaseline?.seriesSampleCount).toBe(1);
    const motionRow = report!.requirements!.find((item) => item.requirementId === "motion-plan-consistent");
    expect(motionRow?.verdict).toBe("unverified");
    expect(motionRow?.missing?.[0]).toContain("未标定");
    expect(motionRow?.missing?.[0]).toContain("样本 0 条");
    expect(motionRow?.missing?.[0]).toContain("本系列已攒 1 条");

    // 落盘往返:骨干四件一条不丢
    const persisted = await readReport(deps, { projectId: "bb1", chapterId });
    expect(persisted?.expectations?.shots).toHaveLength(3);
    expect(persisted?.supplyChecks?.checks).toHaveLength(11);
    expect(persisted?.scanSignals?.shotMotion).toHaveLength(3);
    expect(persisted?.calibration?.baselines).toEqual(report!.calibration!.baselines);
    expect(persisted?.dimensionScore?.weightTotal).toBe(CHAPTER_QC_WEIGHT_TOTAL);

    // 标定库独立落盘,同章重跑覆盖旧值(样本=一章一条,不越跑越"多")
    expect(countSignalSamples(dir, "bb1", "motion.staticFrameRatio")).toBe(1);
    const rerun = await runChapterQc(deps, { projectId: "bb1", chapterId });
    const rerunBaseline = rerun!.calibration!.baselines.find((item) => item.signalId === "motion.staticFrameRatio");
    expect(rerunBaseline?.sampleCount).toBe(0);
    expect(rerunBaseline?.seriesSampleCount).toBe(1);
    expect(countSignalSamples(dir, "bb1", "motion.staticFrameRatio")).toBe(1);
  }, 240_000);

  itFfmpeg("金标负例走生产链:差几条只记账,补齐 3 条这门从 pass 压成缺证", async () => {
    const deps = {
      remotionWorkspaceRootForProject: () => dir,
      videoUseWorkspaceRootForProject: () => join(dir, "video-use"),
      dataRoot: join(dir, "data"),
    };
    const { mkdirSync, copyFileSync } = await import("node:fs");
    const seriesId = "bb-gold";
    const chapterId = "c-gold";
    mkdirSync(join(dir, "outputs", "chapters", chapterId), { recursive: true });
    copyFileSync(videoPath, join(dir, "outputs", "chapters", chapterId, "current.mp4"));
    const writeCases = (count: number) =>
      writeCalibrationStore(dir, {
        schemaVersion: 1,
        seriesId,
        samples: [],
        cases: Array.from({ length: count }, (_, index) =>
          goldCase(index, "no-blackout", "red", "pass"),
        ),
      });

    // 前提:testsrc2 彩条在 no-blackout 上本来就是真 pass(不是被别的账压成的缺证),
    // 否则这段证明的是「这行一直缺证」,不是「金标把摆设的门压住了」。
    writeCases(2);
    const thin = await runChapterQc(deps, { projectId: seriesId, chapterId });
    expect(thin!.calibration!.caseCount).toBe(2);
    expect(thin!.calibration!.caseScores!.find((row) => row.requirementId === "no-blackout"))
      .toMatchObject({ redTotal: 2, redCaught: 0 });
    const thinRow = thin!.requirements!.find((item) => item.requirementId === "no-blackout");
    expect(thinRow?.verdict).toBe("pass");
    expect(thinRow?.note).toContain("负例 0/2 条抓到");
    expect(thinRow?.note).toContain(`负例不足 ${QC_CALIBRATION_MIN_RED_CASES} 条`);

    // 生产链读得到金标:第 3 条负例一进库,召回门就在这份报告里生效
    writeCases(3);
    const stamped = await runChapterQc(deps, { projectId: seriesId, chapterId });
    expect(stamped!.calibration!.caseScores!.find((row) => row.requirementId === "no-blackout"))
      .toMatchObject({ redTotal: 3, redCaught: 0 });
    const goldRow = stamped!.requirements!.find((item) => item.requirementId === "no-blackout");
    expect(goldRow?.verdict).toBe("unverified");
    // 压成缺证时账本进 missing(板上看得见理由),note 只剩这行自己的话
    expect(goldRow?.missing?.[0]).toContain("负例 0/3 条抓到");
    expect(goldRow?.missing?.[0]).toContain("这门是摆设");
    // 分数跟着掉(5 分权重不计分),放行位也关死
    expect(stamped!.dimensionScore!.deducted.some((row) => row.requirementId === "no-blackout")).toBe(true);

    const persisted = await readReport(deps, { projectId: seriesId, chapterId });
    expect(persisted?.calibration?.caseScores).toEqual(stamped!.calibration!.caseScores);
    expect(persisted?.requirements?.find((item) => item.requirementId === "no-blackout")?.verdict)
      .toBe("unverified");
  }, 240_000);

  itSidecar("配了 vadRuntime → 人脸侧车真跑一趟,证据进报告与三态板", async () => {
    const deps = {
      remotionWorkspaceRootForProject: () => dir,
      videoUseWorkspaceRootForProject: () => join(dir, "video-use"),
      dataRoot: join(dir, "data"),
      vadRuntime: { storageBasePath: () => sidecarStorageBase, backendRoot: sidecarBackendRoot },
    };
    const { mkdirSync, copyFileSync } = await import("node:fs");
    mkdirSync(join(dir, "outputs", "chapters", "c-face"), { recursive: true });
    copyFileSync(videoPath, join(dir, "outputs", "chapters", "c-face", "current.mp4"));

    const report = await runChapterQc(deps, { projectId: "p1", chapterId: "c-face" });
    expect(report).not.toBeNull();
    // testsrc2 是合成彩条,实测 24 帧全可解、0 张脸(与本机标定同口径)
    expect(report!.faceSignals).toMatchObject({ framesRead: 24, faceCount: 0 });
    const summary = report!.findings.find((finding) => finding.code === "chapter-qc.face.summary");
    expect(summary).toMatchObject({ layer: "vision", severity: "info" });
    // 零检出不 fail 也不 pass:人脸维缺自动证据,只能 unverified
    const row = report!.requirements?.find((item) => item.requirementId === "face-readability");
    expect(row?.verdict).toBe("unverified");
    expect(row?.missing?.[0]).toContain("零检出");
    // 零检出不该喊「不可判」warn(那是检到脸但太小才出的行),也不产生 blocker
    expect(report!.findings.some((finding) => finding.code === "chapter-qc.face.unreadable")).toBe(false);
    expect(report!.summary.blockers).toBe(0);
    // 落盘的 current.json 里 faceSignals 不丢(原子写 + schemaVersion 1)
    const persisted = await readReport(deps, { projectId: "p1", chapterId: "c-face" });
    expect(persisted?.faceSignals?.faceCount).toBe(0);
  }, 240_000);

  itSidecar("配了 render-plan → 人脸裁片侧车真跑一趟:台账进报告,无脸不算缺口,出成的帧才计覆盖", async () => {
    const deps = {
      remotionWorkspaceRootForProject: () => dir,
      videoUseWorkspaceRootForProject: () => join(dir, "video-use"),
      dataRoot: join(dir, "data"),
      vadRuntime: { storageBasePath: () => sidecarStorageBase, backendRoot: sidecarBackendRoot },
    };
    const { mkdirSync, copyFileSync, writeFileSync } = await import("node:fs");
    const chapterId = "c-crop";
    mkdirSync(join(dir, "outputs", "chapters", chapterId), { recursive: true });
    copyFileSync(videoPath, join(dir, "outputs", "chapters", chapterId, "current.mp4"));
    mkdirSync(join(dir, "jobs", "chapter", chapterId), { recursive: true });
    writeFileSync(
      join(dir, "jobs", "chapter", chapterId, "current-render-plan.json"),
      JSON.stringify({
        renderSettings: { fps: 30 },
        clips: [
          { id: "c1", trackKind: "video", startUs: 0, durationUs: 2_500_000, source: { kind: "storyboardVideo", evidence: { storyboardId: "sb-1" } } },
          { id: "c2", trackKind: "video", startUs: 2_500_000, durationUs: 2_500_000, source: { kind: "storyboardVideo", evidence: { storyboardId: "sb-2" } } },
          { id: "c3", trackKind: "video", startUs: 5_000_000, durationUs: 2_500_000, source: { kind: "storyboardVideo", evidence: { storyboardId: "sb-3" } } },
        ],
        transitions: [],
        effects: [],
      }),
      "utf-8",
    );
    // 分镜侧三镜 ready,否则结构层没有可比对的台账
    mkdirSync(join(dir, "data"), { recursive: true });
    const storePath = legacyStudioWorkflowStorePath(deps.dataRoot, "bb-crop");
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      state: {
        storyboards: [
          { id: "sb-1", episodeId: chapterId, duration: 2.5, state: "ready", videoDesc: "镜一" },
          { id: "sb-2", episodeId: chapterId, duration: 2.5, state: "ready", videoDesc: "镜二" },
          { id: "sb-3", episodeId: chapterId, duration: 2.5, state: "ready", videoDesc: "镜三" },
        ],
      },
    }), "utf-8");

    const report = await runChapterQc(deps, { projectId: "bb-crop", chapterId });
    expect(report).not.toBeNull();
    const vision = report!.vision!;
    // 3 镜中点 ⇒ 3 条裁片台账;testsrc2 无脸,全是 no-face(空证据,不是失败)
    expect(vision.faceCrops).toHaveLength(3);
    expect(vision.faceCrops!.map((crop) => crop.status)).toEqual(["no-face", "no-face", "no-face"]);
    expect(vision.faceCropReason).toBeUndefined();
    // 没出片就不许有 face 帧混进台账,frameCount 必须仍等于 frames.length(缺证门的算术前提)
    expect(vision.frames.some((frame) => frame.kind === "face")).toBe(false);
    expect(vision.frameCount).toBe(vision.frames.length);

    const summary = report!.findings.find((item) => item.code === "chapter-qc.face.crop");
    expect(summary).toMatchObject({ layer: "vision", severity: "info" });
    expect(summary?.evidence).toMatchObject({ produced: 0, noFace: 3, gaps: 0, requested: 3 });
    expect(report!.findings.some((item) => item.code === "chapter-qc.face.crop-gap")).toBe(false);

    const row = report!.requirements?.find((item) => item.requirementId === "face-readability");
    expect(row?.watchedCodes).toContain("chapter-qc.face.crop");
    expect(row?.verdict).toBe("unverified"); // 零检出:侧车在位但五官维仍无自动证据
    // 台账计数跟着板走:人物行 note 里能看见「这一章的特写到底出了几张」
    expect(report!.requirements?.find((item) => item.requirementId === "character-integrity")?.note)
      .toContain("本镜无脸 3");

    const persisted = await readReport(deps, { projectId: "bb-crop", chapterId });
    expect(persisted?.vision?.faceCrops).toEqual(vision.faceCrops);
  }, 240_000);
});

/** 库里一条打标金标:人答「有没有」,机器当时那半边由写入口快照进来。 */
function goldCase(
  index: number,
  requirementId: string,
  label: "green" | "red",
  verdict: ChapterQcRequirementVerdict,
): ChapterQcCalibrationCaseV1 {
  const videoSha256 = index.toString(16).padStart(64, "0");
  return {
    caseId: calibrationCaseId(videoSha256, requirementId),
    videoSha256,
    requirementId,
    label,
    verdict,
    at: 1_700_000_000_000 + index,
    note: "金标夹具",
  };
}

function countSignalSamples(workspaceRoot: string, seriesId: string, signalId: string): number {
  return readCalibrationStore(workspaceRoot, seriesId).samples.filter((item) => item.signalId === signalId).length;
}
