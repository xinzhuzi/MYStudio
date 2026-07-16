import { beforeEach, describe, expect, it, vi } from "vitest";

import { runStoryboardMergedPages } from "./storyboard-merged-page-controller";

type Task = { id: number; type: "first" | "end" };

const pages: Task[][] = [
  [{ id: 1, type: "first" }],
  [{ id: 2, type: "end" }],
];

function setup() {
  const controller = new AbortController();
  return {
    pages,
    signal: controller.signal,
    isAborted: vi.fn(() => false),
    getTaskType: (task: Task) => task.type,
    collectReferences: vi.fn(() => ["ref"]),
    generatePage: vi.fn().mockResolvedValue(undefined),
    resetPageTasksToError: vi.fn(),
    waitForRetry: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn(),
    setRunning: vi.fn(),
    notify: {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe("runStoryboardMergedPages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs every page and reports full success", async () => {
    const options = setup();
    await runStoryboardMergedPages(options);

    expect(options.generatePage).toHaveBeenCalledTimes(2);
    expect(options.notify.success).toHaveBeenLastCalledWith("九宫格合并生成全部完成！");
    expect(options.finish).toHaveBeenCalledWith(options.signal);
    expect(options.setRunning).toHaveBeenLastCalledWith(false);
  });

  it("resets a failed page and retries it once after five seconds", async () => {
    const options = setup();
    options.pages = [[{ id: 1, type: "first" }]];
    options.generatePage.mockRejectedValueOnce(new Error("busy")).mockResolvedValueOnce(undefined);

    await runStoryboardMergedPages(options);

    expect(options.resetPageTasksToError).toHaveBeenCalledWith(options.pages[0], "busy");
    expect(options.waitForRetry).toHaveBeenCalledWith(5000, options.signal);
    expect(options.collectReferences).toHaveBeenCalledTimes(2);
    expect(options.notify.success).toHaveBeenLastCalledWith("九宫格合并生成全部完成！");
  });

  it("keeps the retry failure prefix and reports all pages failed", async () => {
    const options = setup();
    options.pages = [[{ id: 1, type: "end" }]];
    options.generatePage.mockRejectedValue(new Error("offline"));

    await runStoryboardMergedPages(options);

    expect(options.resetPageTasksToError).toHaveBeenLastCalledWith(options.pages[0], "重试失败: offline");
    expect(options.notify.error).toHaveBeenCalledWith("合并生成全部失败（1 页），请检查 API 服务后重试");
  });

  it("preserves the existing early-stop branch without a second finish call", async () => {
    const options = setup();
    options.isAborted.mockReturnValue(true);

    await runStoryboardMergedPages(options);

    expect(options.generatePage).not.toHaveBeenCalled();
    expect(options.notify.info).toHaveBeenCalledWith("合并生成已停止");
    expect(options.finish).not.toHaveBeenCalled();
    expect(options.setRunning).toHaveBeenCalledWith(false);
  });
});
