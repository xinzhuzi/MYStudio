import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShotGroup } from "@/stores/sclass-store";
import { runSClassBatchGeneration } from "./sclass-batch-generation";

const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

function group(id: string, videoStatus: ShotGroup["videoStatus"]): ShotGroup {
  return { id, name: id, videoStatus } as ShotGroup;
}

describe("runSClassBatchGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates only idle/failed groups and reports terminal counts", async () => {
    const generateGroup = vi.fn(async (current: ShotGroup) => ({
      groupId: current.id,
      success: current.id === "idle",
      videoUrl: current.id === "idle" ? "video" : null,
      error: current.id === "failed" ? "failed" : null,
    }));
    const onBatchProgress = vi.fn();

    const results = await runSClassBatchGeneration({
      groups: [group("completed", "completed"), group("idle", "idle"), group("failed", "failed")],
      isAborted: () => false,
      generateGroup,
      onBatchProgress,
    });

    expect(generateGroup.mock.calls.map(([current]) => current.id)).toEqual(["idle", "failed"]);
    expect(results).toHaveLength(2);
    expect(onBatchProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      total: 2,
      completed: 2,
      current: null,
      results,
    }));
    expect(toast.warning).toHaveBeenCalledWith("生成完毕：1 成功，1 失败");
  });

  it("stops before the next group when aborted", async () => {
    let aborted = false;
    const generateGroup = vi.fn(async (current: ShotGroup) => {
      aborted = true;
      return { groupId: current.id, success: true, videoUrl: "video", error: null };
    });

    const results = await runSClassBatchGeneration({
      groups: [group("one", "idle"), group("two", "idle")],
      isAborted: () => aborted,
      generateGroup,
    });

    expect(generateGroup).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith("已中止批量生成");
  });
});
