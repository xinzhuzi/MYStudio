// @vitest-environment jsdom
/**
 * 批6 失效传播单测(10-11 pipeline-human-node-automation,D4/design §2.7):
 * 指纹口径(复用 scriptPlanSourceFingerprint,零新造)、发车台账幂等盖戳、
 * 漂移判定(无台账不误报)、stale 收集过滤(下游 kind/已终态/本章隔离)。
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { MediaGenerationTask } from "@/types/studio";
import {
  chapterUpstreamDrifted,
  collectStaleDownstreamTasks,
  computeChapterScriptFingerprint,
  DOWNSTREAM_TASK_KINDS,
  STALE_REASON,
  useChapterUpstreamStore,
  type ScriptFingerprintSnapshot,
} from "./chapter-pipeline-stale";

const CHAPTER_ID = "chapter-001";

function snapshot(scriptText?: string): ScriptFingerprintSnapshot {
  return scriptText === undefined
    ? { agentWorkData: [], novelChapters: [], scriptPlans: [] }
    : {
        agentWorkData: [
          { key: "scriptDraft", episodeId: CHAPTER_ID, data: scriptText, updatedAt: 1 },
        ],
        novelChapters: [],
        scriptPlans: [],
      };
}

function task(overrides: Partial<MediaGenerationTask> = {}): MediaGenerationTask {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    kind: "scriptAsset",
    status: "success",
    targetId: "character:断臂散修",
    episodeId: CHAPTER_ID,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  useChapterUpstreamStore.setState({ byChapter: {} });
});

describe("指纹口径(复用 scriptPlanSourceFingerprint)", () => {
  it("同输入同指纹;剧本变更指纹变;不同章同文本指纹不同(章归属入戳)", () => {
    const a = computeChapterScriptFingerprint(CHAPTER_ID, snapshot("剧本 A"));
    const b = computeChapterScriptFingerprint(CHAPTER_ID, snapshot("剧本 A"));
    const c = computeChapterScriptFingerprint(CHAPTER_ID, snapshot("剧本 B(重生成)"));
    const otherChapter = computeChapterScriptFingerprint("chapter-002", snapshot("剧本 A"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(otherChapter);
  });

  it("剧本落小说正文时同样吃进指纹(novelChapters.sourceText 回落链)", () => {
    const fromDraft = computeChapterScriptFingerprint(CHAPTER_ID, snapshot("同一份正文"));
    const fromSource = computeChapterScriptFingerprint(CHAPTER_ID, {
      agentWorkData: [],
      novelChapters: [{ id: CHAPTER_ID, sourceText: "同一份正文" }],
      scriptPlans: [],
    });
    expect(fromDraft).toBe(fromSource);
  });
});

describe("发车台账(recordDispatch)", () => {
  it("同指纹重复盖戳幂等;新指纹更新时间戳", () => {
    const store = useChapterUpstreamStore.getState();
    store.recordDispatch(CHAPTER_ID, "fp-1");
    const first = useChapterUpstreamStore.getState().byChapter[CHAPTER_ID];
    store.recordDispatch(CHAPTER_ID, "fp-1");
    expect(useChapterUpstreamStore.getState().byChapter[CHAPTER_ID]).toBe(first);
    useChapterUpstreamStore.getState().recordDispatch(CHAPTER_ID, "fp-2");
    expect(useChapterUpstreamStore.getState().byChapter[CHAPTER_ID]?.scriptFingerprint).toBe("fp-2");
  });
});

describe("漂移判定(chapterUpstreamDrifted)", () => {
  it("无台账=不误报(存量数据/未跑过流水线);同指纹不漂移;变更即漂移", () => {
    const ledgerNone: Record<string, never> = {};
    expect(
      chapterUpstreamDrifted({ chapterId: CHAPTER_ID, snapshot: snapshot("剧本"), ledger: ledgerNone }),
    ).toBe(false);

    const fp = computeChapterScriptFingerprint(CHAPTER_ID, snapshot("剧本 v1"));
    useChapterUpstreamStore.getState().recordDispatch(CHAPTER_ID, fp);
    const ledger = useChapterUpstreamStore.getState().byChapter;
    expect(chapterUpstreamDrifted({ chapterId: CHAPTER_ID, snapshot: snapshot("剧本 v1"), ledger })).toBe(false);
    expect(chapterUpstreamDrifted({ chapterId: CHAPTER_ID, snapshot: snapshot("剧本 v2"), ledger })).toBe(true);
  });
});

describe("stale 收集(collectStaleDownstreamTasks)", () => {
  it("漂移后:本章已终态下游任务全 stale;非下游 kind/在途任务/别章任务不标", () => {
    const fp = computeChapterScriptFingerprint(CHAPTER_ID, snapshot("剧本 v1"));
    useChapterUpstreamStore.getState().recordDispatch(CHAPTER_ID, fp);
    const ledger = useChapterUpstreamStore.getState().byChapter;

    const stale = collectStaleDownstreamTasks({
      chapterId: CHAPTER_ID,
      mediaTasks: [
        task({ id: "a", kind: "scriptAsset", targetId: "character:x", status: "success" }),
        task({ id: "b", kind: "derivedAssetImage", targetId: "derived:x:y", status: "failed" }),
        task({ id: "c", kind: "storyboardImage", targetId: "sb-1", status: "success" }),
        // 非下游 kind:不标
        task({ id: "d", kind: "ttsAudio", targetId: "line-1", status: "success" }),
        // 在途任务:产物还没定论,不标(terminal 化时再判)
        task({ id: "e", kind: "scriptAsset", targetId: "character:z", status: "running" }),
        // 别章任务:章隔离(D6)
        task({ id: "f", kind: "scriptAsset", targetId: "character:other", status: "success", episodeId: "chapter-002" }),
      ],
      snapshot: snapshot("剧本 v2(重生成)"),
      ledger,
    });

    expect(stale.map((item) => item.taskId).sort()).toEqual(["a", "b", "c"]);
    expect(stale.every((item) => item.reason === STALE_REASON)).toBe(true);
    expect(DOWNSTREAM_TASK_KINDS).toContain("scriptAsset");
  });

  it("未漂移:零 stale(禁静默用旧的判定只对真变更发难)", () => {
    const fp = computeChapterScriptFingerprint(CHAPTER_ID, snapshot("剧本 v1"));
    useChapterUpstreamStore.getState().recordDispatch(CHAPTER_ID, fp);
    const stale = collectStaleDownstreamTasks({
      chapterId: CHAPTER_ID,
      mediaTasks: [task({ kind: "scriptAsset", status: "success" })],
      snapshot: snapshot("剧本 v1"),
      ledger: useChapterUpstreamStore.getState().byChapter,
    });
    expect(stale).toEqual([]);
  });
});

// ── 批3 D5(10-13-audit4-downstream,裁定⑤):分镜层过期判定 ─────────────────────
// design §3 D5:分镜条目同记 sourceScript 指纹(条目 id+updatedAt,与 G3 reviewTarget
// 同形态);chapter-pipeline-stale.ts 覆盖分镜层过期判定——无指纹=不标过期(回落现
// 行为),有指纹且 updatedAt 不等=标过期+软提示可继续。
//
// GREEN API(design §3 定稿形态,本组用例以动态 import 探测,避免静态导入缺失
// 导出把既有用例整文件带红):storyboardSourceStale(input) → boolean | undefined
//   - undefined = 无 sourceScript(旧数据)或无法判定 → 回落,不标过期
//   - false     = 条目 id+updatedAt 与现势草稿一致
//   - true      = 剧本已改,分镜基于旧剧本(软标,不硬拦)

interface StoryboardSourceStaleFn {
  (input: {
    sourceScript?: { entryId: string; updatedAt: number };
    latestScriptEntry?: { id: string; updatedAt: number } | null;
  }): boolean | undefined;
}

async function loadStoryboardSourceStale(): Promise<StoryboardSourceStaleFn | undefined> {
  const mod = (await import("./chapter-pipeline-stale")) as Record<string, unknown>;
  return typeof mod.storyboardSourceStale === "function"
    ? (mod.storyboardSourceStale as StoryboardSourceStaleFn)
    : undefined;
}

describe("D5 · chapter-pipeline-stale 覆盖分镜层过期(storyboardSourceStale)", () => {
  it("导出存在(RED:现实现无此导出)", async () => {
    expect(await loadStoryboardSourceStale()).toBeTypeOf("function");
  });

  it("旧数据无指纹(条目无 sourceScript)→ undefined,不标过期(回落现行为)", async () => {
    const storyboardSourceStale = await loadStoryboardSourceStale();
    expect(
      storyboardSourceStale?.({
        latestScriptEntry: { id: "draft-1", updatedAt: 1 },
      }),
    ).toBeUndefined();
    expect(
      storyboardSourceStale?.({
        sourceScript: undefined,
        latestScriptEntry: { id: "draft-1", updatedAt: 1 },
      }),
    ).toBeUndefined();
  });

  it("有指纹且条目 id+updatedAt 与现势草稿一致 → false(未过期)", async () => {
    const storyboardSourceStale = await loadStoryboardSourceStale();
    expect(
      storyboardSourceStale?.({
        sourceScript: { entryId: "draft-1", updatedAt: 7 },
        latestScriptEntry: { id: "draft-1", updatedAt: 7 },
      }),
    ).toBe(false);
  });

  it("有指纹但剧本已改(id 或 updatedAt 不等)→ true(软标过期)", async () => {
    const storyboardSourceStale = await loadStoryboardSourceStale();
    expect(
      storyboardSourceStale?.({
        sourceScript: { entryId: "draft-1", updatedAt: 7 },
        latestScriptEntry: { id: "draft-1", updatedAt: 9 },
      }),
    ).toBe(true);
    expect(
      storyboardSourceStale?.({
        sourceScript: { entryId: "draft-1", updatedAt: 7 },
        latestScriptEntry: { id: "draft-2", updatedAt: 7 },
      }),
    ).toBe(true);
  });
});
