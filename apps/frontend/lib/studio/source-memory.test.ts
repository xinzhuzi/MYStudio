// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExtractionMessages,
  parseExtractionRecords,
  readBibleWithArchiveContext,
  retrieveArchiveContext,
  runSourceMemoryExtraction,
} from "./source-memory";
import type { SourceMemoryExtractionChunk, SourceMemoryStagedRecord } from "@/types/source-memory";

const chunk: SourceMemoryExtractionChunk = {
  sourcePath: "novel/chapters/chapter-001.md",
  sourceSha256: "a".repeat(64),
  chapterId: "chapter-001",
  anchor: "第1章 剑主夜访",
  title: "第1章 剑主夜访",
  text: "晏燎夜访道口镇，遇见绯樱。",
};

function recordJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([
    {
      kind: "character",
      title: "晏燎",
      body: "剑主，夜访道口镇",
      entities: ["晏燎"],
      confidence: 0.9,
      ...overrides,
    },
  ]);
}

describe("parseExtractionRecords", () => {
  it("解析围栏/杂文包裹的 JSON 数组并从 chunk 注入 provenance（不信任 AI 回传来源）", () => {
    const fenced = "以下是结果：\n```json\n" + recordJson({ sourcePath: "novel/evil.md" }) + "\n```";
    const records = parseExtractionRecords(fenced, chunk);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "character",
      title: "晏燎",
      sourcePath: "novel/chapters/chapter-001.md",
      sourceSha256: "a".repeat(64),
      chapterId: "chapter-001",
      anchor: "第1章 剑主夜访",
    });
  });

  it("空数组合法（无事实片段）", () => {
    expect(parseExtractionRecords("[]", chunk)).toEqual([]);
  });

  it("非法 kind / 缺 title / 超 body 上限 → 整批拒收", () => {
    expect(() => parseExtractionRecords(recordJson({ kind: "villain" }), chunk)).toThrow();
    expect(() => parseExtractionRecords(recordJson({ title: "" }), chunk)).toThrow();
    expect(() => parseExtractionRecords(recordJson({ body: "长".repeat(301) }), chunk)).toThrow();
    expect(() => parseExtractionRecords("不是 JSON", chunk)).toThrow();
    expect(() => parseExtractionRecords("{}", chunk)).toThrow();
  });

  it("超过单片段 24 条上限 → 整批拒收", () => {
    const many = JSON.stringify(
      Array.from({ length: 25 }, () => ({ kind: "term", title: "t", body: "b", entities: [], confidence: 1 })),
    );
    expect(() => parseExtractionRecords(many, chunk)).toThrow();
  });

  it("11 类 kind 全部被接受", () => {
    const all = JSON.stringify(
      [
        "character",
        "alias",
        "relation",
        "event",
        "timeline",
        "world-rule",
        "term",
        "location",
        "object",
        "foreshadowing",
        "adaptation-redline",
      ].map((kind) => ({ kind, title: kind, body: "事实", entities: [], confidence: 1 })),
    );
    expect(parseExtractionRecords(all, chunk)).toHaveLength(11);
  });
});

describe("buildExtractionMessages", () => {
  it("system 声明 11 类 kind 契约，user 带出处头与片段正文", () => {
    const messages = buildExtractionMessages(chunk);
    for (const kind of ["character", "alias", "adaptation-redline"]) {
      expect(messages.system).toContain(kind);
    }
    expect(messages.user).toContain("novel/chapters/chapter-001.md");
    expect(messages.user).toContain("晏燎夜访道口镇");
  });
});

function fakeBridge(options?: {
  buildReply?: {
    success: boolean;
    buildId?: string;
    plan?: { buildId: string; chunks: SourceMemoryExtractionChunk[]; changedSources: number };
  };
  stageReply?: { success: boolean; rejected?: number; error?: string };
  commitReply?: { success: boolean; status?: string; failedChunks?: number };
}) {
  const calls = {
    staged: [] as SourceMemoryStagedRecord[][],
    commits: [] as Array<{ buildId: string; coverage?: Array<{ sourcePath: string; anchor: string; ok: boolean }> }>,
  };
  const bridge = {
    build: vi.fn(async () =>
      options?.buildReply ?? {
        success: true,
        buildId: "b1",
        plan: {
          buildId: "b1",
          chunks: [chunk, { ...chunk, anchor: "第2章", chapterId: "chapter-002", sourcePath: "novel/chapters/chapter-002.md" }],
          changedSources: 2,
          carriedStructuredCount: 0,
        },
      },
    ),
    stageRecords: vi.fn(async (_p: string, _b: string, records: SourceMemoryStagedRecord[]) => {
      calls.staged.push(records);
      return options?.stageReply ?? { success: true, accepted: records.length, rejected: 0 };
    }),
    commitBuild: vi.fn(async (_p: string, payload: { buildId: string }) => {
      calls.commits.push(payload);
      return options?.commitReply ?? { success: true, status: "ready", structuredCount: 2, rawCount: 3 };
    }),
    search: vi.fn(async () => ({ success: true, hits: [] })),
  };
  return { bridge, calls };
}

describe("runSourceMemoryExtraction 编排", () => {
  it("无变化章节 → nothing-to-do 且不 stage/commit", async () => {
    const { bridge, calls } = fakeBridge({ buildReply: { success: true, buildId: "b1" } });
    const summary = await runSourceMemoryExtraction({
      projectId: "p1",
      bridge: bridge as never,
      callText: async () => "[]",
    });
    expect(summary.status).toBe("nothing-to-do");
    expect(calls.staged).toHaveLength(0);
    expect(calls.commits).toHaveLength(0);
  });

  it("全部成功 → ready，commit coverage 全 ok", async () => {
    const { bridge, calls } = fakeBridge();
    const summary = await runSourceMemoryExtraction({
      projectId: "p1",
      bridge: bridge as never,
      callText: async () => recordJson(),
    });
    expect(summary.status).toBe("ready");
    expect(calls.staged).toHaveLength(2);
    const coverage = calls.commits[0]!.coverage!;
    expect(coverage).toHaveLength(2);
    expect(coverage.every((c) => c.ok)).toBe(true);
  });

  it("单块 AI 失败 → partial 且失败块计入 coverage", async () => {
    const { bridge, calls } = fakeBridge({
      commitReply: { success: true, status: "partial", failedChunks: 1 },
    });
    let call = 0;
    const summary = await runSourceMemoryExtraction({
      projectId: "p1",
      bridge: bridge as never,
      callText: async () => {
        call += 1;
        if (call === 1) throw new Error("AI 超时");
        return recordJson();
      },
    });
    expect(summary.status).toBe("partial");
    const coverage = calls.commits[0]!.coverage!;
    expect(coverage.filter((c) => !c.ok)).toHaveLength(1);
  });

  it("plan-stale → 整体失败中止", async () => {
    const { bridge } = fakeBridge({
      stageReply: { success: false, error: "plan-stale：源已变化，请重新构建" },
    });
    const summary = await runSourceMemoryExtraction({
      projectId: "p1",
      bridge: bridge as never,
      callText: async () => recordJson(),
    });
    expect(summary.success).toBe(false);
    expect(summary.error).toContain("plan-stale");
  });

  it("并发不超上限且进度回调单调推进", async () => {
    const { bridge } = fakeBridge();
    const chunks = Array.from({ length: 6 }, (_, i) => ({ ...chunk, anchor: `第${i}章` }));
    bridge.build.mockResolvedValue({
      success: true,
      buildId: "b1",
      plan: { buildId: "b1", chunks, changedSources: 6, carriedStructuredCount: 0 },
    });
    let inFlight = 0;
    let peak = 0;
    const progressLog: number[] = [];
    const summary = await runSourceMemoryExtraction({
      projectId: "p1",
      bridge: bridge as never,
      concurrency: 2,
      callText: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return recordJson();
      },
      onProgress: (p) => progressLog.push(p.done),
    });
    expect(summary.status).toBe("ready");
    expect(peak).toBeLessThanOrEqual(2);
    expect(progressLog.at(-1)).toBe(6);
  });
});

describe("检索门面（L3）", () => {
  afterEach(() => {
    delete (window as unknown as { sourceMemory?: unknown }).sourceMemory;
    delete (window as unknown as { projectFiles?: unknown }).projectFiles;
  });

  it("桥可用且命中 → 单块档案检索文本；圣经块追加其后", async () => {
    (window as unknown as { sourceMemory?: unknown }).sourceMemory = {
      search: vi.fn(async () => ({
        success: true,
        hits: [
          {
            recordId: "structured:character:x",
            kind: "character",
            title: "晏燎",
            sourcePath: "novel/chapters/chapter-001.md",
            anchor: "第1章",
            score: -1,
            snippet: "剑主，夜访道口镇",
          },
        ],
      })),
    };
    const archive = await retrieveArchiveContext({ projectId: "p1", query: "晏燎" });
    expect(archive).toContain("## 原著档案检索");
    expect(archive).toContain("晏燎");

    const combined = await readBibleWithArchiveContext({
      projectId: "p1",
      storeFallback: "# 原著圣经\n\n## 主要人物\n- 晏燎：剑主\n",
      archiveQuery: "晏燎",
    });
    // 常驻块唯一：圣经优先级头在前，档案检索追加其后
    expect(combined!.indexOf("原著圣经（最高优先级")).toBeGreaterThanOrEqual(0);
    expect(combined!.indexOf("## 原著档案检索")).toBeGreaterThan(combined!.indexOf("原著圣经（最高优先级"));
    expect(combined!.match(/原著档案检索/g)).toHaveLength(1);
  });

  it("无桥 / 检索抛错 / 零命中 → undefined 零注入零阻断", async () => {
    expect(await retrieveArchiveContext({ projectId: "p1", query: "晏燎" })).toBeUndefined();
    (window as unknown as { sourceMemory?: unknown }).sourceMemory = {
      search: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    expect(await retrieveArchiveContext({ projectId: "p1", query: "晏燎" })).toBeUndefined();
    (window as unknown as { sourceMemory?: unknown }).sourceMemory = {
      search: vi.fn(async () => ({ success: true, hits: [] })),
    };
    expect(await retrieveArchiveContext({ projectId: "p1", query: "晏燎" })).toBeUndefined();
  });

  it("空圣经空档案 → undefined（空值逐字节兼容）", async () => {
    expect(
      await readBibleWithArchiveContext({ projectId: "p1", storeFallback: "", archiveQuery: "x" }),
    ).toBeUndefined();
  });
});
