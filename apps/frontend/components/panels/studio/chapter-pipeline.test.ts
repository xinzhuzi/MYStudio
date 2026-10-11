// @vitest-environment jsdom
/**
 * 批5 章级编排测试(10-11 pipeline-human-node-automation,design §2.6/G10/G9):
 * 三步串行+步间门(上步全 terminal 才进下步;双信号=子批次态+任务台账)、
 * failed 不阻塞走例外、前置不满足步 skipped、门超时不死锁、章验收卡聚合
 * (每 target 最新态/失败名单/分镜就绪度/成本口径)、断点续跑(重启重算聚合
 * 不重发+僵尸任务收口双防线)、防重入、批6 发车指纹盖戳→剧本变更→stale 派生。
 * 执行体注入(steps 参数):不真跑生图,只驱动真实子批次 store+任务台账。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { MediaGenerationTask, StoryboardItem } from "@/types/studio";
import {
  buildChapterAcceptanceCard,
  chapterAcceptanceAllGreen,
  recomputeChapterPipelineAggregate,
  runChapterPipeline,
  useChapterPipelineStore,
  waitChapterStepSettled,
  type ChapterPipelineStepKey,
} from "./chapter-pipeline";
import { useChapterUpstreamStore, collectStaleDownstreamTasksFromStore } from "./chapter-pipeline-stale";
import { useScriptAssetBatchStore } from "./script-asset-batch";
import { useDerivedChainStore } from "./derived-asset-chain";
import { useStoryboardBindingStore } from "./storyboard-asset-binding";

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const CHAPTER_ID = "chapter-001";
const PROJECT_ID = "proj-1";
const FAST_GATE = { pollMs: 2, timeoutMs: 400 };

let taskSeq = 0;
function mediaTask(overrides: Partial<MediaGenerationTask> = {}): MediaGenerationTask {
  taskSeq += 1;
  return {
    id: `task-${taskSeq}`,
    kind: "scriptAsset",
    status: "success",
    targetId: "character:断臂散修",
    episodeId: CHAPTER_ID,
    createdAt: 1,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeShot(input: {
  index: number;
  bound?: boolean;
}): StoryboardItem {
  return {
    id: `sb-${input.index}`,
    episodeId: CHAPTER_ID,
    index: input.index,
    trackKey: `001-${input.index}`,
    trackId: "",
    duration: 5,
    prompt: "画面描述",
    videoDesc: "",
    assetIds: [],
    associateAssetsNames: [],
    mediaRef: input.bound ? { kind: "image", path: `local-image://shots/s${input.index}.png` } : undefined,
    keyframes: input.bound
      ? [{ frameId: `sb-${input.index}-kf-1`, mediaRef: { kind: "image", path: `local-image://shots/s${input.index}.png` }, inUs: 0 }]
      : [],
    shouldGenerateImage: true,
    state: "idle",
  } as StoryboardItem;
}

/** 把某步子批次 store 的本章运行态直接置为 done(绕开真实 finishRun 的报表形状)。 */
function settleSubRun(step: ChapterPipelineStepKey) {
  if (step === "assets") {
    useScriptAssetBatchStore.setState((state) => ({
      runsByChapter: {
        ...state.runsByChapter,
        [CHAPTER_ID]: { chapterId: CHAPTER_ID, status: "done", progress: { done: 1, total: 1, currentName: "" } },
      },
    }));
  } else if (step === "derived") {
    useDerivedChainStore.setState((state) => ({
      runsByChapter: {
        ...state.runsByChapter,
        [CHAPTER_ID]: { chapterId: CHAPTER_ID, status: "done", progress: { done: 1, total: 1, currentName: "" } },
      },
    }));
  } else {
    useStoryboardBindingStore.setState((state) => ({
      runsByChapter: {
        ...state.runsByChapter,
        [CHAPTER_ID]: { chapterId: CHAPTER_ID, status: "done", progress: { done: 1, total: 1, currentShot: "" } },
      },
    }));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  useStudioStore.getState().resetStudioWorkflow();
  useChapterPipelineStore.setState({ runsByChapter: {}, zombieReconciled: false });
  useChapterUpstreamStore.setState({ byChapter: {} });
  useScriptAssetBatchStore.setState({ runsByChapter: {} });
  useDerivedChainStore.setState({ runsByChapter: {} });
  useStoryboardBindingStore.setState({ runsByChapter: {} });
});

describe("章级编排:三步串行+步间门", () => {
  it("步间门=上步任务全 terminal 才进下步(在途任务未收口不进衍生步)", async () => {
    const order: string[] = [];
    const card = await runChapterPipeline({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      gate: FAST_GATE,
      steps: {
        assets: async () => {
          order.push("assets:start");
          const id = useStudioStore.getState().startMediaTask({
            kind: "scriptAsset",
            targetId: "character:断臂散修",
            episodeId: CHAPTER_ID,
          });
          // 15ms 后任务才 terminal+子批次收口(模拟生图耗时)
          await new Promise((resolve) =>
            setTimeout(() => {
              order.push("assets:task-terminal");
              useStudioStore.getState().finishMediaTask(id);
              settleSubRun("assets");
              resolve(null);
            }, 15),
          );
          return {};
        },
        derived: async () => {
          order.push("derived:start");
          return {};
        },
        storyboardBinding: async () => {
          order.push("binding:start");
          return {};
        },
      },
    });

    // 衍生步严格在资产任务 terminal 之后启动
    expect(order.indexOf("assets:task-terminal")).toBeLessThan(order.indexOf("derived:start"));
    expect(order).toEqual(["assets:start", "assets:task-terminal", "derived:start", "binding:start"]);
    const steps = useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]?.steps;
    expect(steps?.map((step) => step.status)).toEqual(["done", "done", "done"]);
    expect(card.assets).toMatchObject({ total: 1, success: 1, failed: 0 });
    expect(card.recomputed).toBe(false);
  });

  it("failed 不阻塞:资产任务失败仍是 terminal,门放行,后续步照跑,失败进卡", async () => {
    const card = await runChapterPipeline({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      gate: FAST_GATE,
      steps: {
        assets: async () => {
          const id = useStudioStore.getState().startMediaTask({
            kind: "scriptAsset",
            targetId: "prop:青盐鞭",
            episodeId: CHAPTER_ID,
          });
          useStudioStore.getState().failMediaTask(id, "生成失败");
          settleSubRun("assets");
          return {};
        },
        derived: async () => {
          const id = useStudioStore.getState().startMediaTask({
            kind: "derivedAssetImage",
            targetId: "derived:断臂散修:重伤",
            episodeId: CHAPTER_ID,
          });
          useStudioStore.getState().finishMediaTask(id);
          settleSubRun("derived");
          return {};
        },
        storyboardBinding: async () => null,
      },
    });

    expect(card.assets).toMatchObject({ total: 1, success: 0, failed: 1 });
    expect(card.assets.failedNames).toEqual(["prop:青盐鞭"]);
    expect(card.derived).toMatchObject({ total: 1, success: 1 });
    const steps = useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]?.steps;
    // 资产步 dispatched=done(失败在行级例外,不毒步);绑定步 null 返回+无子批次=skipped
    expect(steps?.map((step) => step.status)).toEqual(["done", "done", "skipped"]);
  });

  it("步执行体抛异常:步标 failed 不阻塞,后续步照跑(编排层兜底)", async () => {
    const card = await runChapterPipeline({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      gate: FAST_GATE,
      steps: {
        assets: async () => {
          throw new Error("编排意外");
        },
        derived: async () => ({}),
        storyboardBinding: async () => ({}),
      },
    });
    const steps = useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]?.steps;
    expect(steps?.[0]).toMatchObject({ status: "failed", note: "编排意外" });
    expect(steps?.[1]?.status).toBe("done");
    expect(card.chapterId).toBe(CHAPTER_ID);
  });

  it("门超时不死锁:任务永不收口→步标 failed(注明未收口数),后续步继续,编排收口", async () => {
    const card = await runChapterPipeline({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      gate: { pollMs: 2, timeoutMs: 60 },
      steps: {
        assets: async () => {
          // 派任务但不收口(子批次恒 running)
          useStudioStore.getState().startMediaTask({
            kind: "scriptAsset",
            targetId: "prop:锁灵链",
            episodeId: CHAPTER_ID,
          });
          return {};
        },
        derived: async () => ({}),
        storyboardBinding: async () => ({}),
      },
    });
    const steps = useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]?.steps;
    expect(steps?.[0]?.status).toBe("failed");
    expect(steps?.[0]?.note).toContain("等待超时");
    expect(steps?.[0]?.note).toContain("1");
    expect(steps?.[2]?.status).toBe("done");
    expect(useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]?.status).toBe("done");
    expect(card.chapterId).toBe(CHAPTER_ID);
  });

  it("防重入:同章在途编排再触发=并入提示,不重跑任何步", async () => {
    useChapterPipelineStore.setState((state) => ({
      runsByChapter: {
        ...state.runsByChapter,
        [CHAPTER_ID]: { chapterId: CHAPTER_ID, status: "running", steps: [] },
      },
    }));
    const spy = vi.fn(async () => ({}));
    const card = await runChapterPipeline({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      gate: FAST_GATE,
      steps: { assets: spy, derived: spy, storyboardBinding: spy },
    });
    expect(spy).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("已并入在途编排"));
    // 返回的是现势聚合卡(不撒谎),在途编排不被覆盖
    expect(card.chapterId).toBe(CHAPTER_ID);
    expect(useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]?.status).toBe("running");
  });
});

describe("步间门 waitChapterStepSettled(双信号)", () => {
  it("子批次 running 但任务已全 terminal:门不放行(并入在途批次的循环还要派下一张)", async () => {
    useStudioStore.getState().startMediaTask({
      kind: "scriptAsset",
      targetId: "character:x",
      episodeId: CHAPTER_ID,
    });
    useScriptAssetBatchStore.getState().startRun(CHAPTER_ID, 2);
    const result = await waitChapterStepSettled(CHAPTER_ID, "assets", { pollMs: 2, timeoutMs: 40 });
    expect(result.settled).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it("任务 running 但子批次已收口:门不放行(等待任务 terminal)", async () => {
    const id = useStudioStore.getState().startMediaTask({
      kind: "scriptAsset",
      targetId: "character:x",
      episodeId: CHAPTER_ID,
    });
    settleSubRun("assets");
    const result = await waitChapterStepSettled(CHAPTER_ID, "assets", { pollMs: 2, timeoutMs: 40 });
    expect(result.timedOut).toBe(true);
    useStudioStore.getState().finishMediaTask(id);
    const settled = await waitChapterStepSettled(CHAPTER_ID, "assets", { pollMs: 2, timeoutMs: 40 });
    expect(settled).toEqual({ settled: true, timedOut: false, pendingCount: 0 });
  });

  it("别章任务不拦本章的门(episodeId 隔离,D6)", async () => {
    useStudioStore.getState().startMediaTask({
      kind: "scriptAsset",
      targetId: "character:别章",
      episodeId: "chapter-002",
    });
    const result = await waitChapterStepSettled(CHAPTER_ID, "assets", { pollMs: 2, timeoutMs: 40 });
    expect(result.settled).toBe(true);
  });
});

describe("章验收卡聚合(每 target 最新态;重启重算不编造)", () => {
  it("失败/成功/retry 链最新态/分镜就绪度/例外/stale 聚合口径", () => {
    useStudioStore.setState({
      mediaTasks: [
        mediaTask({ kind: "scriptAsset", targetId: "character:断臂散修", status: "success" }),
        mediaTask({ kind: "scriptAsset", targetId: "prop:青盐鞭", status: "failed", errorReason: "boom" }),
        // 同 target retry 链:最新者(success)为准,旧 failed 不重复计数
        mediaTask({ kind: "scriptAsset", targetId: "prop:锁灵链", status: "failed" }),
        mediaTask({ kind: "scriptAsset", targetId: "prop:锁灵链", status: "success", retryOf: "task-3" }),
        mediaTask({ kind: "derivedAssetImage", targetId: "derived:断臂散修:重伤", status: "failed" }),
        mediaTask({ kind: "ttsAudio", targetId: "line-1", status: "failed", episodeId: CHAPTER_ID }),
      ] as never,
      storyboards: [makeShot({ index: 1, bound: true }), makeShot({ index: 2 })] as never,
    });
    useStoryboardBindingStore.setState((state) => ({
      runsByChapter: {
        ...state.runsByChapter,
        [CHAPTER_ID]: {
          chapterId: CHAPTER_ID,
          status: "done",
          progress: { done: 2, total: 2, currentShot: "" },
          report: {
            chapterId: CHAPTER_ID,
            finishedAt: 1,
            total: 2,
            boundCount: 1,
            readyBefore: 1,
            readyAfter: 1,
            fillTriggered: false,
            exceptions: [
              {
                storyboardId: "sb-2",
                shotIndex: 2,
                status: "no-match",
                statusLabel: "零命中",
                detail: "引用资产零命中",
              },
            ],
          },
        },
      },
    }));

    const card = buildChapterAcceptanceCard(CHAPTER_ID);
    expect(card.assets).toEqual({ total: 3, success: 2, failed: 1, failedNames: ["prop:青盐鞭"] });
    expect(card.derived).toEqual({ total: 1, success: 0, failed: 1, failedNames: ["derived:断臂散修:重伤"] });
    expect(card.storyboard).toEqual({ totalShots: 2, ready: 1, unbound: 1, exceptions: 1 });
    expect(card.staleCount).toBe(0); // 无台账=不误报(批6 存量兼容)
    expect(chapterAcceptanceAllGreen(card)).toBe(false);
  });

  it("全绿判定:零失败+零例外+零 stale+分镜全绑(无分镜不算全绿)", () => {
    useStudioStore.setState({
      mediaTasks: [
        mediaTask({ kind: "scriptAsset", targetId: "character:x", status: "success" }),
        mediaTask({ kind: "derivedAssetImage", targetId: "derived:x:y", status: "success" }),
      ] as never,
      storyboards: [makeShot({ index: 1, bound: true }), makeShot({ index: 2, bound: true })] as never,
    });
    expect(chapterAcceptanceAllGreen(buildChapterAcceptanceCard(CHAPTER_ID))).toBe(true);

    // 零分镜(流水线还没产分镜)≠全绿——横幅语义是「分镜就绪」
    useStudioStore.setState({ storyboards: [] as never });
    expect(chapterAcceptanceAllGreen(buildChapterAcceptanceCard(CHAPTER_ID))).toBe(false);
  });
});

describe("断点续跑(G9):重启重算聚合不重发", () => {
  it("僵尸任务收口双防线:会话前的 running 收口 failed;会话内新发 running 不动", () => {
    useStudioStore.setState({
      mediaTasks: [
        mediaTask({ targetId: "character:僵尸", status: "running", updatedAt: 1 }), // 重启残留(早于会话启动)
        mediaTask({ targetId: "character:在途", status: "running", updatedAt: Date.now() }), // 会话内在途
        mediaTask({ targetId: "character:已成", status: "success", updatedAt: 1 }),
      ] as never,
    });

    const card = recomputeChapterPipelineAggregate(CHAPTER_ID);

    const tasks = useStudioStore.getState().mediaTasks;
    const zombie = tasks.find((task) => task.status === "failed");
    expect(zombie?.errorReason).toContain("App 重启中断");
    expect(tasks.filter((task) => task.status === "running")).toHaveLength(1);
    expect(tasks.filter((task) => task.status === "success")).toHaveLength(1);
    // 重算卡:recomputed 标记+聚合真源为台账(1 成 1 失败收口)
    expect(card.recomputed).toBe(true);
    expect(card.assets.total).toBe(2);
    expect(useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]).toMatchObject({
      status: "done",
      recomputed: true,
    });
  });

  it("重算是纯聚合:不重发任何任务(无新任务入账),在途编排不覆盖", () => {
    useStudioStore.setState({
      mediaTasks: [mediaTask({ status: "success" })] as never,
    });
    const before = useStudioStore.getState().mediaTasks.length;
    recomputeChapterPipelineAggregate(CHAPTER_ID);
    expect(useStudioStore.getState().mediaTasks.length).toBe(before);

    // 在途编排(用户会话内手动触发中)不被重算覆盖
    useChapterPipelineStore.setState((state) => ({
      runsByChapter: {
        ...state.runsByChapter,
        [CHAPTER_ID]: { chapterId: CHAPTER_ID, status: "running", steps: [] },
      },
    }));
    recomputeChapterPipelineAggregate(CHAPTER_ID);
    expect(useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]?.status).toBe("running");
  });

  it("重跑编排=聚合续跑:既有 terminal 任务按 target 去重计数,不重复生成计数", async () => {
    // 上一轮(重启前)已成的任务台账
    useStudioStore.setState({
      mediaTasks: [
        mediaTask({ kind: "scriptAsset", targetId: "character:x", status: "success" }),
        mediaTask({ kind: "scriptAsset", targetId: "prop:y", status: "success" }),
      ] as never,
      storyboards: [makeShot({ index: 1, bound: true })] as never,
    });
    const dispatchCount = { assets: 0 };
    const card = await runChapterPipeline({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      gate: FAST_GATE,
      steps: {
        // 重跑时子层幂等(已有图/同指纹跳过)在批1/2 已测;编排层注入=「跳过后空批」
        assets: async () => {
          dispatchCount.assets += 1;
          return null;
        },
        derived: async () => null,
        storyboardBinding: async () => null,
      },
    });
    expect(dispatchCount.assets).toBe(1);
    // 聚合卡沿用台账真源:2 资产成功(不因「本轮空批」清零)
    expect(card.assets).toMatchObject({ total: 2, success: 2 });
    expect(useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]?.status).toBe("done");
  });
});

describe("批6 失效传播:发车盖戳→剧本变更→stale 派生", () => {
  it("编排发车时盖戳章剧本指纹;剧本变更后已终态下游任务全 stale;重跑盖新戳清 stale", async () => {
    // 第一轮:发车(空剧本指纹)+ 一枚已终态任务
    await runChapterPipeline({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      gate: FAST_GATE,
      steps: { assets: async () => ({}), derived: async () => null, storyboardBinding: async () => null },
    });
    const ledger = useChapterUpstreamStore.getState().byChapter[CHAPTER_ID];
    expect(ledger?.scriptFingerprint).toBeTruthy();

    useStudioStore.setState({
      mediaTasks: [
        mediaTask({ kind: "scriptAsset", targetId: "character:x", status: "success" }),
        mediaTask({ kind: "derivedAssetImage", targetId: "derived:x:y", status: "success" }),
        mediaTask({ kind: "ttsAudio", targetId: "line-1", status: "success" }), // 非下游 kind 不标
      ] as never,
    });
    // 剧本重生成(批6 场景:scriptDraft 内容变更)
    useStudioStore.setState({
      agentWorkData: [
        { key: "scriptDraft", episodeId: CHAPTER_ID, data: "第一版剧本:断臂散修夜市救难", updatedAt: 1 },
      ] as never,
    });

    let stale = collectStaleDownstreamTasksFromStore(CHAPTER_ID);
    // 注意:第一轮盖戳时剧本为空;注入 scriptDraft 后指纹漂移
    expect(stale.map((item) => item.targetId).sort()).toEqual(["character:x", "derived:x:y"]);

    // 重跑章流水线=以现势剧本盖新戳 → stale 清空(禁静默用旧的解药是重跑)
    await runChapterPipeline({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      gate: FAST_GATE,
      steps: { assets: async () => ({}), derived: async () => null, storyboardBinding: async () => null },
    });
    stale = collectStaleDownstreamTasksFromStore(CHAPTER_ID);
    expect(stale).toEqual([]);
  });
});
