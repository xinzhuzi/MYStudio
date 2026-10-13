import { describe, expect, it } from "vitest";
import {
  latestAgentWork,
  resolveProductionEpisodeId,
  resolveScriptTextForEpisode,
  scriptPlanSourceFingerprint,
  stableRunFingerprint,
  tryResolveProductionEpisodeId,
} from "./workflow-helpers";

describe("latestAgentWork chapter isolation", () => {
  const records = [
    {
      key: "storyboardTable" as const,
      episodeId: "chapter-1",
      data: "第一章分镜",
      updatedAt: 1,
    },
    {
      key: "storyboardTable" as const,
      episodeId: "chapter-2",
      data: "第二章分镜",
      updatedAt: 2,
    },
  ];

  it("returns the current chapter record when it exists", () => {
    expect(latestAgentWork(records, "storyboardTable", "chapter-1")).toBe("第一章分镜");
  });

  it("does not fall back to another chapter in strict mode", () => {
    expect(
      latestAgentWork(records, "storyboardTable", "chapter-3", {
        allowUnscopedFallback: false,
      }),
    ).toBe("");
  });

  it("keeps legacy unscoped fallback opt-in for non-storyboard callers", () => {
    expect(latestAgentWork(records, "storyboardTable", "chapter-3")).toBe("第二章分镜");
  });
});

describe("scriptPlanSourceFingerprint 预划剧本锚(二期 R1)", () => {
  it("stableRunFingerprint 对对象 key 顺序不敏感(确定性序列化)", () => {
    expect(stableRunFingerprint({ b: 1, a: { y: 2, x: 3 } }))
      .toBe(stableRunFingerprint({ a: { x: 3, y: 2 }, b: 1 }));
  });

  it("同章同剧本 → 同指纹;剧本改一个字或换章 → 指纹变", () => {
    const base = scriptPlanSourceFingerprint("chapter-001", "第一场金水河码头。");
    expect(scriptPlanSourceFingerprint("chapter-001", "第一场金水河码头。")).toBe(base);
    expect(scriptPlanSourceFingerprint("chapter-001", "第一场金水河码头!")).not.toBe(base);
    expect(scriptPlanSourceFingerprint("chapter-002", "第一场金水河码头。")).not.toBe(base);
  });

  it("指纹只含章 id 与剧本正文,不含人工指令字段", () => {
    const episodeId = "chapter-001";
    const scriptText = "第一场金水河码头。";
    const parsed = JSON.parse(scriptPlanSourceFingerprint(episodeId, scriptText)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["episodeId", "scriptText"]);
  });
});

// ── 批2 D6(10-13-audit4-downstream):无草稿不回落第 1 章 ────────────────────────
// 现实现(workflow-helpers.ts:78-85)在无 scriptDraft 时 `?? novelChapters[0]?.id`
// 回落第 1 章——多章项目里「第 2 章的规划动作拿到第 1 章的章身份」。设计 §2 D6
// 定稿:回落序改为 activeChapterId ?? 报错(当前章=activeChapterId,依赖 G1 已把
// 真源接活,studio-store.ts:91)。
//
// GitNexus impact(2026-10-14 实跑,upstream):CRITICAL——23 符号/13 直接调用方/
// 7 流程/6 模块(d1=AppOrb、ComfyCanvasStudio 四入口、useChapterStoryboards、
// handleEntityExtraction、handleDirectorPlan、useStudioViewModel、
// useWorkflowNodeEditor 三入口、resolveScriptPlanEpisodeId)。下方 legacy 锁
// (episode-1 草稿在场/显式章 id 直通)就是多调用方兼容面的回归护栏。

type SnapshotParam = Parameters<typeof resolveProductionEpisodeId>[0];

function draftEntry(overrides: {
  id: string;
  episodeId: string;
  data: string;
  updatedAt: number;
}) {
  return { key: "scriptDraft" as const, createdAt: overrides.updatedAt, ...overrides };
}

function makeStore(options: {
  agentWorkData?: ReturnType<typeof draftEntry>[];
  novelChapters?: Array<{ id: string; sourceText?: string }>;
  scriptPlans?: Array<{ episodeId: string }>;
  /** GREEN 将把 activeChapterId 加进 WorkflowStoreSnapshot(design §2 D6);RED 期以断言面先行。 */
  activeChapterId?: string | null;
}): SnapshotParam {
  return {
    agentWorkData: options.agentWorkData ?? [],
    novelChapters: options.novelChapters ?? [],
    scriptPlans: options.scriptPlans ?? [],
    ...(options.activeChapterId === undefined ? {} : { activeChapterId: options.activeChapterId }),
  } as unknown as SnapshotParam;
}

describe("D6 · resolveProductionEpisodeId 无草稿不回落第 1 章", () => {
  it("无草稿 + activeChapterId 存在 → 返 activeChapterId(不再 novelChapters[0])", () => {
    const store = makeStore({
      novelChapters: [{ id: "chapter-001" }, { id: "chapter-002" }],
      activeChapterId: "chapter-002",
    });
    expect(resolveProductionEpisodeId(store, "episode-1")).toBe("chapter-002");
  });

  it("无草稿 + activeChapterId 空 + 无章 → 报错语义(不再静默返 episode-1)", () => {
    const store = makeStore({ activeChapterId: null, novelChapters: [] });
    expect(() => resolveProductionEpisodeId(store, "episode-1")).toThrow();
  });

  it("兼容锁:legacy episode-1 项目(episode-1 草稿在场)行为不回归——legacy 分支优先于 activeChapterId", () => {
    const store = makeStore({
      agentWorkData: [draftEntry({ id: "d-legacy", episodeId: "episode-1", data: "老单章草稿", updatedAt: 1 })],
      novelChapters: [{ id: "chapter-001" }, { id: "chapter-002" }],
      activeChapterId: "chapter-002",
    });
    expect(resolveProductionEpisodeId(store, "episode-1")).toBe("episode-1");
  });

  it("兼容锁:显式非 episode-1 章号直通,不走任何回落", () => {
    const store = makeStore({
      novelChapters: [{ id: "chapter-001" }],
      activeChapterId: "chapter-001",
    });
    expect(resolveProductionEpisodeId(store, "chapter-009")).toBe("chapter-009");
  });
});

// ── 批3 D7(10-13-audit4-downstream):最新草稿取法收敛单源(按 updatedAt) ─────────
// 双口径现状:数组序 `.reverse().find`(workflow-helpers.ts:79-81/:93-95/:101-103)
// vs updatedAt 排序(latestAgentWork,:64)。两口径在「数组序 ≠ updatedAt 序」时
// 各说各话——本组用例先锁「按 updatedAt」为唯一语义(GREEN 收敛为共享函数)。

describe("D7 · 最新草稿取法按 updatedAt(双口径收敛)", () => {
  it("同章两条草稿:数组序靠后 ≠ updatedAt 最新 → 取 updatedAt 最新(现实现取数组序,必红)", () => {
    const store = makeStore({
      agentWorkData: [
        draftEntry({ id: "d-new", episodeId: "chapter-001", data: "updatedAt 最新的草稿", updatedAt: 200 }),
        draftEntry({ id: "d-old", episodeId: "chapter-001", data: "数组序靠后的旧草稿", updatedAt: 100 }),
      ],
      novelChapters: [],
    });
    expect(resolveScriptTextForEpisode(store, "chapter-001")).toBe("updatedAt 最新的草稿");
  });

  it("跨章两条草稿:数组序靠后 ≠ updatedAt 最新 → 章身份取 updatedAt 最新的章(现实现取数组序,必红)", () => {
    const store = makeStore({
      agentWorkData: [
        draftEntry({ id: "d-1", episodeId: "chapter-001", data: "updatedAt 最新的草稿", updatedAt: 200 }),
        draftEntry({ id: "d-2", episodeId: "chapter-002", data: "数组序靠后的旧草稿", updatedAt: 100 }),
      ],
      novelChapters: [{ id: "chapter-001" }, { id: "chapter-002" }],
    });
    expect(resolveProductionEpisodeId(store, "episode-1")).toBe("chapter-001");
  });

  it("兼容锁:数组序与 updatedAt 序一致时,语义与现状逐位一致", () => {
    const store = makeStore({
      agentWorkData: [
        draftEntry({ id: "d-1", episodeId: "chapter-001", data: "旧", updatedAt: 100 }),
        draftEntry({ id: "d-2", episodeId: "chapter-002", data: "新", updatedAt: 200 }),
      ],
      novelChapters: [{ id: "chapter-001" }, { id: "chapter-002" }],
    });
    expect(resolveProductionEpisodeId(store, "episode-1")).toBe("chapter-002");
    expect(resolveScriptTextForEpisode(store, "chapter-002")).toBe("新");
  });

  // D6 配套安全变体:渲染/订阅比对面(视图模型/章分镜 hook/AppOrb/ComfyCanvas)
  // 无「报错」出口——不可定位返 null 由调用方回落哨兵,动作面仍走严格版抛错。
  it("D6 安全变体:tryResolveProductionEpisodeId 不可定位返 null,可定位返章号(渲染回落锁)", () => {
    expect(
      tryResolveProductionEpisodeId(makeStore({ activeChapterId: null, novelChapters: [] })),
    ).toBeNull();
    expect(
      tryResolveProductionEpisodeId(makeStore({
        agentWorkData: [draftEntry({ id: "d-1", episodeId: "chapter-007", data: "草稿", updatedAt: 1 })],
      })),
    ).toBe("chapter-007");
    expect(
      tryResolveProductionEpisodeId(makeStore({ activeChapterId: "chapter-002" })),
    ).toBe("chapter-002");
  });
});
