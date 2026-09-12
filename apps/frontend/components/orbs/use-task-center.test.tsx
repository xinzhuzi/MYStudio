// @vitest-environment jsdom
// use-task-center(09-12 orb-task-center)测试:五源聚合+终态迁移提醒。
// 手算对账:各源 zustand setState 驱动,断言归一化输出/聚合计数/迁移 diff/bump。

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useTaskCenter } from "./use-task-center";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import { useDirectorStore } from "@/stores/director/director-store";
import { useSClassStore } from "@/stores/sclass/sclass-store";

afterEach(() => {
  cleanup();
  delete (window as { remotionQueue?: unknown }).remotionQueue;
  useStudioStore.setState({ mediaTasks: [], agentRuns: [] });
  useTtsStore.setState({ projects: {} } as never);
  useDirectorStore.setState({ sceneProgress: new Map() } as never);
  useSClassStore.setState({ projects: {} } as never);
});

function seedMediaTask(
  overrides: Partial<{
    id: string;
    kind: string;
    status: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "task-1",
    kind: overrides.kind ?? "storyboardImage",
    status: overrides.status ?? "running",
    targetId: "target-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("useTaskCenter(逐条域:media/agent)", () => {
  it("mediaTasks queued/running 进活跃,标签按 kind 中文映射,可跳工作流", () => {
    useStudioStore.setState({
      mediaTasks: [
        seedMediaTask({ id: "a", status: "running" }),
        seedMediaTask({ id: "b", status: "queued", kind: "finalExport" }),
        // 终态/取消:不进活跃
        seedMediaTask({ id: "c", status: "success" }),
        seedMediaTask({ id: "d", status: "canceled" }),
      ],
    } as never);
    const { result } = renderHook(() => useTaskCenter());
    expect(result.current.tasks.map((task) => task.id)).toEqual([
      "media:a",
      "media:b",
    ]);
    expect(result.current.tasks[0]!.label).toBe("分镜图生成");
    expect(result.current.tasks[1]!.label).toBe("成片导出");
    expect(result.current.tasks[1]!.status).toBe("queued");
    expect(result.current.tasks[0]!.targetTab).toBe("studio");
  });

  it("无任务时活跃数组引用稳定(零渲染抖动)", () => {
    const { result, rerender } = renderHook(() => useTaskCenter());
    const first = result.current.tasks;
    expect(first).toEqual([]);
    rerender();
    expect(result.current.tasks).toBe(first);
  });

  it("agentRuns running 进活跃,key 中文标签+摘要", () => {
    useStudioStore.setState({
      agentRuns: [
        {
          id: "run-1",
          key: "scriptDraft",
          phase: "draft",
          status: "running",
          inputSummary: "第一章",
          startedAt: Date.now(),
        },
        {
          id: "run-2",
          key: "scriptDraft",
          phase: "draft",
          status: "success",
          inputSummary: "旧",
          startedAt: Date.now(),
        },
      ],
    } as never);
    const { result } = renderHook(() => useTaskCenter());
    const agent = result.current.tasks.find((task) => task.id === "agent:run-1");
    expect(agent?.label).toContain("剧本草稿");
    expect(agent?.label).toContain("第一章");
    expect(agent?.status).toBe("running");
  });

  it("终态迁移:running→success 触发 recent+bump(完成提醒数据面)", async () => {
    useStudioStore.setState({ mediaTasks: [seedMediaTask({ status: "running" })] } as never);
    const { result } = renderHook(() => useTaskCenter());
    expect(result.current.bumpTick).toBe(0);
    act(() => {
      useStudioStore.setState({
        mediaTasks: [seedMediaTask({ status: "success" })],
      } as never);
    });
    await waitFor(() => expect(result.current.bumpTick).toBe(1));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0]!.status).toBe("success");
    expect(result.current.recent[0]!.label).toBe("分镜图生成");
  });

  it("挂载时既有的历史终态不进 recent(diff 只认迁移)", () => {
    useStudioStore.setState({ mediaTasks: [seedMediaTask({ status: "failed" })] } as never);
    const { result } = renderHook(() => useTaskCenter());
    expect(result.current.recent).toEqual([]);
    expect(result.current.bumpTick).toBe(0);
  });
});

describe("useTaskCenter(remotion 全局订阅)", () => {
  it("onJob 通知驱动:running 进活跃,canceled 移除,退订随卸载", () => {
    let listener: ((n: { jobId: string; chapterId: string; status: string }) => void) | null =
      null;
    let unsubCalls = 0;
    (window as unknown as { remotionQueue: unknown }).remotionQueue = {
      onJob: (cb: typeof listener) => {
        listener = cb;
        return () => {
          unsubCalls += 1;
        };
      },
    };
    const { result, unmount } = renderHook(() => useTaskCenter());
    expect(listener).toBeTruthy();
    act(() => {
      listener!({ jobId: "job-1", chapterId: "chapter-001", status: "running" });
    });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]!.id).toBe("remotion:job-1");
    expect(result.current.tasks[0]!.label).toBe("成片渲染 · chapter-001");
    expect(result.current.tasks[0]!.status).toBe("running");

    act(() => {
      listener!({ jobId: "job-1", chapterId: "chapter-001", status: "succeeded" });
    });
    // succeeded 不在活跃集,但迁移进 recent
    expect(result.current.tasks).toEqual([]);
    expect(result.current.recent[0]!.status).toBe("success");
    expect(result.current.recent[0]!.label).toBe("成片渲染 · chapter-001");

    act(() => {
      listener!({ jobId: "job-2", chapterId: "chapter-001", status: "queued" });
      listener!({ jobId: "job-2", chapterId: "chapter-001", status: "canceled" });
    });
    expect(result.current.tasks).toEqual([]);

    unmount();
    expect(unsubCalls).toBe(1);
  });

  it("window.remotionQueue 缺失时静默降级为无此源", () => {
    const { result } = renderHook(() => useTaskCenter());
    expect(result.current.tasks).toEqual([]);
  });
});

describe("useTaskCenter(计数域:tts/director/sclass 聚合)", () => {
  it("同域多条生成中折叠一条,不逐条刷屏;director 带平均进度", () => {
    useTtsStore.setState({
      projects: {
        p1: {
          voiceLines: {
            s1: { status: "generating" },
            s2: { status: "generating" },
            s3: { status: "completed" },
          },
        },
      },
    } as never);
    useDirectorStore.setState({
      sceneProgress: new Map([
        [1, { status: "generating", progress: 40 }],
        [2, { status: "generating", progress: 80 }],
        [3, { status: "completed", progress: 100 }],
      ]),
    } as never);
    const { result } = renderHook(() => useTaskCenter());
    const tts = result.current.tasks.find((task) => task.source === "tts");
    expect(tts?.label).toBe("配音生成 · 2 条");
    const director = result.current.tasks.find((task) => task.source === "director");
    expect(director?.label).toBe("导演模式生成 · 2 镜头");
    expect(director?.progress).toBeCloseTo(0.6, 5);
  });

  it("活跃下降推断完成:2 条生成中→完成 → recent 记「完成 · 2 条」+bump", async () => {
    useTtsStore.setState({
      projects: {
        p1: {
          voiceLines: {
            s1: { status: "generating" },
            s2: { status: "generating" },
          },
        },
      },
    } as never);
    const { result } = renderHook(() => useTaskCenter());
    expect(result.current.tasks.some((task) => task.source === "tts")).toBe(true);
    act(() => {
      useTtsStore.setState({
        projects: {
          p1: {
            voiceLines: {
              s1: { status: "completed" },
              s2: { status: "completed" },
            },
          },
        },
      } as never);
    });
    await waitFor(() => expect(result.current.bumpTick).toBe(1));
    expect(result.current.recent[0]!.status).toBe("success");
    expect(result.current.recent[0]!.label).toBe("配音生成完成 · 2 条");
  });

  it("失败优先:活跃下降且失败计数上升 → recent 记失败条目", async () => {
    useTtsStore.setState({
      projects: {
        p1: {
          voiceLines: {
            s1: { status: "generating" },
            s2: { status: "generating" },
            s3: { status: "failed" },
          },
        },
      },
    } as never);
    const { result } = renderHook(() => useTaskCenter());
    act(() => {
      useTtsStore.setState({
        projects: {
          p1: {
            voiceLines: {
              s1: { status: "failed" },
              s2: { status: "completed" },
              s3: { status: "failed" },
            },
          },
        },
      } as never);
    });
    await waitFor(() => expect(result.current.bumpTick).toBe(2));
    // 1 失败 + 1 完成同时发生:两条 recent 都该在场(语义正确)
    expect(result.current.recent.find((entry) => entry.status === "failed")?.label).toBe(
      "配音生成失败 · 1 条",
    );
    expect(
      result.current.recent.find((entry) => entry.status === "success")?.label,
    ).toBe("配音生成完成 · 1 条");
  });

  it("sclass 生成中计活跃(组+单镜两容器都扫)", () => {
    useSClassStore.setState({
      projects: {
        p1: {
          shotGroups: [{ videoStatus: "generating", videoProgress: 55 }],
          singleShotOverrides: { 9: { videoStatus: "generating", videoProgress: 25 } },
        },
      },
    } as never);
    const { result } = renderHook(() => useTaskCenter());
    const sclass = result.current.tasks.find((task) => task.source === "sclass");
    expect(sclass?.label).toBe("S级视频生成 · 2 镜头");
    expect(sclass?.progress).toBeCloseTo(0.4, 5);
  });
});
