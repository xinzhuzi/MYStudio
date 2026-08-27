import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createBatchFailureReporter } from "./batch-failure-toast";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

afterEach(() => {
  vi.mocked(toast.error).mockClear();
});

describe("createBatchFailureReporter", () => {
  it("reuses one toast per identical reason and grows the counter", () => {
    const reporter = createBatchFailureReporter("分镜");

    reporter.report("分镜 3", "网络请求失败:域名解析失败");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]![0]).toContain("分镜 3 生成失败");
    const firstId = vi.mocked(toast.error).mock.calls[0]![1]!.id;

    reporter.report("分镜 7", "网络请求失败:域名解析失败");
    expect(toast.error).toHaveBeenCalledTimes(2);
    const [secondMessage, secondOptions] = vi.mocked(toast.error).mock.calls[1]!;
    expect(secondMessage).toContain("2 个分镜生成失败(同一原因)");
    expect(secondOptions!.id).toBe(firstId);
  });

  it("opens a separate toast for a different reason", () => {
    const reporter = createBatchFailureReporter("分镜");

    reporter.report("分镜 3", "域名解析失败");
    reporter.report("分镜 5", "API Key 无效或已过期");

    expect(toast.error).toHaveBeenCalledTimes(2);
    const firstId = vi.mocked(toast.error).mock.calls[0]![1]!.id;
    const secondId = vi.mocked(toast.error).mock.calls[1]![1]!.id;
    expect(firstId).not.toBe(secondId);
  });
});
