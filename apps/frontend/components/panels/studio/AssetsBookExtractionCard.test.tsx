// @vitest-environment jsdom
/**
 * C2 全书提取控制面板测试(AC1–AC4;父任务 D14/D25/R2/R7,design §7)。
 *
 * 组件订阅 runner 状态(台账轮询 + 单例在飞标记),本地零复制——测试直接
 * 驱动 useAssetsBookExtractionStore.setState 模拟 runner 各状态,断言按钮态/
 * 额度窗口/ETA/失败清单跳章/单章按钮联动禁用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const runnerMocks = vi.hoisted(() => ({
  runEntityExtraction: vi.fn(),
  pauseEntityExtraction: vi.fn((): boolean => true),
  isEntityExtractionInFlight: vi.fn((): boolean => false),
  createRunnerDeps: vi.fn(),
}));

vi.mock("@/lib/studio/entity-extraction-runner", () => ({
  runEntityExtraction: runnerMocks.runEntityExtraction,
  pauseEntityExtraction: runnerMocks.pauseEntityExtraction,
  isEntityExtractionInFlight: runnerMocks.isEntityExtractionInFlight,
  createRunnerDeps: runnerMocks.createRunnerDeps,
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    resolve: vi.fn(() => ({ provider: "openai-compatible", model: "glm-5.3" })),
  },
}));

vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => undefined,
}));

import {
  AssetsBookExtractionCard,
  computeExtractionEtaMs,
  deriveBookExtractionStatus,
  formatEtaMs,
  formatQuotaResetTime,
  useAssetsBookExtractionStore,
  type AssetsBookExtractionState,
} from "./AssetsBookExtractionCard";
import { AssetsBatchCard } from "./AssetsBatchCard";
import { useStudioStore } from "@/stores/studio/studio-store";

const initialBookState = useAssetsBookExtractionStore.getInitialState();
const realSwitchChapter = useStudioStore.getState().switchChapter;

function resetBookStore() {
  useAssetsBookExtractionStore.setState(initialBookState, true);
}

const COUNTS = { success: 3, failed: 1, skipped: 1, pending: 95 };

function setStore(patch: Partial<AssetsBookExtractionState>) {
  useAssetsBookExtractionStore.setState(patch);
}

const BUTTON_LABELS = {
  start: "开始提取",
  pause: "暂停",
  resume: "继续",
  retryFailed: "仅重跑失败",
  forceNew: "强制重提",
} as const;

type ButtonKey = keyof typeof BUTTON_LABELS;

function buttonDisabled(key: ButtonKey): boolean {
  const button = screen.getByRole("button", { name: BUTTON_LABELS[key] });
  return (button as HTMLButtonElement).disabled;
}

function expectButtons(expected: Record<ButtonKey, boolean>) {
  for (const key of Object.keys(BUTTON_LABELS) as ButtonKey[]) {
    expect(buttonDisabled(key), `${BUTTON_LABELS[key]} disabled=${expected[key]}`).toBe(
      expected[key],
    );
  }
}

/** 10-20 改版:完整面板住进详情弹窗——点头行入口打开后再断言面板内容。 */
async function openBookDialog() {
  fireEvent.click(screen.getByTestId("book-extraction-entry"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "开始提取" })).toBeTruthy(),
  );
}

beforeEach(() => {
  runnerMocks.runEntityExtraction.mockReset();
  runnerMocks.pauseEntityExtraction.mockClear();
  runnerMocks.isEntityExtractionInFlight.mockReturnValue(false);
  runnerMocks.createRunnerDeps.mockReset();
});

afterEach(() => {
  cleanup();
  resetBookStore();
  useStudioStore.setState({ switchChapter: realSwitchChapter });
});

describe("deriveBookExtractionStatus(台账状态 × 在飞标记 → 面板状态;D25)", () => {
  it("无台账=idle;在飞时按台账原样(running/quota_wait)", () => {
    expect(deriveBookExtractionStatus(null, false)).toBe("idle");
    expect(deriveBookExtractionStatus("running", true)).toBe("running");
    expect(deriveBookExtractionStatus("quota_wait", true)).toBe("quota_wait");
    // 在飞但台账已写 paused(暂停后当前章收尾窗口)→ 仍视作运行中
    expect(deriveBookExtractionStatus("paused", true)).toBe("running");
  });

  it("不在飞时 running/quota_wait 一律收口 paused(App 重启后无人确认不自动重跑)", () => {
    expect(deriveBookExtractionStatus("running", false)).toBe("paused");
    expect(deriveBookExtractionStatus("quota_wait", false)).toBe("paused");
    expect(deriveBookExtractionStatus("paused", false)).toBe("paused");
    expect(deriveBookExtractionStatus("done", false)).toBe("done");
  });
});

describe("computeExtractionEtaMs(近 20 章平均 × 剩余;额度窗口计入)", () => {
  function chapters(
    successMs: Record<string, number>,
    pending: string[] = [],
  ): Record<string, { state: string; ms?: number }> {
    const result: Record<string, { state: string; ms?: number }> = {};
    for (const [id, ms] of Object.entries(successMs)) result[id] = { state: "success", ms };
    for (const id of pending) result[id] = { state: "pending" };
    return result;
  }

  it("平均耗时 × 剩余 pending 数", () => {
    const data = chapters(
      { "chapter-001": 1000, "chapter-002": 1000, "chapter-003": 1000 },
      ["chapter-004", "chapter-005"],
    );
    expect(computeExtractionEtaMs({ chapters: data, nowMs: 0 })).toBe(2000);
  });

  it("只取最近 20 章成功耗时(更早的慢章不拉高均值)", () => {
    const successMs: Record<string, number> = {};
    for (let n = 1; n <= 25; n += 1) {
      successMs[`chapter-${String(n).padStart(3, "0")}`] = n <= 5 ? 10_000 : 1000;
    }
    const data = chapters(successMs, ["chapter-026", "chapter-027", "chapter-028"]);
    expect(computeExtractionEtaMs({ chapters: data, nowMs: 0 })).toBe(3000);
  });

  it("quota_wait 时叠加等待重置的剩余时间", () => {
    const data = chapters({ "chapter-001": 1000 }, ["chapter-002"]);
    expect(
      computeExtractionEtaMs({ chapters: data, nowMs: 1000, quotaWaitResumeAt: 61_000 }),
    ).toBe(61_000);
  });

  it("无成功样本或无剩余章 → null(无法估计)", () => {
    expect(computeExtractionEtaMs({ chapters: { "chapter-001": { state: "pending" } }, nowMs: 0 })).toBeNull();
    expect(
      computeExtractionEtaMs({ chapters: { "chapter-001": { state: "success", ms: 100 } }, nowMs: 0 }),
    ).toBeNull();
  });
});

describe("格式化", () => {
  it("formatEtaMs 分档秒/分钟/小时/天", () => {
    expect(formatEtaMs(10_000)).toBe("10 秒");
    expect(formatEtaMs(90_000)).toBe("2 分钟");
    expect(formatEtaMs(12_600_000)).toBe("3.5 小时");
    expect(formatEtaMs(259_200_000)).toBe("3.0 天");
  });

  it("formatQuotaResetTime 输出 HH:MM", () => {
    expect(formatQuotaResetTime(Date.UTC(2026, 9, 20, 12, 34, 0))).toMatch(
      /^([01]\d|2[0-3]):[0-5]\d$/,
    );
  });
});

describe("10-20 改版:入口按钮 + 详情弹窗", () => {
  it("入口零状态词(10-20 用户令):任何状态下都只显「全书提取」,无 未开始/运行中/已暂停/等待额度/已完成/计数", () => {
    setStore({ status: "idle" });
    const { unmount } = render(<AssetsBookExtractionCard totalChapters={100} />);
    const idleEntry = screen.getByTestId("book-extraction-entry").textContent ?? "";
    unmount();

    setStore({ status: "running", range: [1, 100], counts: COUNTS });
    render(<AssetsBookExtractionCard totalChapters={100} />);
    const runningEntry = screen.getByTestId("book-extraction-entry").textContent ?? "";

    for (const entry of [idleEntry, runningEntry]) {
      expect(entry).toContain("全书提取");
      for (const word of ["未开始", "运行中", "已暂停", "等待额度", "已完成", "成功", "剩余"]) {
        expect(entry, `入口不得出现状态词「${word}」`).not.toContain(word);
      }
    }
    // 弹窗默认关闭:面板控件不在文档
    expect(screen.queryByRole("button", { name: "开始提取" })).toBeNull();
  });

  it("点入口开弹窗,面板控件与运行数据在座(状态只活在弹窗内)", async () => {
    setStore({ status: "running", range: [1, 100], counts: COUNTS });
    render(<AssetsBookExtractionCard totalChapters={100} />);
    await openBookDialog();
    expect(screen.getByLabelText("起始章")).toBeTruthy();
    expect(screen.getByText("glm-5.3")).toBeTruthy();
    expect(screen.getByText("成功 3")).toBeTruthy();
    expect(screen.getByText("剩余 95")).toBeTruthy();
  });
});

describe("AC1 按钮态随 runner 状态切换", () => {
  it("idle:只有开始可用", async () => {
    setStore({ status: "idle" });
    render(<AssetsBookExtractionCard totalChapters={100} />);
    await openBookDialog();
    expectButtons({ start: false, pause: true, resume: true, retryFailed: true, forceNew: true });
  });

  it("running:只有暂停可用", async () => {
    setStore({ status: "running", range: [1, 100], counts: COUNTS });
    render(<AssetsBookExtractionCard totalChapters={100} />);
    await openBookDialog();
    expectButtons({ start: true, pause: false, resume: true, retryFailed: true, forceNew: true });
  });

  it("paused:继续/仅重跑失败/强制重提可用", async () => {
    setStore({ status: "paused", range: [1, 100], counts: COUNTS });
    render(<AssetsBookExtractionCard totalChapters={100} />);
    await openBookDialog();
    expectButtons({ start: true, pause: true, resume: false, retryFailed: false, forceNew: false });
  });

  it("done:仅重跑失败/强制重提可用", async () => {
    setStore({
      status: "done",
      range: [1, 100],
      counts: { success: 100, failed: 0, skipped: 0, pending: 0 },
    });
    render(<AssetsBookExtractionCard totalChapters={100} />);
    await openBookDialog();
    expectButtons({ start: true, pause: true, resume: true, retryFailed: false, forceNew: false });
  });

  it("quota_wait:只有暂停可用", async () => {
    setStore({ status: "quota_wait", range: [1, 100], counts: COUNTS });
    render(<AssetsBookExtractionCard totalChapters={100} />);
    await openBookDialog();
    expectButtons({ start: true, pause: false, resume: true, retryFailed: true, forceNew: true });
  });

  it("起止章输入随运行锁定;模型只读显示实际 resolve 结果", async () => {
    setStore({ status: "running", range: [1, 100] });
    render(<AssetsBookExtractionCard totalChapters={4125} />);
    await openBookDialog();
    expect((screen.getByLabelText("起始章") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("结束章") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("glm-5.3")).toBeTruthy();
  });

  it("缺省起止章=1..totalChapters,模型回退当前 resolve 链结果", async () => {
    render(<AssetsBookExtractionCard totalChapters={4125} />);
    await openBookDialog();
    expect((screen.getByLabelText("起始章") as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText("结束章") as HTMLInputElement).value).toBe("4125");
    expect(screen.getByText("glm-5.3")).toBeTruthy();
  });
});

describe("AC2 进度/ETA/额度窗口展示", () => {
  it("四计数+进度条+ETA 可见", async () => {
    setStore({ status: "running", range: [1, 100], counts: COUNTS, etaMs: 90_000 });
    render(<AssetsBookExtractionCard totalChapters={100} />);
    await openBookDialog();
    expect(screen.getByText("成功 3")).toBeTruthy();
    expect(screen.getByText("失败 1")).toBeTruthy();
    expect(screen.getByText("跳过 1")).toBeTruthy();
    expect(screen.getByText("剩余 95")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    // 进度=(成功+失败+跳过)/总数=5/100
    expect(bar.getAttribute("aria-valuenow")).toBe("5");
    expect(screen.getByText(/预计剩余/)).toBeTruthy();
    expect(screen.getByText("2 分钟")).toBeTruthy();
  });

  it("quota_wait 显示「等待额度重置至 HH:MM」", async () => {
    setStore({
      status: "quota_wait",
      range: [1, 100],
      counts: COUNTS,
      resumeAt: Date.now() + 3_600_000,
    });
    render(<AssetsBookExtractionCard totalChapters={100} />);
    await openBookDialog();
    expect(screen.getByText(/等待额度重置至 ([01]\d|2[0-3]):[0-5]\d/)).toBeTruthy();
  });
});

describe("AC3 失败清单点击跳章", () => {
  it("失败项=章号+错误摘要,点击调 switchChapter", async () => {
    const switchChapter = vi.fn().mockResolvedValue(undefined);
    useStudioStore.setState({ switchChapter } as never);
    setStore({
      status: "paused",
      range: [1, 100],
      counts: COUNTS,
      failures: [{ chapterId: "chapter-003", error: "请求超时" }],
    });
    render(<AssetsBookExtractionCard totalChapters={100} />);
    await openBookDialog();
    fireEvent.click(screen.getByRole("button", { name: /第 3 章/ }));
    expect(switchChapter).toHaveBeenCalledWith("chapter-003");
    expect(screen.getByText(/请求超时/)).toBeTruthy();
  });
});

describe("AC4 运行中禁用单章提取按钮", () => {
  const batchCardProps = {
    mode: "extract" as const,
    chapter: { id: "chapter-001", index: 1, title: "断剑为谁而鸣" },
    batch: undefined,
    inWindow: true,
    script: "第一场 道口镇 夜",
    open: true,
    extractingId: null,
    adding: null,
    addValue: "",
    onToggle: () => undefined,
    onRun: () => undefined,
    onCreateMissingAssets: () => undefined,
    onRemoveAsset: () => undefined,
    onSubmitAdd: () => undefined,
    onStartAdd: () => undefined,
    onCancelAdd: () => undefined,
    onAddValueChange: () => undefined,
    getAssetStatus: () => "missing" as const,
  };

  it("idle 时单章「提取资产」可用", () => {
    render(<AssetsBatchCard {...batchCardProps} />);
    expect(
      (screen.getByRole("button", { name: "提取资产" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("running 与 quota_wait 时单章「提取资产」disabled", () => {
    setStore({ status: "running" });
    const { unmount } = render(<AssetsBatchCard {...batchCardProps} />);
    expect(
      (screen.getByRole("button", { name: "提取资产" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    unmount();

    setStore({ status: "quota_wait" });
    render(<AssetsBatchCard {...batchCardProps} />);
    expect(
      (screen.getByRole("button", { name: "提取资产" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("store 动作接线(start/pause)", () => {
  it("开始=装配生产 deps 并发起 run;完成回填 summary", async () => {
    runnerMocks.createRunnerDeps.mockReturnValue({ projectId: "p1" });
    runnerMocks.runEntityExtraction.mockResolvedValue({
      runId: "run-1",
      status: "done",
      drift: null,
      counts: { success: 2, failed: 0, skipped: 0, pending: 0 },
      ledgerPath: "store/extraction/extraction-run.json",
    });
    await useAssetsBookExtractionStore
      .getState()
      .start({ projectId: "p1", projectName: "道劫", range: [1, 2] });
    expect(runnerMocks.createRunnerDeps).toHaveBeenCalledWith({
      projectId: "p1",
      projectName: "道劫",
    });
    expect(runnerMocks.runEntityExtraction).toHaveBeenCalledWith(
      { projectId: "p1" },
      { range: [1, 2] },
    );
    expect(useAssetsBookExtractionStore.getState().status).toBe("done");
    expect(useAssetsBookExtractionStore.getState().counts.success).toBe(2);
  });

  it("已在飞/装配失败 → 记 lastError 不发起", async () => {
    runnerMocks.isEntityExtractionInFlight.mockReturnValue(true);
    await useAssetsBookExtractionStore
      .getState()
      .start({ projectId: "p1", projectName: "道劫", range: [1, 2] });
    expect(runnerMocks.runEntityExtraction).not.toHaveBeenCalled();
    expect(useAssetsBookExtractionStore.getState().lastError).toBeTruthy();

    resetBookStore();
    runnerMocks.isEntityExtractionInFlight.mockReturnValue(false);
    runnerMocks.createRunnerDeps.mockImplementation(() => {
      throw new Error("项目文件桥不可用");
    });
    await useAssetsBookExtractionStore
      .getState()
      .start({ projectId: "p1", projectName: "道劫", range: [1, 2] });
    expect(runnerMocks.runEntityExtraction).not.toHaveBeenCalled();
    expect(useAssetsBookExtractionStore.getState().lastError).toContain("项目文件桥不可用");
  });

  it("暂停=调 pauseEntityExtraction;无在飞 run 记 lastError", () => {
    useAssetsBookExtractionStore.getState().pause();
    expect(runnerMocks.pauseEntityExtraction).toHaveBeenCalled();

    resetBookStore();
    runnerMocks.pauseEntityExtraction.mockReturnValue(false);
    useAssetsBookExtractionStore.getState().pause();
    expect(useAssetsBookExtractionStore.getState().lastError).toBeTruthy();
    runnerMocks.pauseEntityExtraction.mockReturnValue(true);
  });
});
