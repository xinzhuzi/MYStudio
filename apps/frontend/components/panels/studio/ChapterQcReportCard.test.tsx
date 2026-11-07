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
import { dimensionSpec } from "@rendering/plugins/videoqc/chapter-qc-registry";

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
  // 行的 label/category/evaluator/weight 一律从注册表取:UI 分组按真源渲染,夹具不手抄
  const fromRegistry = (requirementId: string, row: Record<string, unknown>) => {
    const spec = dimensionSpec(requirementId)!;
    return {
      requirementId,
      label: spec.label,
      watchedCodes: [],
      evidenceCodes: [],
      category: spec.category,
      evaluator: spec.evaluator,
      weight: spec.weight,
      ...row,
    };
  };
  const rows = [
    fromRegistry("no-blackout", { verdict: "pass" as const }),
    fromRegistry("real-motion", {
      verdict: "unverified" as const,
      missing: ["阈值未标定(先记不判)"],
      note: "已记录 TI 均值 9.9",
    }),
    humanReview
      ? fromRegistry("human-full-watch", {
          verdict: humanReview.fullWatched && humanReview.audioListened ? ("pass" as const) : ("unverified" as const),
          ...(humanReview.fullWatched && humanReview.audioListened
            ? { note: `复核人 ${humanReview.reviewer}` }
            : { missing: [`世事 的复核未确认「人耳听完全轨」`] }),
        })
      : fromRegistry("human-full-watch", {
          verdict: "unverified" as const,
          missing: ["尚无人工复核回写:须人眼全速看全片 + 人耳听全轨"],
        }),
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

  it("板按注册表分组:组标题走注册表顺序,行带评价器与权重;报告里的三行不会自成一列", async () => {
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: { getReport: vi.fn(async () => boardReport()), run: vi.fn(), submitSemantic: vi.fn(), submitVisionPreflight: vi.fn(), onReportUpdated: vi.fn(() => vi.fn()) },
    });
    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);
    await screen.findByText("三态验收");

    const headers = screen.getAllByText(/^(画面质量|动态|人证)$/).map((node) => node.textContent);
    expect(headers).toEqual(["画面质量", "动态", "人证"]);
    // 行右侧:评价器显示名 + 注册表权重
    expect(screen.getAllByText("自研确定性信号").length).toBeGreaterThan(0);
    expect(screen.getAllByText("人证回写").length).toBe(1);
    const blackoutRow = screen.getByText("无异常黑场").closest("div");
    expect(blackoutRow?.lastElementChild?.textContent).toBe("5");
    // 报告缺行时不硬凑:注册表 17 行只渲染报告里存在的那几行
    expect(screen.queryByText("成片时长与计划对齐")).toBeNull();
  });

  it("骨干三件各自一行:供给计数 / 逐镜期望 / 标定进度,注册表外的行单独点名", async () => {
    const backbone = {
      ...boardReport(),
      dimensionScore: { score: 9.0, weightTotal: 100, weightPassed: 9, deducted: [{ requirementId: "real-motion", weight: 5, reason: "unverified" as const }] },
      supplyChecks: {
        checks: [
          { checkId: "media-readable", label: "成片可解(ffprobe 出时长)", verdict: "ok" as const, detail: "8.00s / 30.00fps" },
          { checkId: "sidecar-vad", label: "Silero VAD 侧车可用", verdict: "gap" as const, detail: "语音段退回 silencedetect 补集" },
          { checkId: "subtitle-material", label: "台词镜有字幕物料", verdict: "blocked" as const, detail: "1 镜声明台词却零字幕 cue" },
        ],
        gaps: 1,
        blocked: 1,
      },
      expectations: {
        shots: [{ shotId: "sb-1", ordinal: 1, assertions: { motion: "expected" } }],
        coverage: [{ key: "motion", expected: 1, forbidden: 0, unknown: 0 }],
      },
      calibration: {
        seriesId: "p1",
        caseCount: 0,
        baselines: [
          // 画带凭别章 2 条、本系列已攒 7 条:两个数是两回事,UI 必须分开显示
          { signalId: "motion.tiMean", mean: 6, sigma: 0.6, sampleCount: 2, seriesSampleCount: 7 },
        ],
      },
      requirements: [
        ...boardReport().requirements,
        { requirementId: "ghost-row", label: "注册表外的历史行", verdict: "fail" as const, watchedCodes: [], evidenceCodes: ["x"] },
      ],
      notes: ["no-workflow-store", "代表帧按清晰度择帧 1/1 镜(出曝光窗剔 0 帧候选,中点兜底 0 镜)"],
    };
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: { getReport: vi.fn(async () => backbone), run: vi.fn(), submitSemantic: vi.fn(), submitVisionPreflight: vi.fn(), onReportUpdated: vi.fn(() => vi.fn()) },
    });
    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);
    await screen.findByText("三态验收");

    expect(screen.getByText("计分 9")).toBeTruthy();
    expect(screen.getByText("供给 3 项:缺料 1 · 硬矛盾 1")).toBeTruthy();
    expect(screen.getByText("逐镜期望 1 镜 · 未声明 0 项")).toBeTruthy();
    expect(screen.getByText("信号标定 画带凭 别章最高 2/5 条(本系列已攒 7 条)· 打标集 0 条")).toBeTruthy();
    const calibTip = screen.getByTitle(/画带剔本章/);
    expect(calibTip.getAttribute("title")).toContain("画带凭别章 2 条,本系列已攒 7 条,含本章");
    expect(calibTip.getAttribute("title")).toContain("写入口就是每行末尾的「有问题/没问题」");
    expect(screen.getByText(/^注册表外 1 行:/)).toBeTruthy();
    // 取证留痕单独一行,但可见位只报条数:退化一趟能攒到 8~9 条且含异常原文,
    // 拼进这一行必然被 truncate 截掉——越该看的时候越看不全,所以正文只进 title。
    const trail = screen.getByText("取证留痕 2 条");
    expect(trail.textContent).not.toContain("no-workflow-store");
    const trailTip = screen.getByTitle(/取证口径/).getAttribute("title") ?? "";
    expect(trailTip).toContain("no-workflow-store");
    expect(trailTip).toContain("代表帧按清晰度择帧 1/1 镜");
  });
});

describe("ChapterQcReportCard 逐行打标金标", () => {
  /** 有一行已攒过金标的看板:按钮上的账要看得见,点下去只交「有没有」。 */
  function goldBoardReport() {
    return {
      ...boardReport(),
      calibration: {
        seriesId: "p1",
        caseCount: 2,
        baselines: [],
        caseScores: [{ requirementId: "no-blackout", greenTotal: 1, greenPassed: 1, redTotal: 1, redCaught: 0 }],
      },
    };
  }

  it("「有问题/没问题」两点即金标写入口:payload 只带行号与 label,不带机器判定", async () => {
    const submitCalibrationCase = vi.fn(async (_payload: Record<string, unknown>) => ({ success: true }));
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: {
        getReport: vi.fn(async () => goldBoardReport()),
        run: vi.fn(),
        submitSemantic: vi.fn(),
        submitVisionPreflight: vi.fn(),
        submitCalibrationCase,
        onReportUpdated: vi.fn(() => vi.fn()),
      },
    });
    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);

    const redButtons = await screen.findAllByRole("button", { name: "有问题" });
    // 板按注册表顺序渲染,首行是 no-blackout;每行都有两个按钮,不许只给一半行开口子。
    expect(redButtons.length).toBe(boardReport().requirements.length);
    expect(redButtons[0]!.getAttribute("title")).toContain("本行金标:负例 0/1 条抓到、正例 1/1 条放行");
    fireEvent.click(redButtons[0]!);
    await waitFor(() => expect(submitCalibrationCase).toHaveBeenCalledWith({
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 100,
      requirementId: "no-blackout",
      label: "red",
    }));
    expect(submitCalibrationCase.mock.calls[0][0]).not.toHaveProperty("verdict");
  });

  it("主进程拒收时把原话摆在板下(陈旧报告不许悄悄记一条金标)", async () => {
    const submitCalibrationCase = vi.fn(async () => ({ success: false, message: "QC 报告已更新,请按当前这一版重新打标" }));
    Object.defineProperty(window, "chapterQc", {
      configurable: true,
      value: {
        getReport: vi.fn(async () => goldBoardReport()),
        run: vi.fn(),
        submitSemantic: vi.fn(),
        submitVisionPreflight: vi.fn(),
        submitCalibrationCase,
        onReportUpdated: vi.fn(() => vi.fn()),
      },
    });
    render(<ChapterQcReportCard projectId="p1" chapterId="c1" />);
    const greenButtons = await screen.findAllByRole("button", { name: "没问题" });
    fireEvent.click(greenButtons[0]!);
    expect(await screen.findByText("QC 报告已更新,请按当前这一版重新打标")).toBeTruthy();
  });
});
