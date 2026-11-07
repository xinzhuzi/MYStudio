// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterQcCalibrationStoreV1 } from "@rendering/plugins/videoqc/chapter-qc-calibration";
import { buildShotExpectations } from "@rendering/plugins/videoqc/chapter-qc-expectations";
import type { ChapterQcCalibrationCaseV1, ChapterQcReportV1 } from "@rendering/plugins/videoqc/chapter-qc-types";

type IpcHandler = (...args: unknown[]) => unknown;
const state = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  removed: [] as string[],
  report: null as ChapterQcReportV1 | null,
  write: vi.fn(),
  send: vi.fn(),
  stores: new Map<string, ChapterQcCalibrationStoreV1>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => state.handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => {
      state.removed.push(channel);
      state.handlers.delete(channel);
    }),
  },
}));

vi.mock("@rendering/plugins/videoqc/chapter-qc-orchestrator", () => ({
  readReport: vi.fn(async () => state.report),
}));

vi.mock("@rendering/plugins/videoqc/chapter-qc-report-store", () => ({
  writeChapterQcReport: state.write,
}));

// 标定库换成内存件:upsert/打分/blocker 全用真实现,只把落盘口接进 Map(测试不碰 /tmp)。
vi.mock("@rendering/plugins/videoqc/chapter-qc-calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rendering/plugins/videoqc/chapter-qc-calibration")>();
  return {
    ...actual,
    readCalibrationStore: (workspaceRoot: string, seriesId: string): ChapterQcCalibrationStoreV1 =>
      state.stores.get(`${workspaceRoot}/${seriesId}`) ?? { schemaVersion: 1, seriesId, samples: [], cases: [] },
    writeCalibrationStore: (workspaceRoot: string, store: ChapterQcCalibrationStoreV1): void => {
      state.stores.set(`${workspaceRoot}/${store.seriesId}`, store);
    },
  };
});

import { registerChapterQcIpcHandlers } from "./chapter-qc-ipc";
import { runVisionPreflight } from "@/lib/studio/qc/vision-preflight-runner";

function report(): ChapterQcReportV1 {
  return {
    schemaVersion: 1,
    projectId: "p1",
    chapterId: "c1",
    outputPath: "/tmp/current.mp4",
    outputSha256: "sha-current",
    createdAt: 100,
    layers: {
      structural: { status: "passed" },
      ffmpegScan: { status: "passed" },
      aesthetic: { status: "skipped" },
      semantic: { status: "passed" },
      vision: { status: "passed" },
    },
    findings: [
      { code: "chapter-qc.vision.transition-density", layer: "vision", severity: "warn", message: "密度", evidence: {} },
      { code: "chapter-qc.vision.preflight.old", layer: "vision", severity: "warn", message: "旧", evidence: { source: "vision-preflight" } },
    ],
    summary: { blockers: 0, warns: 2, infos: 0 },
    vision: {
      frameCount: 1,
      frames: [{ shotId: "s1", ordinal: 1, kind: "mid", tS: 1, frameUrl: "project-file://p1/f.jpg" }],
      decisions: [{ shotId: "s1", ordinal: 1, effects: [] }],
      densityChecked: 1,
      frameErrors: 0,
    },
  };
}

beforeEach(() => {
  state.handlers.clear();
  state.removed.length = 0;
  state.stores.clear();
  state.report = report();
  state.write.mockReset();
  state.send.mockReset();
});

describe("chapter QC vision preflight IPC", () => {
  it("独立回写预审 finding，保留确定性 vision finding 并拒绝陈旧报告", async () => {
    const registration = registerChapterQcIpcHandlers({
      deps: {
        remotionWorkspaceRootForProject: () => "/tmp/remotion",
        videoUseWorkspaceRootForProject: () => "/tmp/video-use",
        dataRoot: "/tmp/data",
      },
      runQc: vi.fn(),
      getWindow: () => ({ webContents: { send: state.send } }) as never,
    });
    const handler = state.handlers.get("chapter-qc-submit-vision-preflight");
    expect(handler).toBeTypeOf("function");

    await expect(handler!({}, {
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 100,
      stats: { checked: 1, passed: 0, failed: 0, skipped: 0 },
      findings: [],
    })).resolves.toEqual({ success: false, message: "stats 计数不一致" });

    await expect(handler!({}, {
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 99,
      stats: { checked: 1, passed: 0, failed: 1, skipped: 0 },
      findings: [],
    })).resolves.toEqual({ success: false, message: "QC 报告已更新,请重新预审" });
    expect(state.write).not.toHaveBeenCalled();

    await expect(handler!({}, {
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 100,
      model: "provider/model",
      stats: { checked: 1, passed: 0, failed: 1, skipped: 0 },
      findings: [{
        code: "chapter-qc.vision.preflight.black-or-garbled",
        severity: "blocker",
        shotId: "s1",
        shotOrdinal: 1,
        message: "第 1 镜黑屏",
        evidence: { frameKind: "mid", tS: 1 },
      }],
    })).resolves.toEqual({ success: true });

    expect(state.report?.findings.map((finding) => finding.code)).toEqual([
      "chapter-qc.vision.transition-density",
      "chapter-qc.vision.preflight.black-or-garbled",
    ]);
    expect(state.report?.vision?.preflight).toMatchObject({
      checked: 1,
      failed: 1,
      model: "provider/model",
    });
    expect(state.report?.summary).toEqual({ blockers: 1, warns: 1, infos: 0 });
    expect(state.write).toHaveBeenCalledOnce();
    expect(state.send).toHaveBeenCalledWith("chapter-qc-report-updated", { projectId: "p1", chapterId: "c1" });

    registration.dispose();
    expect(state.removed).toContain("chapter-qc-submit-vision-preflight");
  });

  it("真预审产物落库:检出的人脸异常存活,缺证维度不冒充通过", async () => {
    // 覆盖不全时「已查出的真人物异常」与「未查清的其余维度」必须同时成立——
    // 前者不许被后者抹平,后者不许被前者顺手放行。
    const frames = [
      { shotId: "s1", ordinal: 1, kind: "mid" as const, tS: 1, frameUrl: "project-file://p1/f1.jpg" },
      { shotId: "s2", ordinal: 2, kind: "mid" as const, tS: 3, frameUrl: "project-file://p1/f2.jpg" },
    ];
    const decisions = [
      { shotId: "s1", ordinal: 1, effects: [] },
      { shotId: "s2", ordinal: 2, effects: [] },
    ];
    state.report = { ...report(), findings: [], vision: { frameCount: 2, frames, decisions, densityChecked: 0, frameErrors: 0 } };

    let singleTurn = 0;
    const outcome = await runVisionPreflight({
      frames,
      decisions,
      readFrameDataUrl: async () => "data:image/jpeg;base64,AA==",
      call: async (messages) => {
        const parts = messages[0]?.content;
        const imageCount = Array.isArray(parts) ? parts.filter((part) => part.type === "image_url").length : 0;
        if (imageCount === 2) throw new Error("图片理解服务不可达");
        singleTurn += 1;
        return singleTurn === 1
          ? '{"pass":false,"issues":[{"code":"face-anomaly","severity":"blocker","reason":"额头多出一张嘴"}]}'
          : '{"pass":null,"issues":[],"reason":"脸部像素化,五官不可辨"}';
      },
    });
    expect(outcome.stats).toEqual({ checked: 1, passed: 0, failed: 1, skipped: 2 });

    const registration = registerChapterQcIpcHandlers({
      deps: {
        remotionWorkspaceRootForProject: () => "/tmp/remotion",
        videoUseWorkspaceRootForProject: () => "/tmp/video-use",
        dataRoot: "/tmp/data",
      },
      runQc: vi.fn(),
      getWindow: () => ({ webContents: { send: state.send } }) as never,
    });
    await expect(state.handlers.get("chapter-qc-submit-vision-preflight")!({}, {
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 100,
      model: "provider/vision",
      stats: outcome.stats,
      findings: outcome.findings,
    })).resolves.toEqual({ success: true });

    expect(state.report?.vision?.preflight).toMatchObject({ checked: 1, passed: 0, failed: 1, skipped: 2, model: "provider/vision" });
    expect(state.report?.findings.filter((finding) => finding.code.endsWith("face-anomaly")).map((finding) => finding.shotOrdinal)).toEqual([1]);
    expect(state.report?.findings.filter((finding) => finding.code.endsWith("incomplete")).map((finding) => finding.severity)).toEqual(["info", "info"]);
    expect(state.report?.summary).toEqual({ blockers: 1, warns: 0, infos: 2 });

    const byId = new Map((state.report?.requirements ?? []).map((item) => [item.requirementId, item]));
    expect(byId.get("character-integrity")?.verdict).toBe("fail");
    expect(byId.get("character-integrity")?.failingShotOrdinals).toEqual([1]);
    for (const id of ["vision-reviewed", "text-integrity", "cross-shot-coherence"]) {
      expect(byId.get(id)?.verdict).toBe("unverified");
      expect(byId.get(id)?.missing).toEqual(["视觉预审覆盖不全：应检查 3 次 / 已检查 1 / 缺证或跳过 2"]);
    }
    expect(state.write).toHaveBeenCalledOnce();
    expect(state.send).toHaveBeenCalledWith("chapter-qc-report-updated", { projectId: "p1", chapterId: "c1" });
    registration.dispose();
  });
});

describe("chapter QC human review IPC", () => {
  it("签全两问才把 human-full-watch 从缺证翻成通过,缺项/署名/陈旧报告一律拒收", async () => {
    const registration = registerChapterQcIpcHandlers({
      deps: {
        remotionWorkspaceRootForProject: () => "/tmp/remotion",
        videoUseWorkspaceRootForProject: () => "/tmp/video-use",
        dataRoot: "/tmp/data",
      },
      runQc: vi.fn(),
      getWindow: () => ({ webContents: { send: state.send } }) as never,
    });
    const handler = state.handlers.get("chapter-qc-submit-human-review");
    expect(handler).toBeTypeOf("function");

    await expect(handler!({}, { projectId: "p1", chapterId: "c1", expectedCreatedAt: 100, fullWatched: true, audioListened: true }))
      .resolves.toEqual({ success: false, message: "复核人必填(≤80 字)" });
    await expect(handler!({}, { projectId: "p1", chapterId: "c1", expectedCreatedAt: 100, fullWatched: "yes", audioListened: true, reviewer: "世事" }))
      .resolves.toEqual({ success: false, message: "fullWatched/audioListened 必须是布尔" });
    await expect(handler!({}, { projectId: "p1", chapterId: "c1", expectedCreatedAt: 99, fullWatched: true, audioListened: true, reviewer: "世事" }))
      .resolves.toEqual({ success: false, message: "QC 报告已更新(片子或分层结果重跑过),请重新看一遍再确认" });
    expect(state.write).not.toHaveBeenCalled();

    await expect(handler!({}, {
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 100,
      fullWatched: true,
      audioListened: false,
      reviewer: " 世事 ",
      notes: "口型在 #4 镜偏半拍",
    })).resolves.toEqual({ success: true });

    expect(state.report?.humanReview).toMatchObject({ fullWatched: true, audioListened: false, reviewer: "世事" });
    const half = state.report?.requirements?.find((item) => item.requirementId === "human-full-watch");
    expect(half?.verdict).toBe("unverified");
    expect(half?.missing).toEqual(["世事 的复核未确认「人耳听完全轨」"]);

    await handler!({}, {
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 100,
      fullWatched: true,
      audioListened: true,
      reviewer: "世事",
    });
    const signed = state.report?.requirements?.find((item) => item.requirementId === "human-full-watch");
    expect(signed?.verdict).toBe("pass");
    expect(signed?.note).toContain("复核人 世事");
    expect(state.write).toHaveBeenCalledTimes(2);
    expect(state.send).toHaveBeenLastCalledWith("chapter-qc-report-updated", { projectId: "p1", chapterId: "c1" });

    registration.dispose();
    expect(state.removed).toContain("chapter-qc-submit-human-review");
  });
});

describe("chapter QC calibration case IPC(逐行打标金标)", () => {
  /** 人物门在这一版证据下确实拿到 pass:预审覆盖齐(1 帧 + 1 决策 ⇒ 应查 1 次)、空镜声明排除了口型缺证。 */
  function goldReport(): ChapterQcReportV1 {
    return {
      ...report(),
      vision: {
        frameCount: 1,
        frames: [{ shotId: "s1", ordinal: 1, kind: "mid", tS: 1, frameUrl: "project-file://p1/f.jpg" }],
        decisions: [{ shotId: "s1", ordinal: 1, effects: [] }],
        densityChecked: 0,
        frameErrors: 0,
        preflight: { checked: 1, passed: 1, failed: 0, skipped: 0, finishedAt: 1 },
      },
      expectations: buildShotExpectations([{ shotId: "s1", ordinal: 1, durationS: 2, personFree: true }]),
      requirements: [{ requirementId: "character-integrity", label: "占位", verdict: "pass", watchedCodes: [], evidenceCodes: [] }],
      calibration: { seriesId: "p1", baselines: [], caseCount: 0 },
    };
  }

  function goldCase(videoSha256: string, at: number): ChapterQcCalibrationCaseV1 {
    return {
      caseId: `${videoSha256}:character-integrity`,
      videoSha256,
      requirementId: "character-integrity",
      label: "red",
      verdict: "pass",
      at,
      note: "别章已打过的负例",
    };
  }

  const row = () => state.report?.requirements?.find((item) => item.requirementId === "character-integrity");
  const score = () => (state.report?.calibration?.caseScores ?? []).find((item) => item.requirementId === "character-integrity");

  it("只收「有没有」:机器那半边从报告抄,重打覆盖同 caseId,负例攒满三条全放过就当众压掉 pass", async () => {
    state.report = goldReport();
    state.stores.set("/tmp/remotion/p1", {
      schemaVersion: 1,
      seriesId: "p1",
      samples: [],
      cases: [goldCase("b".repeat(64), 1), goldCase("c".repeat(64), 2)],
    });
    const registration = registerChapterQcIpcHandlers({
      deps: {
        remotionWorkspaceRootForProject: () => "/tmp/remotion",
        videoUseWorkspaceRootForProject: () => "/tmp/video-use",
        dataRoot: "/tmp/data",
      },
      runQc: vi.fn(),
      getWindow: () => ({ webContents: { send: state.send } }) as never,
    });
    const handler = state.handlers.get("chapter-qc-submit-calibration-case");
    expect(handler).toBeTypeOf("function");

    await expect(handler!({}, { projectId: "p1", chapterId: "c1", expectedCreatedAt: 100, requirementId: "character-integrity", label: "maybe" }))
      .resolves.toEqual({ success: false, message: "label 只能是 red(真有问题)/ green(没问题)" });
    await expect(handler!({}, { projectId: "p1", chapterId: "c1", expectedCreatedAt: 100, requirementId: "../evil", label: "red" }))
      .resolves.toEqual({ success: false, message: "requirementId 非法" });
    await expect(handler!({}, { projectId: "p1", chapterId: "c1", expectedCreatedAt: 99, requirementId: "character-integrity", label: "red" }))
      .resolves.toEqual({ success: false, message: "QC 报告已更新,请按当前这一版重新打标" });
    await expect(handler!({}, { projectId: "p1", chapterId: "c1", expectedCreatedAt: 100, requirementId: "no-such-row", label: "red" }))
      .resolves.toEqual({ success: false, message: "这份报告没有「no-such-row」这一行,请先重跑 QC" });
    expect(state.write).not.toHaveBeenCalled();
    expect(state.stores.get("/tmp/remotion/p1")?.cases).toHaveLength(2);

    // 负例只有 2 条:不够判这门是摆设,只记账不改判(否则标定初期整块板自我否决)。
    await expect(handler!({}, {
      projectId: "p1", chapterId: "c1", expectedCreatedAt: 100, requirementId: "character-integrity", label: "green",
      verdict: "fail", // 渲染端伪造机器判定:必须被忽略,那半边只从报告抄
    })).resolves.toEqual({ success: true });
    expect(row()?.verdict).toBe("pass");
    expect(score()).toMatchObject({ greenTotal: 1, greenPassed: 1, redTotal: 2, redCaught: 0 });
    expect(row()?.note).toContain("负例 0/2 条抓到");
    const stored = state.stores.get("/tmp/remotion/p1")!.cases;
    expect(stored).toHaveLength(3);
    expect(stored.find((item) => item.videoSha256 === "sha-current")).toMatchObject({ label: "green", verdict: "pass" });

    // 改主意重打:同 caseId 覆盖(不是追加),第三条负例落库 ⇒ 三门全漏,pass 当场不认。
    await expect(handler!({}, { projectId: "p1", chapterId: "c1", expectedCreatedAt: 100, requirementId: "character-integrity", label: "red" }))
      .resolves.toEqual({ success: true });
    expect(state.stores.get("/tmp/remotion/p1")!.cases).toHaveLength(3);
    expect(score()).toMatchObject({ greenTotal: 0, redTotal: 3, redCaught: 0 });
    expect(row()?.verdict).toBe("unverified");
    expect(row()?.missing?.some((line) => line.includes("这门一条没抓到"))).toBe(true);
    expect(state.write).toHaveBeenCalledTimes(2);
    expect(state.send).toHaveBeenLastCalledWith("chapter-qc-report-updated", { projectId: "p1", chapterId: "c1" });

    registration.dispose();
    expect(state.removed).toContain("chapter-qc-submit-calibration-case");
  });

  it("报告没成片哈希 / 没有标定块时拒收:金标不许锚到不知道是哪支片子的证据上", async () => {
    const registration = registerChapterQcIpcHandlers({
      deps: {
        remotionWorkspaceRootForProject: () => "/tmp/remotion",
        videoUseWorkspaceRootForProject: () => "/tmp/video-use",
        dataRoot: "/tmp/data",
      },
      runQc: vi.fn(),
      getWindow: () => ({ webContents: { send: state.send } }) as never,
    });
    const handler = state.handlers.get("chapter-qc-submit-calibration-case")!;

    state.report = { ...goldReport(), outputSha256: undefined };
    await expect(handler({}, { projectId: "p1", chapterId: "c1", expectedCreatedAt: 100, requirementId: "character-integrity", label: "red" }))
      .resolves.toEqual({ success: false, message: "报告没有成片哈希,金标无法锚定到片子上,请重跑 QC" });

    state.report = { ...goldReport(), calibration: undefined };
    await expect(handler({}, { projectId: "p1", chapterId: "c1", expectedCreatedAt: 100, requirementId: "character-integrity", label: "red" }))
      .resolves.toEqual({ success: false, message: "这份报告早于标定骨干(无标定块),请重跑 QC 后再打标" });

    expect(state.stores.size).toBe(0);
    expect(state.write).not.toHaveBeenCalled();
    registration.dispose();
  });
});
