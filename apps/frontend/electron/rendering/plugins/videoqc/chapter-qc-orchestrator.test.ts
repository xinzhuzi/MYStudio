import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { runChapterQc, readReport } from "./chapter-qc-orchestrator";
import { resolveVadPythonExecutable } from "./chapter-qc-vad";
import { legacyStudioWorkflowStorePath } from "../../../storage/studio-workflow-store-io";
import { readCalibrationStore } from "./chapter-qc-calibration";
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

    // 报告落盘可读
    const persisted = await readReport(deps, { projectId: "p1", chapterId: "c-001" });
    expect(persisted?.summary).toEqual(report!.summary);
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
});

function countSignalSamples(workspaceRoot: string, seriesId: string, signalId: string): number {
  return readCalibrationStore(workspaceRoot, seriesId).samples.filter((item) => item.signalId === signalId).length;
}
