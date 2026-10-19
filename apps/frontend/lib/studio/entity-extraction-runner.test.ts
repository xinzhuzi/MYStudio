// @vitest-environment jsdom
// 全书提取执行器 + 单章共用管线(C1 Step 7/9,TDD 先红后绿)。
// 覆盖面:
// - extractChapterEntities(共用管线):D22 输入解析(scriptDraft>drama,无小说回落)、
//   call_failed 原样透传(throw 位再深串化)、空表、dedupe 命中 known、指纹公式;
// - runEntityExtraction:逐章调度/台账续跑(指纹未变零调用,AC2)/1308 挂起到点续跑
//   (AC7)/transient 退避 2 次/fatal 续跑/单例防重入/pause/D26 模型漂移挂起留痕
//   (AC17)/D20 bypass 旁路(model 覆写+独立台账+不落章分片三库,AC14)/晋升
//   (D10:≥2 章或已在三库;未晋升伪 id 留批)/D11 linkedEpisodeId=firstChapterId。
import { describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_INDEX_RELATIVE_PATH,
  parseAppearanceIndex,
} from "./entity-appearances";
import {
  EXTRACTION_LEDGER_RELATIVE_PATH,
  parseLedgerJson,
  type LedgerStorage,
} from "./entity-extraction-ledger";
import { scriptPlanSourceFingerprint } from "@/components/panels/studio/workflow-helpers";
import {
  computeInputFingerprint,
  extractChapterEntities,
  isEntityExtractionInFlight,
  pauseEntityExtraction,
  runEntityExtraction,
  type EntityExtractionRunnerDeps,
  type EntityModelCall,
} from "./entity-extraction-runner";

// ── 测试基建 ───────────────────────────────────────────────────────────────

const DRAMA_1 = "第1章 断剑为谁而鸣\n场次:山门\n人物:林晚、老道\n正文……";
const DRAMA_2 = "第2章 夜雨入城\n场次:北坡\n人物:林晚\n正文……";

const ROWS_1 = [
  "| character | 林晚 |  |  | 青衫剑修 |",
  "| scene | 山门 |  |  | 云雾缭绕 |",
].join("\n");
const ROWS_2 = [
  "| character | 林晚 |  |  | 青衫剑修 |",
  "| scene | 北坡 |  |  | 夜雨 |",
].join("\n");

const FIXED_NOW = new Date(2026, 9, 19, 12, 0, 0).getTime();
const QUOTA_RESET_AT = new Date(2026, 9, 19, 22, 53, 31).getTime();
const QUOTA_ERROR_TEXT =
  "[1308] 已达到 5 小时的使用上限(2026-10-19 22:53:31 重置)";

function makeStorage(files: Map<string, string> = new Map()): LedgerStorage & {
  writes: Array<[string, string]>;
  moves: Array<[string, string]>;
  paths(): string[];
} {
  const writes: Array<[string, string]> = [];
  const moves: Array<[string, string]> = [];
  return {
    writes,
    moves,
    paths: () => [...files.keys()],
    readText: async (path) => files.get(path) ?? null,
    writeText: async (path, value) => {
      writes.push([path, value]);
      files.set(path, value);
    },
    move: async (from, to) => {
      moves.push([from, to]);
      const value = files.get(from);
      if (value === undefined) throw new Error(`missing tmp: ${from}`);
      files.delete(from);
      files.set(to, value);
    },
  };
}

interface DepsHarness {
  deps: EntityExtractionRunnerDeps;
  storage: ReturnType<typeof makeStorage>;
  modelCall: ReturnType<typeof vi.fn<EntityModelCall>>;
  saveEntityExtraction: ReturnType<typeof vi.fn>;
  createSinks: ReturnType<typeof vi.fn>;
  addCharacter: ReturnType<typeof vi.fn>;
  updateCharacter: ReturnType<typeof vi.fn>;
  addScene: ReturnType<typeof vi.fn>;
  updateScene: ReturnType<typeof vi.fn>;
  libraryEntities: Array<{
    id: string;
    kind: "character" | "scene" | "prop";
    name: string;
    aliases: string[];
  }>;
  sleeps: number[];
  resolvedModels: string[];
}

function makeDeps(overrides: Partial<EntityExtractionRunnerDeps> = {}): DepsHarness {
  const storage = makeStorage(
    new Map([
      ["novel/drama/chapter-001_漫剧.md", DRAMA_1],
      ["novel/drama/chapter-002_漫剧.md", DRAMA_2],
    ]),
  );
  const modelCall = vi.fn<EntityModelCall>();
  const saveEntityExtraction = vi.fn();
  const addCharacter = vi.fn(() => "char_new_1");
  const updateCharacter = vi.fn();
  const addScene = vi.fn(() => "scene_new_1");
  const updateScene = vi.fn();
  const createSinks = vi.fn(() => ({
    characterSink: {
      addCharacter,
      updateCharacter,
      getOrCreateProjectFolder: vi.fn(() => "char_folder_1"),
    },
    sceneSink: {
      addScene,
      updateScene,
      getOrCreateProjectFolder: vi.fn(() => "scene_folder_1"),
    },
  }));
  const libraryEntities: Array<{
    id: string;
    kind: "character" | "scene" | "prop";
    name: string;
    aliases: string[];
  }> = [];
  const sleeps: number[] = [];
  const resolvedModels = ["glm-5.3"];

  const deps: EntityExtractionRunnerDeps = {
    projectId: "proj-1",
    projectName: "道劫",
    storage,
    readDramaFile: async (path) =>
      storage.readText(path).then((text) =>
        text === null
          ? { success: false, error: "ENOENT" }
          : { success: true, text },
      ),
    modelCall,
    getScriptDraft: async () => null,
    saveEntityExtraction,
    createSinks,
    getLibraryEntities: () => libraryEntities,
    getResolvedModel: () => resolvedModels[resolvedModels.length - 1] ?? null,
    getChapterIdentity: () => null,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => FIXED_NOW,
    ...overrides,
  };
  return {
    deps,
    storage,
    modelCall,
    saveEntityExtraction,
    createSinks,
    addCharacter,
    updateCharacter,
    addScene,
    updateScene,
    libraryEntities,
    sleeps,
    resolvedModels,
  };
}

async function readLedgerFrom(h: DepsHarness): Promise<ReturnType<typeof parseLedgerJson>> {
  return parseLedgerJson((await h.storage.readText(EXTRACTION_LEDGER_RELATIVE_PATH)) ?? "");
}

async function readIndexFrom(h: DepsHarness): Promise<ReturnType<typeof parseAppearanceIndex>> {
  return parseAppearanceIndex(
    (await h.storage.readText(APPEARANCE_INDEX_RELATIVE_PATH)) ?? "",
  );
}

// ── 共用管线 extractChapterEntities ────────────────────────────────────────

describe("extractChapterEntities · D22 输入解析(scriptDraft > drama,无小说回落)", () => {
  it("有 scriptDraft 时优先草稿,drama 通道不读;指纹公式=scriptPlanSourceFingerprint", async () => {
    const modelCall = vi.fn<EntityModelCall>().mockResolvedValue({
      success: true,
      text: ROWS_1,
    });
    const readDramaFile = vi.fn(async () => ({ success: true, text: "drama" }));

    const result = await extractChapterEntities({
      episodeId: "chapter-001",
      scriptDraft: "草稿正文",
      readDramaFile,
      modelCall,
    });

    expect(readDramaFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "success", inputSource: "scriptDraft" });
    if (result.status !== "success") return;
    expect(result.scriptText).toBe("草稿正文");
    expect(result.scriptFingerprint).toBe(
      scriptPlanSourceFingerprint("chapter-001", "草稿正文"),
    );
    expect(modelCall).toHaveBeenCalledTimes(1);
  });

  it("无草稿回落 drama,路径按章号补零(novel/drama/chapter-002_漫剧.md)", async () => {
    const modelCall = vi.fn<EntityModelCall>().mockResolvedValue({
      success: true,
      text: ROWS_2,
    });
    const readDramaFile = vi.fn(async (path: string) => ({
      success: path === "novel/drama/chapter-002_漫剧.md",
      text: DRAMA_2,
    }));

    const result = await extractChapterEntities({
      episodeId: "chapter-002",
      scriptDraft: null,
      readDramaFile: readDramaFile as never,
      modelCall,
    });

    expect(readDramaFile).toHaveBeenCalledWith("novel/drama/chapter-002_漫剧.md");
    expect(result).toMatchObject({ status: "success", inputSource: "drama" });
  });

  it("drama 不可得 → no_input(类型面上没有小说 sourceText 回落)", async () => {
    const modelCall = vi.fn<EntityModelCall>();
    const result = await extractChapterEntities({
      episodeId: "chapter-003",
      scriptDraft: null,
      readDramaFile: async () => ({ success: false, error: "ENOENT" }),
      modelCall,
    });
    expect(result).toEqual({ status: "no_input" });
    expect(modelCall).not.toHaveBeenCalled();
  });

  it("readText truncated → input_truncated(不静默用半文)", async () => {
    const result = await extractChapterEntities({
      episodeId: "chapter-001",
      scriptDraft: null,
      readDramaFile: async () => ({ success: true, text: "前半", truncated: true }),
      modelCall: vi.fn<EntityModelCall>(),
    });
    expect(result).toEqual({ status: "input_truncated" });
  });
});

describe("extractChapterEntities · 调用与解析", () => {
  it("call_failed 原样透传 error 对象(串化责任在单章 throw 位/runner 分类器)", async () => {
    const rawError = { code: 1308, message: "使用上限" };
    const modelCall = vi.fn<EntityModelCall>().mockResolvedValue({
      success: false,
      error: rawError,
    });
    const result = await extractChapterEntities({
      episodeId: "chapter-001",
      scriptText: "正文",
      modelCall,
    });
    expect(result).toEqual({ status: "call_failed", error: rawError });
  });

  it("无可解析行 → empty_parse", async () => {
    const modelCall = vi.fn<EntityModelCall>().mockResolvedValue({
      success: true,
      text: "抱歉,这一章没有实体。",
    });
    const result = await extractChapterEntities({
      episodeId: "chapter-001",
      scriptText: "正文",
      modelCall,
    });
    expect(result).toEqual({ status: "empty_parse" });
  });

  it("dedupe 命中 known(别名)→ 复用 id;坏行进 parseErrors", async () => {
    const modelCall = vi.fn<EntityModelCall>().mockResolvedValue({
      success: true,
      text: [
        "| character | 监工赵四 | 赵四 |  | 监工 |",
        "| character |坏行|",
      ].join("\n"),
    });
    const result = await extractChapterEntities({
      episodeId: "chapter-002",
      scriptText: "正文",
      knownEntities: [
        { id: "char-1", kind: "character", name: "赵四", aliases: [] },
      ],
      modelCall,
    });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({ id: "char-1", isNew: false });
    expect(result.parseErrors).toHaveLength(1);
  });
});

// ── 执行器 runEntityExtraction ─────────────────────────────────────────────

describe("runEntityExtraction · 主跑全链路(D10/D11/D17)", () => {
  it("逐章调用,分片经 store action 落对章;台账+出场索引落 store/extraction/", async () => {
    const h = makeDeps();
    h.modelCall
      .mockResolvedValueOnce({ success: true, text: ROWS_1 })
      .mockResolvedValueOnce({ success: true, text: ROWS_2 });

    const summary = await runEntityExtraction(h.deps, { range: [1, 2] });

    expect(summary.status).toBe("done");
    expect(h.modelCall).toHaveBeenCalledTimes(2);
    // D17:章分片唯一写路=saveEntityExtraction,episodeId 归属正确(与激活章无关)
    expect(h.saveEntityExtraction).toHaveBeenCalledTimes(2);
    expect(h.saveEntityExtraction.mock.calls[0]?.[0]).toMatchObject({
      episodeId: "chapter-001",
      sourceId: "chapter-001",
      revision: 1,
    });
    expect(h.saveEntityExtraction.mock.calls[1]?.[0]).toMatchObject({
      episodeId: "chapter-002",
    });
    const savedBatch = h.saveEntityExtraction.mock.calls[0]?.[0] as {
      scriptFingerprint?: string;
    };
    expect(savedBatch?.scriptFingerprint).toBe(
      scriptPlanSourceFingerprint("chapter-001", DRAMA_1),
    );

    // 台账:两章 success,记 resolved model 与指纹(D26 证据)
    const ledger = await readLedgerFrom(h);
    expect(ledger?.status).toBe("done");
    expect(ledger?.chapters["chapter-001"]).toMatchObject({
      state: "success",
      model: "glm-5.3",
    });
    expect(ledger?.chapters["chapter-002"]).toMatchObject({ state: "success" });
    expect(ledger?.chapters["chapter-001"]?.fingerprint).toBe(
      computeInputFingerprint(DRAMA_1),
    );

    // 出场索引:林晚跨两章;山门仅一章
    const index = await readIndexFrom(h);
    const linwan = Object.values(index).find((e) => e.name === "林晚");
    expect(linwan?.chapterIds).toEqual(["chapter-001", "chapter-002"]);
    expect(linwan?.firstChapterId).toBe("chapter-001");
    const shanmen = Object.values(index).find((e) => e.name === "山门");
    expect(shanmen?.chapterIds).toEqual(["chapter-001"]);
  });

  it("晋升:仅 1 章且不在三库=未晋升(伪 id 留批,不入三库);第 2 章后晋升入库且 linkedEpisodeId=firstChapterId(D11)", async () => {
    const h = makeDeps();
    h.modelCall
      .mockResolvedValueOnce({ success: true, text: ROWS_1 })
      .mockResolvedValueOnce({ success: true, text: ROWS_2 });

    await runEntityExtraction(h.deps, { range: [1, 2] });

    // ch1:全部实体首现=未晋升 → 三库零写
    const ch1Batch = h.saveEntityExtraction.mock.calls[0]?.[0] as {
      characters: Array<{ characterId: string; name: string }>;
    };
    expect(ch1Batch.characters[0]).toMatchObject({
      name: "林晚",
      characterId: "char-chapter-001-1",
    });
    // ch2:林晚第二次出场 → 晋升 addCharacter,linkedEpisodeId=首章(非本批章)
    expect(h.addCharacter).toHaveBeenCalledTimes(1);
    expect(h.addCharacter.mock.calls[0]?.[0]).toMatchObject({
      name: "林晚",
      linkedEpisodeId: "chapter-001",
    });
    // 山门仍只 1 章出场 → 场景库零写
    expect(h.addScene).not.toHaveBeenCalled();
    expect(h.createSinks).toHaveBeenCalledTimes(2);
  });

  it("已在三库=晋升:命中库实体走 update 路径,linkedEpisodeId 不被覆盖(D11)", async () => {
    const h = makeDeps();
    h.libraryEntities.push({
      id: "char-9",
      kind: "character",
      name: "林晚",
      aliases: [],
    });
    h.modelCall.mockResolvedValueOnce({ success: true, text: ROWS_1 });

    await runEntityExtraction(h.deps, { range: [1, 1] });

    expect(h.addCharacter).not.toHaveBeenCalled();
    expect(h.updateCharacter).toHaveBeenCalledTimes(1);
    expect(h.updateCharacter.mock.calls[0]?.[0]).toBe("char-9");
    const updates = h.updateCharacter.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(updates)).not.toContain("linkedEpisodeId");
  });
});

describe("runEntityExtraction · 续跑与挂起", () => {
  it("台账续跑:success 且指纹未变 → 零重复调用(AC2)", async () => {
    const h = makeDeps();
    h.modelCall
      .mockResolvedValueOnce({ success: true, text: ROWS_1 })
      .mockResolvedValueOnce({ success: true, text: ROWS_2 });
    await runEntityExtraction(h.deps, { range: [1, 2] });
    expect(h.modelCall).toHaveBeenCalledTimes(2);

    h.modelCall.mockClear();
    const again = await runEntityExtraction(h.deps, { range: [1, 2] });
    expect(again.status).toBe("done");
    expect(h.modelCall).not.toHaveBeenCalled();
    expect(h.saveEntityExtraction).toHaveBeenCalledTimes(2); // 仍只有首轮两次
  });

  it("指纹变化(剧本重写)→ 重提该章", async () => {
    const h = makeDeps();
    h.modelCall.mockResolvedValue({ success: true, text: ROWS_1 });
    await runEntityExtraction(h.deps, { range: [1, 1] });

    h.storage.writeText(
      "novel/drama/chapter-001_漫剧.md",
      `${DRAMA_1}(重写)`,
    );
    h.modelCall.mockClear();
    await runEntityExtraction(h.deps, { range: [1, 1] });
    expect(h.modelCall).toHaveBeenCalledTimes(1);
  });

  it("1308 → 全局挂起等到点自动续跑,不计失败(AC7)", async () => {
    const h = makeDeps();
    h.modelCall
      .mockResolvedValueOnce({ success: false, error: QUOTA_ERROR_TEXT })
      .mockResolvedValueOnce({ success: true, text: ROWS_1 });

    const summary = await runEntityExtraction(h.deps, { range: [1, 1] });

    // 挂起时长=重置时刻-now(解析出的时刻,非默认+30min)
    expect(h.sleeps).toEqual([QUOTA_RESET_AT - FIXED_NOW]);
    expect(summary.status).toBe("done");
    const ledger = await readLedgerFrom(h);
    expect(ledger?.chapters["chapter-001"]).toMatchObject({
      state: "success",
      attempts: 2,
    });
    // 挂起态曾落台账(观测面),终态回到 running/done
    const quotaSnapshots = h.storage.writes
      .filter(([path]) => path === `${EXTRACTION_LEDGER_RELATIVE_PATH}.tmp`)
      .map(([, value]) => parseLedgerJson(value))
      .filter((parsed) => parsed?.status === "quota_wait");
    expect(quotaSnapshots.length).toBeGreaterThanOrEqual(1);
  });

  it("transient → 退避 30s/120s 重试 2 次,仍败记失败并继续下一章", async () => {
    const h = makeDeps();
    h.modelCall
      .mockResolvedValueOnce({ success: false, error: "fetch failed: network timeout" })
      .mockResolvedValueOnce({ success: false, error: "HTTP 503" })
      .mockResolvedValueOnce({ success: false, error: "socket hang up" })
      .mockResolvedValueOnce({ success: true, text: ROWS_2 });

    const summary = await runEntityExtraction(h.deps, { range: [1, 2] });

    expect(h.sleeps).toEqual([30_000, 120_000]);
    expect(summary.status).toBe("done");
    expect(summary.counts).toEqual({ success: 1, failed: 1, skipped: 0, pending: 0 });
    const ledger = await readLedgerFrom(h);
    expect(ledger?.chapters["chapter-001"]).toMatchObject({
      state: "failed",
      attempts: 3,
    });
    // 失败原因=最后一次尝试的错误文本(R6 真实错误可读)
    expect(ledger?.chapters["chapter-001"]?.error).toBe("socket hang up");
    expect(ledger?.chapters["chapter-002"]).toMatchObject({ state: "success" });
  });

  it("fatal(空表)→ 该章记失败,继续下一章", async () => {
    const h = makeDeps();
    h.modelCall
      .mockResolvedValueOnce({ success: true, text: "这章没有可提取实体" })
      .mockResolvedValueOnce({ success: true, text: ROWS_2 });

    const summary = await runEntityExtraction(h.deps, { range: [1, 2] });

    expect(summary.status).toBe("done");
    expect(summary.counts).toEqual({ success: 1, failed: 1, skipped: 0, pending: 0 });
    expect(h.modelCall).toHaveBeenCalledTimes(2);
  });

  it("no_input → 记 skipped,不调模型", async () => {
    const h = makeDeps();
    const summary = await runEntityExtraction(h.deps, { range: [3, 3] });
    expect(summary.counts).toEqual({ success: 0, failed: 0, skipped: 1, pending: 0 });
    expect(h.modelCall).not.toHaveBeenCalled();
    expect((await readLedgerFrom(h))?.chapters["chapter-003"]).toMatchObject({
      state: "skipped",
      error: "no_input",
    });
  });
});

describe("runEntityExtraction · 防重入/暂停/漂移", () => {
  it("单例防重入:运行中二次 start 拒绝(主/旁路互斥)", async () => {
    const h = makeDeps();
    const gate: {
      resolve: ((value: { success: boolean; text: string }) => void) | null;
    } = { resolve: null };
    h.modelCall
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            gate.resolve = resolve;
          }),
      )
      .mockResolvedValue({ success: true, text: ROWS_2 });

    const first = runEntityExtraction(h.deps, { range: [1, 2] });
    await vi.waitFor(() => {
      expect(isEntityExtractionInFlight()).toBe(true);
    });

    await expect(runEntityExtraction(h.deps, { range: [1, 1] })).rejects.toThrow(
      /已在运行/,
    );

    gate.resolve?.({ success: true, text: ROWS_1 });
    const summary = await first;
    expect(summary.status).toBe("done");
    expect(isEntityExtractionInFlight()).toBe(false);
  });

  it("pause:运行中暂停 → 剩余章不再调用,终态 paused", async () => {
    const h = makeDeps();
    const gate: {
      resolve: ((value: { success: boolean; text: string }) => void) | null;
    } = { resolve: null };
    h.modelCall.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          gate.resolve = resolve;
        }),
    );

    const run = runEntityExtraction(h.deps, { range: [1, 2] });
    await vi.waitFor(() => expect(h.modelCall).toHaveBeenCalledTimes(1));
    expect(pauseEntityExtraction()).toBe(true);
    gate.resolve?.({ success: true, text: ROWS_1 });

    const summary = await run;
    expect(summary.status).toBe("paused");
    expect(h.modelCall).toHaveBeenCalledTimes(1);
    expect(summary.counts).toEqual({ success: 1, failed: 0, skipped: 0, pending: 1 });
  });

  it("D26 模型漂移 → 挂起+台账留痕,不再调用(AC17)", async () => {
    const h = makeDeps();
    // 调用序:预检(glm-5.3)→ ch1 检查(glm-5.3)→ ch2 检查(glm-4.6)
    const models = ["glm-5.3", "glm-5.3", "glm-4.6"];
    let resolveCount = 0;
    h.deps.getResolvedModel = () => models[Math.min(resolveCount++, models.length - 1)] ?? null;
    h.modelCall.mockResolvedValue({ success: true, text: ROWS_1 });

    const summary = await runEntityExtraction(h.deps, { range: [1, 2] });

    expect(summary.status).toBe("paused");
    expect(summary.drift).toEqual({ chapterId: "chapter-002", model: "glm-4.6" });
    expect(h.modelCall).toHaveBeenCalledTimes(1);
    const ledger = await readLedgerFrom(h);
    expect(ledger?.status).toBe("paused");
    expect(ledger?.chapters["chapter-002"]).toMatchObject({
      state: "pending",
      error: expect.stringContaining("model_drift"),
    });
  });
});

describe("runEntityExtraction · D20 对比模式(bypass)", () => {
  it("model 覆写生效;不落章分片/三库/主台账/主索引;旁路目录独立台账+章结果", async () => {
    const h = makeDeps();
    h.modelCall.mockResolvedValue({ success: true, text: ROWS_1 });

    const summary = await runEntityExtraction(h.deps, {
      range: [1, 1],
      model: "glm-5.3-flash",
      sink: "bypass",
      runId: "bypass-r1",
    });

    // 覆写传到模型调用
    expect(h.modelCall.mock.calls[0]?.[0]).toMatchObject({
      model: "glm-5.3-flash",
    });
    // 不落章分片、不落三库
    expect(h.saveEntityExtraction).not.toHaveBeenCalled();
    expect(h.createSinks).not.toHaveBeenCalled();
    // 主台账/主索引不写
    const storedPaths = h.storage.paths();
    expect(storedPaths).not.toContain(EXTRACTION_LEDGER_RELATIVE_PATH);
    expect(storedPaths).not.toContain(APPEARANCE_INDEX_RELATIVE_PATH);
    // 旁路目录:独立台账+章结果
    expect(storedPaths).toContain("store/extraction/bypass/bypass-r1/extraction-run.json");
    expect(storedPaths).toContain("store/extraction/bypass/bypass-r1/chapters/chapter-001.json");
    expect(summary.ledgerPath).toBe(
      "store/extraction/bypass/bypass-r1/extraction-run.json",
    );
    const chapterRaw = await h.storage.readText(
      "store/extraction/bypass/bypass-r1/chapters/chapter-001.json",
    );
    expect(chapterRaw).toBeDefined();
    const chapterBatch = JSON.parse(chapterRaw!) as {
      episodeId: string;
      characters: Array<{ name: string }>;
      scriptFingerprint?: string;
    };
    expect(chapterBatch.episodeId).toBe("chapter-001");
    expect(chapterBatch.characters.map((c) => c.name)).toContain("林晚");
    expect(chapterBatch.scriptFingerprint).toBe(
      scriptPlanSourceFingerprint("chapter-001", DRAMA_1),
    );
  });
});

describe("runEntityExtraction · 并发", () => {
  it("缺省并发 1:第 2 章的调用等第 1 章完成", async () => {
    const h = makeDeps();
    const gate: {
      resolve: ((value: { success: boolean; text: string }) => void) | null;
    } = { resolve: null };
    h.modelCall
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            gate.resolve = resolve;
          }),
      )
      .mockResolvedValueOnce({ success: true, text: ROWS_2 });

    const run = runEntityExtraction(h.deps, { range: [1, 2] });
    await vi.waitFor(() => expect(h.modelCall).toHaveBeenCalledTimes(1));
    // 第 1 章在途时,第 2 章不发起
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.modelCall).toHaveBeenCalledTimes(1);
    gate.resolve?.({ success: true, text: ROWS_1 });
    const summary = await run;
    expect(summary.status).toBe("done");
    expect(h.modelCall).toHaveBeenCalledTimes(2);
  });

  it("并发 2:两章同时在途", async () => {
    const h = makeDeps();
    const releases: Array<(value: { success: boolean; text: string }) => void> = [];
    h.modelCall.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }),
    );

    const run = runEntityExtraction(h.deps, { range: [1, 2], concurrency: 2 });
    await vi.waitFor(() => expect(h.modelCall).toHaveBeenCalledTimes(2));
    for (const resolve of releases) resolve({ success: true, text: ROWS_1 });
    const summary = await run;
    expect(summary.status).toBe("done");
  });
});
