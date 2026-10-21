import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerProjectFileIpcHandlers } from "../../electron/ipc/files/project-file-ipc";
import { setProjectLocationResolver } from "../../electron/storage/storage-paths";
import {
  EXTRACTION_LEDGER_RELATIVE_PATH,
  createExtractionLedger,
  createElectronLedgerStorage,
  findModelDrift,
  normalizeLedgerForStartup,
  parseLedgerJson,
  recordChapter,
  serializeLedger,
  shouldSkipChapter,
  writeLedgerAtomically,
  type ExtractionRunLedger,
  type LedgerStorage,
  type ProjectFilesBridge,
} from "./entity-extraction-ledger";

const ipcMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcMocks.handlers.set(channel, handler);
    },
  },
}));

function makeLedger(): ExtractionRunLedger {
  return createExtractionLedger({
    runId: "run-20261019",
    model: "glm-5.3",
    range: [1, 3],
  });
}

function makeStorage(files: Map<string, string> = new Map()): LedgerStorage & {
  writes: Array<[string, string]>;
  moves: Array<[string, string]>;
} {
  const writes: Array<[string, string]> = [];
  const moves: Array<[string, string]> = [];
  return {
    writes,
    moves,
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

describe("entity-extraction-ledger · 台账家=D18 新家(AC15 前置)", () => {
  it("路径=store/extraction/extraction-run.json,不在 studio-workflow/ 孤儿清理辖区", () => {
    expect(EXTRACTION_LEDGER_RELATIVE_PATH).toBe("store/extraction/extraction-run.json");
    // D18:store/studio-workflow/ 根层非 manifest 文件每次保存被孤儿清理删
    // (storage-project-sharded.ts:390-396)——台账家必须在其外。
    expect(EXTRACTION_LEDGER_RELATIVE_PATH.startsWith("store/studio-workflow/")).toBe(false);
  });
});

describe("entity-extraction-ledger · 创建与序列化", () => {
  it("createExtractionLedger 按 range 预填 pending 章", () => {
    const ledger = makeLedger();
    expect(ledger.version).toBe(1);
    expect(ledger.status).toBe("paused");
    expect(ledger.resumeAt).toBeNull();
    expect(Object.keys(ledger.chapters).sort()).toEqual([
      "chapter-001",
      "chapter-002",
      "chapter-003",
    ]);
    expect(ledger.chapters["chapter-002"]).toEqual({ state: "pending" });
  });

  it("range 含 ≥1000 章时四位章号正确预填", () => {
    const ledger = createExtractionLedger({ runId: "r", model: "m", range: [999, 1001] });
    // 字典序在 999/1000 边界乱序("1"<"9"),按数字后缀排序断言
    const byNumber = (a: string, b: string) =>
      Number(a.replace("chapter-", "")) - Number(b.replace("chapter-", ""));
    expect(Object.keys(ledger.chapters).sort(byNumber)).toEqual([
      "chapter-999",
      "chapter-1000",
      "chapter-1001",
    ]);
  });

  it("serialize→parse 往返全等;非法 JSON→null;空串→null", () => {
    const ledger = makeLedger();
    const parsed = parseLedgerJson(serializeLedger(ledger));
    expect(parsed).toEqual(ledger);
    expect(parseLedgerJson("{oops")).toBeNull();
    expect(parseLedgerJson("")).toBeNull();
  });

  it("serialize 章 key 排序稳定(两次序列化字节全等)", () => {
    const a = makeLedger();
    a.chapters["chapter-003"] = { state: "success", model: "glm-5.3" };
    const b = makeLedger();
    b.chapters["chapter-003"] = { state: "success", model: "glm-5.3" };
    expect(serializeLedger(a)).toBe(serializeLedger(b));
  });
});

describe("entity-extraction-ledger · D25 启动收口", () => {
  it("启动时任何非 paused/done 状态(含 quota_wait/running)一律置 paused,resumeAt 保留", () => {
    for (const status of ["running", "quota_wait"] as const) {
      const ledger = { ...makeLedger(), status, resumeAt: 1792000000000 };
      const normalized = normalizeLedgerForStartup(ledger);
      expect(normalized.status).toBe("paused");
      expect(normalized.resumeAt).toBe(1792000000000);
    }
  });

  it("done/paused 原样保留;未知杂散状态也归 paused", () => {
    expect(normalizeLedgerForStartup({ ...makeLedger(), status: "done" }).status).toBe("done");
    expect(normalizeLedgerForStartup({ ...makeLedger(), status: "paused" }).status).toBe("paused");
    expect(
      normalizeLedgerForStartup({ ...makeLedger(), status: "weird" as never }).status,
    ).toBe("paused");
  });
});

describe("entity-extraction-ledger · 每章记账(D26 resolved model)", () => {
  it("recordChapter 记 success + resolved model + 指纹 + 耗时,不可变更新", () => {
    const ledger = makeLedger();
    const next = recordChapter(ledger, "chapter-001", {
      state: "success",
      fingerprint: "abc123",
      model: "glm-5.3",
      attempts: 1,
      ms: 41_200,
    });
    expect(next.chapters["chapter-001"]).toMatchObject({
      state: "success",
      fingerprint: "abc123",
      model: "glm-5.3",
      attempts: 1,
      ms: 41_200,
    });
    // 不可变:原 ledger 不被改写
    expect(ledger.chapters["chapter-001"]).toEqual({ state: "pending" });
  });

  it("failed 记可读错误文本(error 字段承载 stringifyErrorText 产物)", () => {
    const next = recordChapter(makeLedger(), "chapter-002", {
      state: "failed",
      error: "[1308] 已达到使用上限",
      attempts: 3,
    });
    expect(next.chapters["chapter-002"]).toMatchObject({
      state: "failed",
      error: "[1308] 已达到使用上限",
      attempts: 3,
    });
  });
});

describe("entity-extraction-ledger · R2 续跑跳过判定", () => {
  it("success 且指纹未变 → 跳过(零调用);指纹漂移/失败/pending → 不跳过", () => {
    let ledger = makeLedger();
    ledger = recordChapter(ledger, "chapter-001", {
      state: "success",
      fingerprint: "fp-A",
      model: "glm-5.3",
    });
    ledger = recordChapter(ledger, "chapter-002", {
      state: "failed",
      fingerprint: "fp-B",
      model: "glm-5.3",
    });

    expect(shouldSkipChapter(ledger, "chapter-001", "fp-A")).toBe(true);
    expect(shouldSkipChapter(ledger, "chapter-001", "fp-CHANGED")).toBe(false);
    expect(shouldSkipChapter(ledger, "chapter-002", "fp-B")).toBe(false);
    expect(shouldSkipChapter(ledger, "chapter-003", "fp-A")).toBe(false);
  });
});

describe("entity-extraction-ledger · D26 模型漂移守卫", () => {
  it("章 resolved model 与 run 顶层不一致 → 报漂移章;全一致 → null", () => {
    let ledger = makeLedger();
    ledger = recordChapter(ledger, "chapter-001", {
      state: "success",
      model: "glm-5.3",
    });
    expect(findModelDrift(ledger)).toBeNull();

    ledger = recordChapter(ledger, "chapter-002", {
      state: "success",
      model: "glm-5.3-flash",
    });
    expect(findModelDrift(ledger)).toEqual({
      chapterId: "chapter-002",
      model: "glm-5.3-flash",
    });
  });
});

describe("entity-extraction-ledger · 原子写(tmp→move)", () => {
  it("writeLedgerAtomically 先写 .tmp 再 move 到正式位,正式位内容=序列化结果", async () => {
    const storage = makeStorage();
    const ledger = makeLedger();

    await writeLedgerAtomically(storage, ledger);

    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0]?.[0]).toBe(`${EXTRACTION_LEDGER_RELATIVE_PATH}.tmp`);
    expect(storage.writes[0]?.[1]).toBe(serializeLedger(ledger));
    expect(storage.moves).toEqual([
      [`${EXTRACTION_LEDGER_RELATIVE_PATH}.tmp`, EXTRACTION_LEDGER_RELATIVE_PATH],
    ]);
  });
});

describe("entity-extraction-ledger · electron 桥适配(注入结构类型)", () => {
  it("createElectronLedgerStorage:readText 走 {projectId, relativePath},writeText 走 _p/<pid>/ 键,move 走 {projectId, from/to}", async () => {
    const readText = vi.fn().mockResolvedValue({ success: false });
    const writeText = vi.fn().mockResolvedValue({ success: true });
    const move = vi.fn().mockResolvedValue({ success: true });
    const storage = createElectronLedgerStorage("proj-1", { readText, writeText, move });

    await storage.readText("store/extraction/extraction-run.json");
    await storage.writeText("store/extraction/a.json", "{}");
    await storage.move("store/extraction/a.json", "store/extraction/b.json");

    expect(readText).toHaveBeenCalledWith({
      projectId: "proj-1",
      relativePath: "store/extraction/extraction-run.json",
    });
    // 键约定同 novel-mirrors(source-bible.ts:28):_p/{projectId}/ 前缀
    expect(writeText).toHaveBeenCalledWith("_p/proj-1/store/extraction/a.json", "{}");
    expect(move).toHaveBeenCalledWith({
      projectId: "proj-1",
      fromRelative: "store/extraction/a.json",
      toRelative: "store/extraction/b.json",
      replaceExisting: true,
    });
  });
});

describe("entity-extraction-ledger · production adapter + IPC + real filesystem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setProjectLocationResolver(null);
  });

  function createIpcStorage(external: boolean) {
    const dataRoot = fs.mkdtempSync(path.join(tmpdir(), "entity-ledger-"));
    const projectId = "atomic-ledger-test";
    const projectRoot = external ? path.join(dataRoot, "external-project") : path.join(dataRoot, "_p", projectId);
    fs.mkdirSync(projectRoot, { recursive: true });
    setProjectLocationResolver(external ? () => projectRoot : null);
    registerProjectFileIpcHandlers({
      getDataDir: () => dataRoot,
      getAssetsRoot: () => path.join(dataRoot, "assets"),
      readImageSource: async () => { throw new Error("Images are not part of the ledger test"); },
      getMimeType: () => "application/json",
    });
    const bridge: ProjectFilesBridge = {
      readText: async (payload) => await ipcMocks.handlers.get("project-file-read-text")!({}, payload) as Awaited<ReturnType<ProjectFilesBridge["readText"]>>,
      writeText: async (key, value) => await ipcMocks.handlers.get("project-file-write-text")!({}, key, value) as Awaited<ReturnType<ProjectFilesBridge["writeText"]>>,
      move: async (payload) => await ipcMocks.handlers.get("project-file-move")!({}, payload) as Awaited<ReturnType<ProjectFilesBridge["move"]>>,
    };
    return {
      storage: createElectronLedgerStorage(projectId, bridge),
      ledgerPath: path.join(projectRoot, EXTRACTION_LEDGER_RELATIVE_PATH),
    };
  }

  it.each([false, true])("persists three successive ledgers via the production bridge (external=%s)", async (external) => {
    const { storage, ledgerPath } = createIpcStorage(external);
    const initial = makeLedger();
    await writeLedgerAtomically(storage, initial);
    expect(fs.readFileSync(ledgerPath, "utf-8")).toBe(serializeLedger(initial));

    const updated = recordChapter(initial, "chapter-001", { state: "success", model: "glm-5.3" });
    const originalRename = fs.renameSync;
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce((from, to) => {
      expect(fs.readFileSync(to, "utf-8")).toBe(serializeLedger(initial));
      expect(fs.readFileSync(from, "utf-8")).toBe(serializeLedger(updated));
      originalRename(from, to);
    });
    await writeLedgerAtomically(storage, updated);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(ledgerPath, "utf-8")).toBe(serializeLedger(updated));

    const completed = { ...updated, status: "done" as const };
    await writeLedgerAtomically(storage, completed);
    expect(await storage.readText(EXTRACTION_LEDGER_RELATIVE_PATH)).toBe(serializeLedger(completed));
    expect(fs.existsSync(`${ledgerPath}.tmp`)).toBe(false);
  });

  it("keeps old ledger bytes and the new temp file intact when rename fails", async () => {
    const { storage, ledgerPath } = createIpcStorage(true);
    const initial = makeLedger();
    await writeLedgerAtomically(storage, initial);
    const oldBytes = fs.readFileSync(ledgerPath);
    const updated = recordChapter(initial, "chapter-001", { state: "success" });
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      expect(fs.readFileSync(ledgerPath)).toEqual(oldBytes);
      throw Object.assign(new Error("EACCES: simulated rename failure"), { code: "EACCES" });
    });

    await expect(writeLedgerAtomically(storage, updated)).rejects.toThrow("EACCES: simulated rename failure");
    expect(rename).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(ledgerPath)).toEqual(oldBytes);
    expect(fs.readFileSync(`${ledgerPath}.tmp`, "utf-8")).toBe(serializeLedger(updated));
  });

  it.each(["source", "target"])("rejects real directories at the replacement %s", async (directory) => {
    const { storage, ledgerPath } = createIpcStorage(true);
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    if (directory === "source") {
      fs.mkdirSync(`${ledgerPath}.tmp`);
    } else {
      fs.mkdirSync(ledgerPath);
      await storage.writeText(`${EXTRACTION_LEDGER_RELATIVE_PATH}.tmp`, "new ledger");
    }
    await expect(storage.move(`${EXTRACTION_LEDGER_RELATIVE_PATH}.tmp`, EXTRACTION_LEDGER_RELATIVE_PATH))
      .rejects.toThrow();
    expect(fs.statSync(directory === "source" ? `${ledgerPath}.tmp` : ledgerPath).isDirectory()).toBe(true);
    expect(fs.existsSync(`${ledgerPath}.tmp`)).toBe(true);
  });

  it.each(["source", "target"])("rejects real symlinks at the replacement %s", async (link) => {
    const { storage, ledgerPath } = createIpcStorage(true);
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    const linkedPath = path.join(path.dirname(ledgerPath), "linked.json");
    fs.writeFileSync(linkedPath, "linked file stays intact");
    fs.symlinkSync(linkedPath, link === "source" ? `${ledgerPath}.tmp` : ledgerPath);
    if (link === "target") await storage.writeText(`${EXTRACTION_LEDGER_RELATIVE_PATH}.tmp`, "new ledger");
    await expect(storage.move(`${EXTRACTION_LEDGER_RELATIVE_PATH}.tmp`, EXTRACTION_LEDGER_RELATIVE_PATH))
      .rejects.toThrow();
    expect(fs.readFileSync(linkedPath, "utf-8")).toBe("linked file stays intact");
    expect(fs.lstatSync(link === "source" ? `${ledgerPath}.tmp` : ledgerPath).isSymbolicLink()).toBe(true);
  });
});
