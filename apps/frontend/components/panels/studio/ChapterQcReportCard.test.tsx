// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ready: true,
  runVisionPreflight: vi.fn(),
}));

vi.mock("@/lib/ai/feature-router", () => ({
  isFeatureReady: () => mocks.ready,
  callFeatureMultimodalAPI: vi.fn(),
}));

vi.mock("@/lib/studio/qc/vision-preflight-runner", () => ({
  runVisionPreflight: mocks.runVisionPreflight,
}));

import { ChapterQcReportCard } from "./ChapterQcReportCard";

function report(
  preflight?: { checked: number; passed: number; failed: number; skipped: number; finishedAt: number },
  identity: { projectId?: string; chapterId?: string; createdAt?: number } = {},
) {
  const projectId = identity.projectId ?? "p1";
  return {
    schemaVersion: 1,
    projectId,
    chapterId: identity.chapterId ?? "c1",
    createdAt: identity.createdAt ?? 100,
    layers: {
      structural: { status: "passed" },
      ffmpegScan: { status: "passed" },
      aesthetic: { status: "skipped" },
      semantic: { status: "passed" },
      vision: { status: "passed" },
    },
    findings: [],
    summary: { blockers: 0, warns: 0, infos: 0 },
    vision: {
      frameCount: 1,
      frames: [{ shotId: "s1", ordinal: 1, kind: "mid" as const, tS: 1, frameUrl: `project-file://${projectId}/f.jpg` }],
      decisions: [{ shotId: "s1", ordinal: 1, description: "晏燎拔剑", effects: [] }],
      densityChecked: 0,
      frameErrors: 0,
      ...(preflight ? { preflight } : {}),
    },
  };
}

function visionOutcome() {
  return {
    results: [],
    findings: [{
      code: "chapter-qc.vision.preflight.decorative-clutter",
      layer: "vision",
      severity: "warn",
      shotId: "s1",
      shotOrdinal: 1,
      message: "第 1 镜 mid：装饰遮挡主体",
      evidence: { source: "vision-preflight" },
    }],
    stats: { checked: 1, passed: 0, failed: 1, skipped: 0 },
  };
}

beforeEach(() => {
  mocks.ready = true;
  mocks.runVisionPreflight.mockReset();
  mocks.runVisionPreflight.mockResolvedValue(visionOutcome());
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "chapterQc");
  Reflect.deleteProperty(window, "projectFiles");
});

describe("ChapterQcReportCard AC4 vision preflight", () => {
  it("报告有物料且图片理解就绪时自动预审并按 createdAt 独立回写", async () => {
    const getReport = vi.fn(async () => report());
    const submitVisionPreflight = vi.fn(async () => ({ success: true }));
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: { getReport, run: vi.fn(), submitSemantic: vi.fn(), submitVisionPreflight, onReportUpdated: vi.fn(() => vi.fn()) },
    });
    Object.defineProperty(window, "projectFiles", {
      configurable: true,
      value: { readAsBase64: vi.fn(async () => ({ success: true, base64: "data:image/jpeg;base64,x" })) },
    });

    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);
    await waitFor(() => expect(submitVisionPreflight).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 100,
      stats: { checked: 1, passed: 0, failed: 1, skipped: 0 },
    })));
    expect(mocks.runVisionPreflight).toHaveBeenCalledWith(expect.objectContaining({
      frames: report().vision.frames,
      decisions: report().vision.decisions,
    }));
  });

  it("图片理解未配置时诚实显示跳过且不阻塞人工确认链", async () => {
    mocks.ready = false;
    const submitVisionPreflight = vi.fn();
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: { getReport: vi.fn(async () => report()), run: vi.fn(), submitSemantic: vi.fn(), submitVisionPreflight, onReportUpdated: vi.fn(() => vi.fn()) },
    });
    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);
    expect(await screen.findByText("未配置图片理解模型，审片预审暂不可用；仍可人工确认。" )).toBeTruthy();
    expect(submitVisionPreflight).not.toHaveBeenCalled();
  });

  it("项目切换后相同 chapterId/createdAt 仍使用新项目报告重新预审", async () => {
    const getReport = vi.fn(async (payload: { projectId: string; chapterId: string }) =>
      report(undefined, { projectId: payload.projectId, chapterId: payload.chapterId }));
    const submitVisionPreflight = vi.fn(async () => ({ success: true }));
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: { getReport, run: vi.fn(), submitSemantic: vi.fn(), submitVisionPreflight, onReportUpdated: vi.fn(() => vi.fn()) },
    });

    const view = render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);
    await waitFor(() => expect(submitVisionPreflight).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1" })));

    view.rerender(<ChapterQcReportCard projectId="p2" chapterId="c1" />);
    await waitFor(() => expect(submitVisionPreflight).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p2" })));
    expect(mocks.runVisionPreflight).toHaveBeenNthCalledWith(2, expect.objectContaining({
      frames: report(undefined, { projectId: "p2" }).vision.frames,
    }));
  });

  it("切换报告后丢弃旧项目尚未完成的预审结果", async () => {
    let releaseRun!: (value: ReturnType<typeof visionOutcome>) => void;
    mocks.runVisionPreflight.mockImplementationOnce(() => new Promise((resolve) => {
      releaseRun = resolve;
    }));
    const getReport = vi.fn(async (payload: { projectId: string }) =>
      payload.projectId === "p1"
        ? report(undefined, { projectId: "p1" })
        : report({ checked: 4, passed: 3, failed: 1, skipped: 0, finishedAt: 123 }, { projectId: "p2" }));
    const submitVisionPreflight = vi.fn(async () => ({ success: true }));
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: { getReport, run: vi.fn(), submitSemantic: vi.fn(), submitVisionPreflight, onReportUpdated: vi.fn(() => vi.fn()) },
    });

    const view = render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);
    await waitFor(() => expect(mocks.runVisionPreflight).toHaveBeenCalledOnce());
    view.rerender(<ChapterQcReportCard projectId="p2" chapterId="c1" />);
    expect(await screen.findByText("审片预审：3/4 项通过，1 项需人工复核")).toBeTruthy();

    await act(async () => releaseRun(visionOutcome()));
    expect(submitVisionPreflight).not.toHaveBeenCalled();
    expect(screen.getByText("审片预审：3/4 项通过，1 项需人工复核")).toBeTruthy();
  });

  it("已有预审结果时显示统计且不自动重复调用", async () => {
    const existing = report({ checked: 4, passed: 3, failed: 1, skipped: 0, finishedAt: 123 });
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: { getReport: vi.fn(async () => existing), run: vi.fn(), submitSemantic: vi.fn(), submitVisionPreflight: vi.fn(), onReportUpdated: vi.fn(() => vi.fn()) },
    });
    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);
    expect(await screen.findByText("审片预审：3/4 项通过，1 项需人工复核")).toBeTruthy();
    expect(mocks.runVisionPreflight).not.toHaveBeenCalled();
  });
});

function boardReport(humanReview?: { fullWatched: boolean; audioListened: boolean; reviewer: string; at: number }) {
  const rows = [
    { requirementId: "no-blackout", label: "无异常黑场", verdict: "pass" as const, watchedCodes: [], evidenceCodes: [] },
    {
      requirementId: "real-motion",
      label: "画面有真动态(伪动态门)",
      verdict: "unverified" as const,
      watchedCodes: [],
      evidenceCodes: [],
      missing: ["阈值未标定(先记不判)"],
      note: "已记录 TI 均值 9.9",
    },
    humanReview
      ? {
          requirementId: "human-full-watch",
          label: "人眼全速看全片 + 人耳听全轨",
          verdict: humanReview.fullWatched && humanReview.audioListened ? ("pass" as const) : ("unverified" as const),
          watchedCodes: [],
          evidenceCodes: [],
          ...(humanReview.fullWatched && humanReview.audioListened
            ? { note: `复核人 ${humanReview.reviewer}` }
            : { missing: ["世事 的复核未确认「人耳听完全轨」"] }),
        }
      : {
          requirementId: "human-full-watch",
          label: "人眼全速看全片 + 人耳听全轨",
          verdict: "unverified" as const,
          watchedCodes: [],
          evidenceCodes: [],
          missing: ["尚无人工复核回写:须人眼全速看全片 + 人耳听全轨"],
        },
  ];
  return { ...report(undefined, { createdAt: 100 }), requirements: rows, ...(humanReview ? { humanReview } : {}) };
}

describe("ChapterQcReportCard 三态验收板与人工复核", () => {
  it("逐行渲染 pass/缺证并写明缺什么,未放行列不算通过", async () => {
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: { getReport: vi.fn(async () => boardReport()), run: vi.fn(), submitSemantic: vi.fn(), submitVisionPreflight: vi.fn(), onReportUpdated: vi.fn(() => vi.fn()) },
    });
    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);

    expect(await screen.findByText("三态验收")).toBeTruthy();
    expect(screen.getByText("不放行")).toBeTruthy();
    expect(screen.getByText("通过 1 · 越限 0 · 缺证 2(缺证不计通过)")).toBeTruthy();
    expect(screen.getByText("缺:阈值未标定(先记不判)")).toBeTruthy();
    expect(screen.getByText("缺:尚无人工复核回写:须人眼全速看全片 + 人耳听全轨")).toBeTruthy();
    expect(screen.getAllByText("通过").length).toBeGreaterThan(0);
  });

  it("两问分列勾选 + 署名回写,主进程派生通过后显示复核人", async () => {
    const signed = boardReport({ fullWatched: true, audioListened: true, reviewer: "世事", at: 1_700_000_000_000 });
    const submitHumanReview = vi.fn(async () => ({ success: true }));
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: {
        getReport: vi.fn(async () => (submitHumanReview.mock.calls.length === 0 ? boardReport() : signed)),
        run: vi.fn(),
        submitSemantic: vi.fn(),
        submitVisionPreflight: vi.fn(),
        submitHumanReview,
        onReportUpdated: vi.fn(() => vi.fn()),
      },
    });
    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);

    fireEvent.click(await screen.findByLabelText("人眼全速看全片"));
    fireEvent.click(screen.getByLabelText("人耳听全轨"));
    fireEvent.change(screen.getByLabelText("复核人"), { target: { value: "世事" } });
    fireEvent.click(screen.getByRole("button", { name: "提交复核" }));

    await waitFor(() => expect(submitHumanReview).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 100,
      fullWatched: true,
      audioListened: true,
      reviewer: "世事",
    })));
    expect(await screen.findByText(/^已记:世事/)).toBeTruthy();
    expect(screen.getByText("不放行")).toBeTruthy();
  });

  it("未署名时本地拦下,不打 IPC;报告版本已变时回显主进程的陈旧提示", async () => {
    const submitHumanReview = vi.fn();
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: { getReport: vi.fn(async () => boardReport()), run: vi.fn(), submitSemantic: vi.fn(), submitVisionPreflight: vi.fn(), submitHumanReview, onReportUpdated: vi.fn(() => vi.fn()) },
    });
    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);

    fireEvent.click(await screen.findByRole("button", { name: "提交复核" }));
    expect(await screen.findByText("请先填写复核人")).toBeTruthy();
    expect(submitHumanReview).not.toHaveBeenCalled();

    submitHumanReview.mockResolvedValueOnce({ success: false, message: "QC 报告已更新(片子或分层结果重跑过),请重新看一遍再确认" });
    fireEvent.change(screen.getByLabelText("复核人"), { target: { value: "世事" } });
    fireEvent.click(screen.getByRole("button", { name: "提交复核" }));
    expect(
      await screen.findByText("QC 报告已更新(片子或分层结果重跑过),请重新看一遍再确认"),
    ).toBeTruthy();
  });

  it("旧报告未带验收板时不渲染空板,也不显示复核表单", async () => {
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: { getReport: vi.fn(async () => report()), run: vi.fn(), submitSemantic: vi.fn(), submitVisionPreflight: vi.fn(), submitHumanReview: vi.fn(), onReportUpdated: vi.fn(() => vi.fn()) },
    });
    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);
    await screen.findByText("四层检查无异常发现。");
    expect(screen.queryByText("三态验收")).toBeNull();
    expect(screen.queryByRole("button", { name: "提交复核" })).toBeNull();
  });
});
