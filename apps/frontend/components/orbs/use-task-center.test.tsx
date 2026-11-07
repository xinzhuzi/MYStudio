// @vitest-environment jsdom
// use-task-center(09-12 orb-task-center)测试:五源聚合+终态迁移提醒。
// 手算对账:各源 zustand setState 驱动,断言归一化输出/聚合计数/迁移 diff/bump。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useTaskCenter } from "./use-task-center";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import { useDirectorStore } from "@/stores/director/director-store";
import { useSClassStore } from "@/stores/sclass/sclass-store";
import { useChapterPipelineStore } from "@/components/panels/studio/chapter-pipeline";
import { useChapterUpstreamStore } from "@/components/panels/studio/chapter-pipeline-stale";

afterEach(() => {
  cleanup();
  delete (window as { remotionQueue?: unknown }).remotionQueue;
  useStudioStore.setState({ mediaTasks: [], agentRuns: [], agentWorkData: [], novelChapters: [] });
  useTtsStore.setState({ projects: {} } as never);
  useDirectorStore.setState({ sceneProgress: new Map() } as never);
  useSClassStore.setState({ projects: {} } as never);
  useChapterPipelineStore.setState({ runsByChapter: {}, zombieReconciled: false });
  useChapterUpstreamStore.setState({ byChapter: {} });
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
    // B+ 收口单口径:scriptDraft 标签=「剧本(含规划)」(对齐 SCRIPT_STAGE_LABEL)
    expect(agent?.label).toContain("剧本(含规划)");
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

describe("useTaskCenter(pipeline 域:10-11 批5 章流水线+批6 黄标)", () => {
  it("章流水线运行中进活跃(步骤粒度进度);完成推「章验收卡」终态收据", async () => {
    const { result } = renderHook(() => useTaskCenter());
    act(() => {
      useChapterPipelineStore.setState({
        runsByChapter: {
          "chapter-001": {
            chapterId: "chapter-001",
            status: "running",
            steps: [
              { key: "assets", label: "资产生成", status: "done" },
              { key: "derived", label: "衍生闭环", status: "running" },
              { key: "storyboardBinding", label: "分镜绑定", status: "pending" },
            ],
          },
        },
      });
    });
    const active = result.current.tasks.find((task) => task.source === "pipeline");
    expect(active?.id).toBe("pipeline:chapter-001");
    expect(active?.label).toBe("章流水线 · 衍生闭环");
    expect(active?.progress).toBeCloseTo(1 / 3, 5);

    await act(async () => {
      useChapterPipelineStore.setState({
        runsByChapter: {
          "chapter-001": {
            chapterId: "chapter-001",
            status: "done",
            steps: [],
            card: {
              chapterId: "chapter-001",
              generatedAt: 1,
              recomputed: false,
              assets: { total: 3, success: 2, failed: 1, failedNames: ["prop:青盐鞭"] },
              derived: { total: 1, success: 1, failed: 0, failedNames: [] },
              storyboard: { totalShots: 6, ready: 6, unbound: 0, exceptions: 0 },
              staleCount: 0,
              staleSampleTargetIds: [],
            },
          },
        },
      });
    });
    // 活跃离场;recent 出「章验收卡」终态收据(双落位之一),失败态带名单
    expect(result.current.tasks.find((task) => task.source === "pipeline")).toBeUndefined();
    const receipt = result.current.recent.find((entry) => entry.source === "pipeline");
    expect(receipt?.status).toBe("failed");
    expect(receipt?.label).toContain("资产 2/3");
    expect(receipt?.label).toContain("分镜 6/6");
    expect(receipt?.errorReason).toBe("prop:青盐鞭");
  });

  it("全绿的章流水线收据=success(无 errorReason)", async () => {
    const { result } = renderHook(() => useTaskCenter());
    act(() => {
      useChapterPipelineStore.setState({
        runsByChapter: {
          "chapter-001": { chapterId: "chapter-001", status: "running", steps: [] },
        },
      });
    });
    await act(async () => {
      useChapterPipelineStore.setState({
        runsByChapter: {
          "chapter-001": {
            chapterId: "chapter-001",
            status: "done",
            steps: [],
            card: {
              chapterId: "chapter-001",
              generatedAt: 1,
              recomputed: false,
              assets: { total: 3, success: 3, failed: 0, failedNames: [] },
              derived: { total: 1, success: 1, failed: 0, failedNames: [] },
              storyboard: { totalShots: 6, ready: 6, unbound: 0, exceptions: 0 },
              staleCount: 0,
              staleSampleTargetIds: [],
            },
          },
        },
      });
    });
    const receipt = result.current.recent.find((entry) => entry.source === "pipeline");
    expect(receipt?.status).toBe("success");
    expect(receipt?.errorReason).toBeUndefined();
  });

  it("批6 黄标:剧本指纹漂移章的终态下游任务进 staleTasks;未漂移/在途不进", () => {
    // 发车指纹=空剧本(与现势不一致即漂移);台账有戳才判
    useChapterUpstreamStore.setState({
      byChapter: { "chapter-001": { scriptFingerprint: "fp-dispatch-old", recordedAt: 1 } },
    });
    useStudioStore.setState({
      agentWorkData: [
        { id: "work-1", key: "scriptDraft", episodeId: "chapter-001", data: "重生成后的新剧本", createdAt: 1, updatedAt: 1 },
      ] as never,
      mediaTasks: [
        { ...seedMediaTask({ id: "stale-1", kind: "scriptAsset", status: "success" }), episodeId: "chapter-001" },
        { ...seedMediaTask({ id: "fresh-run", kind: "scriptAsset", status: "running" }), episodeId: "chapter-001" },
        { ...seedMediaTask({ id: "other-kind", kind: "ttsAudio", status: "success" }), episodeId: "chapter-001" },
      ] as never,
    });
    const { result } = renderHook(() => useTaskCenter());
    expect(result.current.staleTasks.map((task) => task.id)).toEqual(["media:stale-1"]);
    expect(result.current.staleTasks[0]!.stale).toBe(true);
  });
});

// ── 出片完成系统通知(11-06 render-notify):前台/后台/声音关三态 ──────────────
describe("useTaskCenter(出片完成系统通知)", () => {
  class NotificationStub {
    static calls: Array<{ title: string; body?: string; silent?: boolean }> = [];
    constructor(title: string, options: { body?: string; silent?: boolean }) {
      NotificationStub.calls.push({ title, body: options.body, silent: options.silent });
    }
  }

  let hasFocusSpy: ReturnType<typeof vi.spyOn> | null = null;
  let visibilityDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal("Notification", NotificationStub);
    NotificationStub.calls = [];
    useAppSettingsStore.setState({ notifications: { renderCompleteSound: false } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (hasFocusSpy) {
      hasFocusSpy.mockRestore();
      hasFocusSpy = null;
    }
    if (visibilityDescriptor) {
      Object.defineProperty(document, "visibilityState", visibilityDescriptor);
      visibilityDescriptor = undefined;
    }
    useAppSettingsStore.setState({ notifications: { renderCompleteSound: false } });
  });

  const goBackground = () => {
    hasFocusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  };

  const goForeground = () => {
    hasFocusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  };

  it("后台+声音关(默认):modelVideo running→success 发系统通知且静音", async () => {
    goBackground();
    useStudioStore.setState({
      mediaTasks: [seedMediaTask({ id: "v1", kind: "modelVideo", status: "running" })],
    } as never);
    const { result } = renderHook(() => useTaskCenter());
    act(() => {
      useStudioStore.setState({
        mediaTasks: [seedMediaTask({ id: "v1", kind: "modelVideo", status: "success" })],
      } as never);
    });
    await waitFor(() => expect(result.current.bumpTick).toBe(1));
    expect(NotificationStub.calls).toEqual([
      { title: "单镜视频完成", body: "视频生成", silent: true },
    ]);
  });

  it("前台:同类完成不发系统通知(App 内徽标数据面兜底)", async () => {
    goForeground(); // jsdom 默认无焦点,前台态需显式钉死
    useStudioStore.setState({
      mediaTasks: [seedMediaTask({ id: "v1", kind: "modelVideo", status: "running" })],
    } as never);
    const { result } = renderHook(() => useTaskCenter());
    act(() => {
      useStudioStore.setState({
        mediaTasks: [seedMediaTask({ id: "v1", kind: "modelVideo", status: "success" })],
      } as never);
    });
    await waitFor(() => expect(result.current.bumpTick).toBe(1));
    expect(NotificationStub.calls).toEqual([]);
  });

  it("后台+声音开:系统通知带声(silent=false)", async () => {
    goBackground();
    useAppSettingsStore.setState({ notifications: { renderCompleteSound: true } });
    useStudioStore.setState({
      mediaTasks: [seedMediaTask({ id: "v1", kind: "modelVideo", status: "running" })],
    } as never);
    const { result } = renderHook(() => useTaskCenter());
    act(() => {
      useStudioStore.setState({
        mediaTasks: [seedMediaTask({ id: "v1", kind: "modelVideo", status: "success" })],
      } as never);
    });
    await waitFor(() => expect(result.current.bumpTick).toBe(1));
    expect(NotificationStub.calls).toEqual([
      { title: "单镜视频完成", body: "视频生成", silent: false },
    ]);
  });

  it("章节成片(remotion)后台完成发通知;分镜图完成与非成功终态不通知", async () => {
    goBackground();
    let listener: ((n: { jobId: string; chapterId: string; status: string }) => void) | null = null;
    (window as unknown as { remotionQueue: unknown }).remotionQueue = {
      onJob: (cb: typeof listener) => {
        listener = cb;
        return () => {};
      },
    };
    const { result } = renderHook(() => useTaskCenter());
    act(() => {
      listener!({ jobId: "job-1", chapterId: "chapter-009", status: "running" });
    });
    act(() => {
      listener!({ jobId: "job-1", chapterId: "chapter-009", status: "succeeded" });
    });
    await waitFor(() => expect(result.current.bumpTick).toBe(1));
    expect(NotificationStub.calls).toEqual([
      { title: "章节出片完成", body: "成片渲染 · chapter-009", silent: true },
    ]);
    // 非目标 kind(分镜图)后台完成:不通知(11-06 范围钉死只有两类出片事件)
    act(() => {
      useStudioStore.setState({
        mediaTasks: [seedMediaTask({ id: "s1", kind: "storyboardImage", status: "running" })],
      } as never);
    });
    act(() => {
      useStudioStore.setState({
        mediaTasks: [seedMediaTask({ id: "s1", kind: "storyboardImage", status: "success" })],
      } as never);
    });
    await waitFor(() => expect(result.current.bumpTick).toBe(2));
    expect(NotificationStub.calls).toHaveLength(1);
    // remotion 失败:只进徽标数据面,不发系统通知(只接完成事件)
    act(() => {
      listener!({ jobId: "job-2", chapterId: "chapter-010", status: "running" });
    });
    act(() => {
      listener!({ jobId: "job-2", chapterId: "chapter-010", status: "failed" });
    });
    await waitFor(() =>
      expect(result.current.recent.some((item) => item.status === "failed")).toBe(true),
    );
    expect(NotificationStub.calls).toHaveLength(1);
  });
});
