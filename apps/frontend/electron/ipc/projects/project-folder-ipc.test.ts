import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
  },
}));

import {
  MoveCancelledError,
  type ProjectMoveEngine,
  type ProjectMoveMode,
  type ProjectMoveOptions,
} from "../../storage/project-move-engine";
import { createProjectLocationStore } from "../../storage/project-locations";
import { registerProjectFolderIpcHandlers } from "./project-folder-ipc";

type Fixture = {
  tmp: string;
  userData: string;
  dataRoot: string;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  sender: { send: ReturnType<typeof vi.fn> };
  store: ReturnType<typeof createProjectLocationStore>;
};

const activeTmps: string[] = [];

function createFixture(createMoveEngine?: () => ProjectMoveEngine): Fixture {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-project-folder-"));
  activeTmps.push(tmp);
  const userData = path.join(tmp, "userData");
  const dataRoot = path.join(tmp, "data", "projects");
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  const store = createProjectLocationStore({ userDataPath: userData, getProjectsDataRoot: () => dataRoot });
  registerProjectFolderIpcHandlers({
    locationStore: store,
    getProjectsDataRoot: () => dataRoot,
    createMoveEngine,
  });
  const sender = { send: vi.fn() };
  return {
    tmp,
    userData,
    dataRoot,
    store,
    sender,
    invoke: (channel, ...args) => Promise.resolve(handlers.get(channel)?.({ sender }, ...args)),
  };
}

/** Fake engine factory: records every move() call, delegates behavior to `impl`. */
function makeFakeEngine(impl: (options: ProjectMoveOptions) => Promise<ProjectMoveMode> | ProjectMoveMode) {
  const calls: ProjectMoveOptions[] = [];
  const engine: ProjectMoveEngine = {
    async move(options) {
      calls.push(options);
      return impl(options);
    },
  };
  return { engineFactory: () => engine, calls };
}

/** Rename-style (same-volume) fake behavior. */
function fakeRenameMove(options: ProjectMoveOptions): ProjectMoveMode {
  fs.renameSync(options.sourceDir, options.targetDir);
  return "renamed";
}

/** Copy-style (cross-volume) fake behavior: copy tree, then remove source. */
function fakeCopyMove(options: ProjectMoveOptions): ProjectMoveMode {
  fs.cpSync(options.sourceDir, options.targetDir, { recursive: true });
  fs.rmSync(options.sourceDir, { recursive: true, force: true });
  return "copied";
}

describe("project-folder IPC handlers", () => {
  let fixture: Fixture;

  beforeEach(() => {
    handlers.clear();
    fixture = createFixture();
  });

  afterEach(() => {
    for (const tmp of activeTmps) fs.rmSync(tmp, { recursive: true, force: true });
    activeTmps.length = 0;
  });

  it("prepare creates the project folder, registers and persists the location", async () => {
    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);

    const result = await fixture.invoke("project-folder-prepare", "pid-1111", parent, "道劫");

    expect(result).toEqual({ ok: true, location: path.join(parent, "道劫") });
    expect(fs.statSync(path.join(parent, "道劫")).isDirectory()).toBe(true);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(fixture.userData, "project-locations.json"), "utf-8"),
    ) as { version: number; locations: Record<string, string> };
    expect(persisted.version).toBe(1);
    expect(persisted.locations["pid-1111"]).toBe(path.join(parent, "道劫"));

    // A second store instance on the same userData rehydrates the entry.
    const reloaded = createProjectLocationStore({ userDataPath: fixture.userData });
    expect(reloaded.get("pid-1111")).toBe(path.join(parent, "道劫"));
  });

  it("prepare persistence failure removes only the empty directory created by this request", async () => {
    const parent = path.join(fixture.tmp, "parent");
    const existing = path.join(parent, "已有空目录");
    fs.mkdirSync(existing, { recursive: true });

    const set = vi.spyOn(fixture.store, "set");
    set.mockImplementationOnce(() => {
      throw new Error("persist failed");
    });
    const created = path.join(parent, "新项目");
    expect(await fixture.invoke("project-folder-prepare", "pid-created", parent, "新项目"))
      .toEqual({ ok: false, code: "NESTED", message: expect.stringContaining("persist failed") });
    expect(fs.existsSync(created)).toBe(false);

    set.mockImplementationOnce(() => {
      throw new Error("persist failed again");
    });
    expect(await fixture.invoke("project-folder-prepare", "pid-existing", parent, "已有空目录"))
      .toEqual({ ok: false, code: "NESTED", message: expect.stringContaining("persist failed again") });
    expect(fs.statSync(existing).isDirectory()).toBe(true);
    set.mockRestore();
  });

  it("prepare sanitizes illegal names and falls back to 项目-<pid 前 8 位>", async () => {
    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);

    const sanitized = await fixture.invoke("project-folder-prepare", "pid-2222", parent, '非法/名:字*?"<>|');
    expect(sanitized).toEqual({ ok: true, location: path.join(parent, "非法名字") });

    const fallback = await fixture.invoke("project-folder-prepare", "abcdefgh-4321", parent, "  ???  ");
    expect(fallback).toEqual({ ok: true, location: path.join(parent, "项目-abcdefgh") });
  });

  it("prepare rejects invalid parents with PARENT_INVALID", async () => {
    const fileAsParent = path.join(fixture.tmp, "a-file");
    fs.writeFileSync(fileAsParent, "x", "utf-8");

    expect(await fixture.invoke("project-folder-prepare", "pid-1", "relative/path", "名字"))
      .toEqual({ ok: false, code: "PARENT_INVALID", message: expect.any(String) });
    expect(await fixture.invoke("project-folder-prepare", "pid-1", path.join(fixture.tmp, "missing"), "名字"))
      .toEqual({ ok: false, code: "PARENT_INVALID", message: expect.any(String) });
    expect(await fixture.invoke("project-folder-prepare", "pid-1", fileAsParent, "名字"))
      .toEqual({ ok: false, code: "PARENT_INVALID", message: expect.any(String) });
    expect(await fixture.invoke("project-folder-prepare", "bad/id", fixture.tmp, "名字"))
      .toEqual({ ok: false, code: "PARENT_INVALID", message: expect.any(String) });
  });

  it("prepare rejects read-only parents with NOT_WRITABLE", async () => {
    const parent = path.join(fixture.tmp, "readonly");
    fs.mkdirSync(parent);
    fs.chmodSync(parent, 0o555);
    try {
      fs.accessSync(parent, fs.constants.W_OK);
    } catch {
      const result = await fixture.invoke("project-folder-prepare", "pid-1", parent, "名字");
      expect(result).toEqual({ ok: false, code: "NOT_WRITABLE", message: expect.any(String) });
      return;
    } finally {
      fs.chmodSync(parent, 0o755);
    }
    // Running as root: W_OK cannot fail, so this assertion would be invalid.
    fs.rmdirSync(parent);
  });

  it("prepare conflicts on non-empty targets but reuses empty folders", async () => {
    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);
    fs.mkdirSync(path.join(parent, "占位"));
    fs.writeFileSync(path.join(parent, "占位", "keep.txt"), "x", "utf-8");
    fs.mkdirSync(path.join(parent, "占用"));

    const conflict = await fixture.invoke("project-folder-prepare", "pid-1", parent, "占位");
    expect(conflict).toEqual({ ok: false, code: "CONFLICT", message: expect.any(String) });
    expect(fs.readFileSync(path.join(parent, "占位", "keep.txt"), "utf-8")).toBe("x");

    const occupiedFile = path.join(fixture.tmp, "a-file");
    fs.writeFileSync(occupiedFile, "x", "utf-8");
    const fileConflict = await fixture.invoke("project-folder-prepare", "pid-2", fixture.tmp, "a-file");
    expect(fileConflict).toEqual({ ok: false, code: "CONFLICT", message: expect.any(String) });

    const reuse = await fixture.invoke("project-folder-prepare", "pid-3", parent, "占用");
    expect(reuse).toEqual({ ok: true, location: path.join(parent, "占用") });
    expect(fs.readdirSync(path.join(parent, "占用"))).toEqual([]);
  });

  it("prepare rejects nested locations with NESTED", async () => {
    // Inside the application data root.
    const insideDataRoot = path.join(fixture.dataRoot, "outer");
    fs.mkdirSync(insideDataRoot);
    expect(await fixture.invoke("project-folder-prepare", "pid-1", insideDataRoot, "名字"))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });

    // Containing the application data root.
    expect(await fixture.invoke("project-folder-prepare", "pid-2", fixture.tmp, "data"))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });

    // Inside / equal to another registered location.
    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);
    const first = await fixture.invoke("project-folder-prepare", "pid-a", parent, "甲");
    expect(first).toEqual({ ok: true, location: path.join(parent, "甲") });
    expect(await fixture.invoke("project-folder-prepare", "pid-b", path.join(parent, "甲"), "子夹"))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });
    expect(await fixture.invoke("project-folder-prepare", "pid-c", parent, "甲"))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });
  });

  it("prepare rejects a symlinked parent that resolves into the data root (AC5)", async () => {
    // Real directory inside the data root, reached through an outside symlink:
    // lexical comparison would pass; realpath normalization must catch it.
    const insideRoot = path.join(fixture.dataRoot, "sneaky-parent");
    fs.mkdirSync(insideRoot);
    const alias = path.join(fixture.tmp, "alias-into-data-root");
    fs.symlinkSync(insideRoot, alias, "dir");

    expect(await fixture.invoke("project-folder-prepare", "pid-1", alias, "名字"))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });
    expect(fixture.store.get("pid-1")).toBeUndefined();
  });

  it("rename moves the folder and updates the location table", async () => {
    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);
    await fixture.invoke("project-folder-prepare", "pid-1", parent, "旧名");
    fs.writeFileSync(path.join(parent, "旧名", "script.json"), "{}", "utf-8");

    const result = await fixture.invoke("project-folder-rename", "pid-1", "新名");
    expect(result).toEqual({ ok: true, location: path.join(parent, "新名") });
    expect(fs.existsSync(path.join(parent, "旧名"))).toBe(false);
    expect(fs.readFileSync(path.join(parent, "新名", "script.json"), "utf-8")).toBe("{}");
    expect(fixture.store.get("pid-1")).toBe(path.join(parent, "新名"));
  });

  it("rename performs case-only renames and conflicts on existing targets", async () => {
    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);
    await fixture.invoke("project-folder-prepare", "pid-1", parent, "Project");

    const caseOnly = await fixture.invoke("project-folder-rename", "pid-1", "project");
    expect(caseOnly).toEqual({ ok: true, location: path.join(parent, "project") });

    fs.mkdirSync(path.join(parent, "其它"));
    expect(await fixture.invoke("project-folder-rename", "pid-1", "其它"))
      .toEqual({ ok: false, code: "CONFLICT", message: expect.any(String) });
    expect(fs.statSync(path.join(parent, "project")).isDirectory()).toBe(true);
  });

  it("rename reports NO_LOCATION and MISSING_DIR", async () => {
    expect(await fixture.invoke("project-folder-rename", "unregistered", "任意"))
      .toEqual({ ok: false, code: "NO_LOCATION", message: expect.any(String) });

    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);
    await fixture.invoke("project-folder-prepare", "pid-1", parent, "将消失");
    fs.rmSync(path.join(parent, "将消失"), { recursive: true, force: true });
    expect(await fixture.invoke("project-folder-rename", "pid-1", "新名"))
      .toEqual({ ok: false, code: "MISSING_DIR", message: expect.any(String) });
  });

  it("remove deletes the folder and deregisters; absent locations are a no-op", async () => {
    expect(await fixture.invoke("project-folder-remove", "unregistered"))
      .toEqual({ ok: true, removed: false });

    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);
    await fixture.invoke("project-folder-prepare", "pid-1", parent, "待删");
    fs.writeFileSync(path.join(parent, "待删", "script.json"), "{}", "utf-8");

    expect(await fixture.invoke("project-folder-remove", "pid-1"))
      .toEqual({ ok: true, removed: true });
    expect(fs.existsSync(path.join(parent, "待删"))).toBe(false);
    expect(fixture.store.get("pid-1")).toBeUndefined();
  });

  it("status reports the registered location and folder existence", async () => {
    expect(await fixture.invoke("project-folder-status", "unregistered")).toEqual({ exists: true });

    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);
    await fixture.invoke("project-folder-prepare", "pid-1", parent, "在线");
    expect(await fixture.invoke("project-folder-status", "pid-1"))
      .toEqual({ location: path.join(parent, "在线"), exists: true });

    fs.rmSync(path.join(parent, "在线"), { recursive: true, force: true });
    expect(await fixture.invoke("project-folder-status", "pid-1"))
      .toEqual({ location: path.join(parent, "在线"), exists: false });
  });

  it("copy-novel carries the novel subtree to a duplicate project (bible readable, temp artifacts skipped)", async () => {
    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);
    // 源=外部位置项目，目标=外部副本（prepare 已注册位置）
    const source = path.join(parent, "道劫");
    fs.mkdirSync(path.join(source, "novel", "chapters"), { recursive: true });
    fs.mkdirSync(path.join(source, "novel", "source-memory", "staging"), { recursive: true });
    fs.writeFileSync(path.join(source, "novel", "source-memory", "MEMORY.md"), "# 原著圣经\n晏燎创建万劫圣宗。\n");
    fs.writeFileSync(path.join(source, "novel", "chapters", "chapter-001.md"), "## 第1章\n正文\n");
    fs.writeFileSync(path.join(source, "novel", "source-memory", "records.jsonl"), '{"recordId":"r1"}\n');
    fs.writeFileSync(path.join(source, "novel", "source-memory", "staging", "plan-x.json"), "{}");
    fs.writeFileSync(path.join(source, "novel", "source-memory", ".lock"), "1");
    fixture.store.set("pid-src", source);

    await fixture.invoke("project-folder-prepare", "pid-dst", parent, "道劫 (副本)");
    const result = await fixture.invoke("project-folder-copy-novel", "pid-src", "pid-dst");

    expect(result).toEqual({ ok: true, copiedFiles: 3 }); // MEMORY.md + chapter + records.jsonl
    const dst = path.join(parent, "道劫 (副本)");
    // 复制后 MEMORY.md 逐字节可读（父任务验收：复制项目后 MEMORY.md 可读）
    expect(fs.readFileSync(path.join(dst, "novel", "source-memory", "MEMORY.md"), "utf8"))
      .toBe("# 原著圣经\n晏燎创建万劫圣宗。\n");
    expect(fs.readFileSync(path.join(dst, "novel", "chapters", "chapter-001.md"), "utf8")).toBe("## 第1章\n正文\n");
    // 临时产物不随行
    expect(fs.existsSync(path.join(dst, "novel", "source-memory", "staging"))).toBe(false);
    expect(fs.existsSync(path.join(dst, "novel", "source-memory", ".lock"))).toBe(false);
  });

  it("copy-novel is a no-op without a source novel and refuses to overwrite a non-empty target", async () => {
    const parent = path.join(fixture.tmp, "parent2");
    fs.mkdirSync(parent);
    const source = path.join(parent, "无小说项目");
    fs.mkdirSync(path.join(source, "tts"), { recursive: true }); // 只有 store 文件
    fixture.store.set("pid-a", source);
    await fixture.invoke("project-folder-prepare", "pid-b", parent, "无小说项目 (副本)");
    expect(await fixture.invoke("project-folder-copy-novel", "pid-a", "pid-b"))
      .toEqual({ ok: true, copiedFiles: 0 });

    // 目标已有非空 novel → 拒绝覆盖（源须有 novel 才进入目标检查）
    const sourceWithNovel = path.join(parent, "有小说项目");
    fs.mkdirSync(path.join(sourceWithNovel, "novel"), { recursive: true });
    fs.writeFileSync(path.join(sourceWithNovel, "novel", "MEMORY.md"), "源圣经");
    fixture.store.set("pid-c", sourceWithNovel);
    const dst = path.join(parent, "无小说项目 (副本)");
    fs.mkdirSync(path.join(dst, "novel"), { recursive: true });
    fs.writeFileSync(path.join(dst, "novel", "MEMORY.md"), "已有内容");
    const refused = await fixture.invoke("project-folder-copy-novel", "pid-c", "pid-b");
    expect(refused).toMatchObject({ ok: false, code: "TARGET_NOT_EMPTY" });
    // 拒绝覆盖时目标内容原样保留
    expect(fs.readFileSync(path.join(dst, "novel", "MEMORY.md"), "utf8")).toBe("已有内容");

    // 同 id / 非法 id
    expect(await fixture.invoke("project-folder-copy-novel", "pid-a", "pid-a")).toMatchObject({ ok: false, code: "INVALID_ID" });
    expect(await fixture.invoke("project-folder-copy-novel", "", "pid-b")).toMatchObject({ ok: false, code: "INVALID_ID" });
  });

  it("copy-novel also serves internal projects via the dataRoot/_p slot", async () => {
    // 内部项目无 location 注册，根=dataRoot/_p/<pid>
    const srcRoot = path.join(fixture.dataRoot, "_p", "pid-int-src");
    fs.mkdirSync(path.join(srcRoot, "novel", "source-memory"), { recursive: true });
    fs.writeFileSync(path.join(srcRoot, "novel", "source-memory", "MEMORY.md"), "# 内部圣经\n");
    const result = await fixture.invoke("project-folder-copy-novel", "pid-int-src", "pid-int-dst");
    expect(result).toEqual({ ok: true, copiedFiles: 1 });
    expect(fs.readFileSync(path.join(fixture.dataRoot, "_p", "pid-int-dst", "novel", "source-memory", "MEMORY.md"), "utf8"))
      .toBe("# 内部圣经\n");
  });
});

describe("project-folder-move IPC handler", () => {
  let fixture: Fixture;

  beforeEach(() => {
    handlers.clear();
    fixture = createFixture();
  });

  afterEach(() => {
    for (const tmp of activeTmps) fs.rmSync(tmp, { recursive: true, force: true });
    activeTmps.length = 0;
  });

  async function prepareProject(parentName: string, name: string, pid: string): Promise<string> {
    const parent = path.join(fixture.tmp, parentName);
    fs.mkdirSync(parent);
    const prepared = await fixture.invoke("project-folder-prepare", pid, parent, name);
    expect(prepared).toEqual({ ok: true, location: path.join(parent, name) });
    fs.writeFileSync(path.join(parent, name, "script.json"), "{}", "utf-8");
    return path.join(parent, name);
  }

  it("relocates an external project (rename mode) and updates the location table", async () => {
    const { engineFactory, calls } = makeFakeEngine(fakeRenameMove);
    fixture = createFixture(engineFactory);
    const source = await prepareProject("old-home", "甲", "pid-1");
    const newParent = path.join(fixture.tmp, "new-home");
    fs.mkdirSync(newParent);

    const result = await fixture.invoke("project-folder-move", "pid-1", "乙", newParent);

    expect(result).toEqual({ ok: true, location: path.join(newParent, "乙"), mode: "renamed" });
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(path.join(newParent, "乙", "script.json"), "utf-8")).toBe("{}");
    expect(fixture.store.get("pid-1")).toBe(path.join(newParent, "乙"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sourceDir).toBe(source);
    expect(calls[0]?.targetDir).toBe(path.join(newParent, "乙"));
  });

  it("propagates the engine's copied mode for cross-volume moves", async () => {
    const { engineFactory } = makeFakeEngine(fakeCopyMove);
    fixture = createFixture(engineFactory);
    const source = await prepareProject("old-home", "甲", "pid-1");
    const newParent = path.join(fixture.tmp, "new-home");
    fs.mkdirSync(newParent);

    const result = await fixture.invoke("project-folder-move", "pid-1", "乙", newParent);

    expect(result).toEqual({ ok: true, location: path.join(newParent, "乙"), mode: "copied" });
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.existsSync(path.join(newParent, "乙", "script.json"))).toBe(true);
    expect(fixture.store.get("pid-1")).toBe(path.join(newParent, "乙"));
  });

  it("rolls the folder back when the location table update fails after a successful move", async () => {
    const { engineFactory, calls } = makeFakeEngine(fakeRenameMove);
    fixture = createFixture(engineFactory);
    const source = await prepareProject("old-home", "甲", "pid-1");
    const newParent = path.join(fixture.tmp, "new-home");
    const target = path.join(newParent, "乙");
    fs.mkdirSync(newParent);
    const set = vi.spyOn(fixture.store, "set").mockImplementationOnce(() => {
      throw new Error("persist failed");
    });

    const result = await fixture.invoke("project-folder-move", "pid-1", "乙", newParent);
    set.mockRestore();

    expect(result).toEqual({
      ok: false,
      code: "MOVE_FAILED",
      message: expect.stringContaining("文件夹已回滚"),
    });
    expect(calls.map(({ sourceDir, targetDir }) => [sourceDir, targetDir])).toEqual([
      [source, target],
      [target, source],
    ]);
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
    expect(fixture.store.get("pid-1")).toBe(source);
  });

  it("forwards engine progress on the dedicated channel", async () => {
    const { engineFactory } = makeFakeEngine((options) => {
      options.onProgress?.({ phase: "copying", filesDone: 0, filesTotal: 2, bytesDone: 0, bytesTotal: 100 });
      options.onProgress?.({ phase: "finalizing", filesDone: 2, filesTotal: 2, bytesDone: 100, bytesTotal: 100 });
      fs.renameSync(options.sourceDir, options.targetDir);
      return "renamed";
    });
    fixture = createFixture(engineFactory);
    await prepareProject("old-home", "甲", "pid-1");
    const newParent = path.join(fixture.tmp, "new-home");
    fs.mkdirSync(newParent);

    const result = await fixture.invoke("project-folder-move", "pid-1", "乙", newParent);

    expect(result).toEqual({ ok: true, location: path.join(newParent, "乙"), mode: "renamed" });
    expect(fixture.sender.send).toHaveBeenCalledTimes(2);
    expect(fixture.sender.send).toHaveBeenNthCalledWith(1, "project-folder-move-progress", {
      projectId: "pid-1",
      phase: "copying",
      filesDone: 0,
      filesTotal: 2,
      bytesDone: 0,
      bytesTotal: 100,
    });
    expect(fixture.sender.send).toHaveBeenNthCalledWith(2, "project-folder-move-progress", {
      projectId: "pid-1",
      phase: "finalizing",
      filesDone: 2,
      filesTotal: 2,
      bytesDone: 100,
      bytesTotal: 100,
    });
  });

  it("rejects non-empty targets with CONFLICT and leaves everything untouched", async () => {
    const { engineFactory, calls } = makeFakeEngine(fakeRenameMove);
    fixture = createFixture(engineFactory);
    await prepareProject("old-home", "甲", "pid-1");
    const newParent = path.join(fixture.tmp, "new-home");
    fs.mkdirSync(newParent);
    fs.mkdirSync(path.join(newParent, "乙"));
    fs.writeFileSync(path.join(newParent, "乙", "占位.txt"), "x", "utf-8");

    const result = await fixture.invoke("project-folder-move", "pid-1", "乙", newParent);

    expect(result).toEqual({ ok: false, code: "CONFLICT", message: expect.any(String) });
    expect(calls).toHaveLength(0);
    expect(fixture.store.get("pid-1")).toBe(path.join(fixture.tmp, "old-home", "甲"));
  });

  it("rejects nested targets with NESTED (data root, other locations, own subtree)", async () => {
    const { engineFactory, calls } = makeFakeEngine(fakeRenameMove);
    fixture = createFixture(engineFactory);
    await prepareProject("old-home", "甲", "pid-1");
    await prepareProject("other-home", "邻居", "pid-2");

    // Inside the application data root.
    expect(await fixture.invoke("project-folder-move", "pid-1", "乙", fixture.dataRoot))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });
    // Inside another registered location.
    expect(await fixture.invoke("project-folder-move", "pid-1", "子夹", path.join(fixture.tmp, "other-home", "邻居")))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });
    // Inside the source's own subtree.
    expect(await fixture.invoke("project-folder-move", "pid-1", "子夹", path.join(fixture.tmp, "old-home", "甲")))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });

    expect(calls).toHaveLength(0);
    expect(fixture.store.get("pid-1")).toBe(path.join(fixture.tmp, "old-home", "甲"));
  });

  it("resolves legacy projects from the data root when no location is registered", async () => {
    const { engineFactory, calls } = makeFakeEngine(fakeRenameMove);
    fixture = createFixture(engineFactory);
    const legacyDir = path.join(fixture.dataRoot, "_p", "legacy-pid");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "script.json"), "{}", "utf-8");
    const newParent = path.join(fixture.tmp, "new-home");
    fs.mkdirSync(newParent);

    const result = await fixture.invoke("project-folder-move", "legacy-pid", "迁移后", newParent);

    expect(result).toEqual({ ok: true, location: path.join(newParent, "迁移后"), mode: "renamed" });
    expect(calls[0]?.sourceDir).toBe(legacyDir);
    expect(fixture.store.get("legacy-pid")).toBe(path.join(newParent, "迁移后"));
  });

  it("reports MISSING_DIR when neither a location nor a legacy source exists", async () => {
    const { engineFactory, calls } = makeFakeEngine(fakeRenameMove);
    fixture = createFixture(engineFactory);
    const newParent = path.join(fixture.tmp, "new-home");
    fs.mkdirSync(newParent);

    expect(await fixture.invoke("project-folder-move", "ghost-pid", "乙", newParent))
      .toEqual({ ok: false, code: "MISSING_DIR", message: expect.any(String) });
    expect(calls).toHaveLength(0);
  });

  it("maps MoveCancelledError to CANCELLED and engine failures to MOVE_FAILED", async () => {
    const cancelled = makeFakeEngine(() => {
      throw new MoveCancelledError();
    });
    fixture = createFixture(cancelled.engineFactory);
    const source = await prepareProject("old-home", "甲", "pid-1");
    const newParent = path.join(fixture.tmp, "new-home");
    fs.mkdirSync(newParent);

    expect(await fixture.invoke("project-folder-move", "pid-1", "乙", newParent))
      .toEqual({ ok: false, code: "CANCELLED" });
    expect(fixture.store.get("pid-1")).toBe(source);

    const failing = makeFakeEngine(() => {
      throw new Error("disk exploded");
    });
    fixture = createFixture(failing.engineFactory);
    const source2 = await prepareProject("old-home-2", "丙", "pid-9");
    const newParent2 = path.join(fixture.tmp, "new-home-2");
    fs.mkdirSync(newParent2);

    expect(await fixture.invoke("project-folder-move", "pid-9", "丁", newParent2))
      .toEqual({ ok: false, code: "MOVE_FAILED", message: expect.stringContaining("disk exploded") });
    expect(fixture.store.get("pid-9")).toBe(source2);
  });

  it("move-cancel aborts an in-flight move, rejects concurrent moves, and reports idle state", async () => {
    let release: (() => void) | undefined;
    let engineSignal: AbortSignal | undefined;
    const { engineFactory } = makeFakeEngine((options) => {
      engineSignal = options.signal;
      return new Promise<ProjectMoveMode>((_resolve, reject) => {
        release = () => reject(new MoveCancelledError());
      });
    });
    fixture = createFixture(engineFactory);
    await prepareProject("old-home", "甲", "pid-1");
    const newParent = path.join(fixture.tmp, "new-home");
    fs.mkdirSync(newParent);

    const movePromise = fixture.invoke("project-folder-move", "pid-1", "乙", newParent);
    // The handler runs synchronously up to the first await, so the controller
    // registry and the engine call are already in place here.
    expect(engineSignal).toBeDefined();

    // A second move for the same project while one is in flight is rejected.
    expect(await fixture.invoke("project-folder-move", "pid-1", "乙", newParent))
      .toEqual({ ok: false, code: "MOVE_FAILED", message: expect.stringContaining("正在进行的移动任务") });

    expect(await fixture.invoke("project-folder-move-cancel", "pid-1"))
      .toEqual({ ok: true, cancelled: true });
    expect(engineSignal?.aborted).toBe(true);

    release?.();
    expect(await movePromise).toEqual({ ok: false, code: "CANCELLED" });

    // Registry cleaned up in finally: cancelling again reports no active task.
    expect(await fixture.invoke("project-folder-move-cancel", "pid-1"))
      .toEqual({ ok: true, cancelled: false });
  });

  it("move-cancel without an in-flight task is a no-op", async () => {
    expect(await fixture.invoke("project-folder-move-cancel", "pid-none"))
      .toEqual({ ok: true, cancelled: false });
    expect(await fixture.invoke("project-folder-move-cancel", "bad/id"))
      .toEqual({ ok: true, cancelled: false });
  });
});

describe("project-folder-import IPC handler", () => {
  let fixture: Fixture;

  beforeEach(() => {
    handlers.clear();
    fixture = createFixture();
  });

  afterEach(() => {
    for (const tmp of activeTmps) fs.rmSync(tmp, { recursive: true, force: true });
    activeTmps.length = 0;
  });

  function makeProjectFolder(
    parent: string,
    name: string,
    payload: {
      script?: unknown;
      director?: unknown;
      extraFiles?: Record<string, string>;
    } = {},
  ): string {
    const folder = path.join(parent, name);
    fs.mkdirSync(folder, { recursive: true });
    if (payload.script !== undefined) {
      fs.writeFileSync(path.join(folder, "script.json"), JSON.stringify(payload.script), "utf-8");
    }
    if (payload.director !== undefined) {
      fs.writeFileSync(path.join(folder, "director.json"), JSON.stringify(payload.director), "utf-8");
    }
    for (const [fileName, content] of Object.entries(payload.extraFiles ?? {})) {
      fs.writeFileSync(path.join(folder, fileName), content, "utf-8");
    }
    return folder;
  }

  it("reuses the extracted project id, keeps files untouched and registers the realpath", async () => {
    const scriptPayload = {
      version: 1,
      state: { activeProjectId: "orig-pid", projects: { "orig-pid": { title: "道劫" } } },
    };
    const folder = makeProjectFolder(path.join(fixture.tmp, "imports"), "捡回的项目", { script: scriptPayload });
    const before = fs.readFileSync(path.join(folder, "script.json"), "utf-8");

    const result = await fixture.invoke("project-folder-import", folder);

    expect(result).toEqual({
      ok: true,
      project: { id: "orig-pid", name: "道劫", location: fs.realpathSync(folder) },
    });
    expect(fixture.store.get("orig-pid")).toBe(fs.realpathSync(folder));
    // Zero-rewrite path: bytes stay identical.
    expect(fs.readFileSync(path.join(folder, "script.json"), "utf-8")).toBe(before);
  });

  it("mints a new UUID and rewrites project-scoped keys when the extracted id is taken", async () => {
    // Occupy "orig-pid" with another registered location.
    const otherParent = path.join(fixture.tmp, "occupied-home");
    fs.mkdirSync(otherParent);
    expect(await fixture.invoke("project-folder-prepare", "orig-pid", otherParent, "既有项目"))
      .toEqual({ ok: true, location: path.join(otherParent, "既有项目") });

    const folder = makeProjectFolder(
      path.join(fixture.tmp, "imports"),
      "同名项目",
      {
        script: {
          state: { activeProjectId: "orig-pid", projects: { "orig-pid": { title: "复制来的" } } },
        },
        director: {
          state: { activeProjectId: "orig-pid", projects: { "orig-pid": { screenplay: "第一幕" } } },
        },
        extraFiles: {
          "broken.json": "{{{not json",
          "unrelated.json": JSON.stringify({ hello: "world" }),
          "notes.txt": "plain text",
        },
      },
    );
    const brokenBefore = fs.readFileSync(path.join(folder, "broken.json"), "utf-8");
    const unrelatedBefore = fs.readFileSync(path.join(folder, "unrelated.json"), "utf-8");

    const result = await fixture.invoke("project-folder-import", folder);

    expect(result).toEqual({
      ok: true,
      project: {
        id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) as unknown as string,
        name: "复制来的",
        location: fs.realpathSync(folder),
      },
    });
    const importedPid = (result as { project: { id: string } }).project.id;
    expect(importedPid).not.toBe("orig-pid");

    const script = JSON.parse(fs.readFileSync(path.join(folder, "script.json"), "utf-8")) as {
      state: { activeProjectId: string; projects: Record<string, unknown> };
    };
    expect(Object.keys(script.state.projects)).toEqual([importedPid]);
    expect(script.state.activeProjectId).toBe(importedPid);

    const director = JSON.parse(fs.readFileSync(path.join(folder, "director.json"), "utf-8")) as {
      state: { projects: Record<string, unknown> };
    };
    expect(Object.keys(director.state.projects)).toEqual([importedPid]);

    // Parse failures and pid-free JSON files keep their bytes; non-JSON ignored.
    expect(fs.readFileSync(path.join(folder, "broken.json"), "utf-8")).toBe(brokenBefore);
    expect(fs.readFileSync(path.join(folder, "unrelated.json"), "utf-8")).toBe(unrelatedBefore);

    expect(fixture.store.get(importedPid)).toBe(fs.realpathSync(folder));
    // The occupying registration is untouched.
    expect(fixture.store.get("orig-pid")).toBe(path.join(otherParent, "既有项目"));
  });

  it("treats a legacy data-root slot as a taken pid", async () => {
    fs.mkdirSync(path.join(fixture.dataRoot, "_p", "legacy-taken"), { recursive: true });
    const folder = makeProjectFolder(path.join(fixture.tmp, "imports"), "迁移副本", {
      script: { state: { projects: { "legacy-taken": { title: "副本" } } } },
    });

    const result = await fixture.invoke("project-folder-import", folder);

    const importedPid = (result as { project: { id: string } }).project.id;
    expect(importedPid).not.toBe("legacy-taken");
    const script = JSON.parse(fs.readFileSync(path.join(folder, "script.json"), "utf-8")) as {
      state: { projects: Record<string, unknown> };
    };
    expect(Object.keys(script.state.projects)).toEqual([importedPid]);
  });

  it("returns ALREADY_REGISTERED with the existing project id", async () => {
    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);
    await fixture.invoke("project-folder-prepare", "pid-x", parent, "已注册");
    fs.writeFileSync(path.join(parent, "已注册", "script.json"), "{}", "utf-8");

    expect(await fixture.invoke("project-folder-import", path.join(parent, "已注册")))
      .toEqual({
        ok: false,
        code: "ALREADY_REGISTERED",
        message: expect.any(String),
        existingProjectId: "pid-x",
      });
  });

  it("rejects folders without project markers using NOT_A_PROJECT", async () => {
    const empty = path.join(fixture.tmp, "empty");
    fs.mkdirSync(empty);
    const randomFiles = path.join(fixture.tmp, "random");
    fs.mkdirSync(randomFiles);
    fs.writeFileSync(path.join(randomFiles, "readme.md"), "hi", "utf-8");

    expect(await fixture.invoke("project-folder-import", empty))
      .toEqual({ ok: false, code: "NOT_A_PROJECT", message: expect.any(String) });
    expect(await fixture.invoke("project-folder-import", randomFiles))
      .toEqual({ ok: false, code: "NOT_A_PROJECT", message: expect.any(String) });
  });

  it("rejects invalid paths with INVALID_PATH", async () => {
    const fileAsPath = path.join(fixture.tmp, "a-file");
    fs.writeFileSync(fileAsPath, "x", "utf-8");

    expect(await fixture.invoke("project-folder-import", "relative/path"))
      .toEqual({ ok: false, code: "INVALID_PATH", message: expect.any(String) });
    expect(await fixture.invoke("project-folder-import", path.join(fixture.tmp, "missing")))
      .toEqual({ ok: false, code: "INVALID_PATH", message: expect.any(String) });
    expect(await fixture.invoke("project-folder-import", fileAsPath))
      .toEqual({ ok: false, code: "INVALID_PATH", message: expect.any(String) });
  });

  it("rejects nested folders with NESTED", async () => {
    // Inside the application data root.
    const insideRoot = makeProjectFolder(fixture.dataRoot, "根内项目", {
      script: { state: { projects: { "inside-pid": { title: "x" } } } },
    });
    expect(await fixture.invoke("project-folder-import", insideRoot))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });

    // Inside / containing a registered location.
    const parent = path.join(fixture.tmp, "parent");
    fs.mkdirSync(parent);
    await fixture.invoke("project-folder-prepare", "pid-a", parent, "甲");
    const insideLocation = makeProjectFolder(path.join(parent, "甲"), "嵌套项目", {
      script: { state: { projects: { "nested-pid": { title: "x" } } } },
    });
    expect(await fixture.invoke("project-folder-import", insideLocation))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });

    fs.writeFileSync(path.join(parent, "director.json"), "{}", "utf-8");
    expect(await fixture.invoke("project-folder-import", parent))
      .toEqual({ ok: false, code: "NESTED", message: expect.any(String) });
  });

  it("derives the name from the director screenplay or the folder basename", async () => {
    const screenplay = "一二三四五六七八九十一二三四五六七八九十一二三四五";
    const fromScreenplay = makeProjectFolder(path.join(fixture.tmp, "imports"), "剧本项目", {
      director: { state: { projects: { "story-pid": { screenplay: `${screenplay}\n第二行` } } } },
    });
    const result = await fixture.invoke("project-folder-import", fromScreenplay);
    expect((result as { project: { name: string } }).project.name)
      .toBe(`${screenplay.substring(0, 20)}...`);

    const fromBasename = makeProjectFolder(path.join(fixture.tmp, "imports"), "光杆项目", {
      director: { state: { projects: { "bare-pid": {} } } },
    });
    const result2 = await fixture.invoke("project-folder-import", fromBasename);
    expect(result2).toEqual({
      ok: true,
      project: { id: "bare-pid", name: "光杆项目", location: fs.realpathSync(fromBasename) },
    });
  });
});
