// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
