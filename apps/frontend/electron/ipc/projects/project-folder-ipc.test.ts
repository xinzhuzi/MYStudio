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

import { createProjectLocationStore } from "../../storage/project-locations";
import { registerProjectFolderIpcHandlers } from "./project-folder-ipc";

type Fixture = {
  tmp: string;
  userData: string;
  dataRoot: string;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  store: ReturnType<typeof createProjectLocationStore>;
};

function createFixture(): Fixture {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-project-folder-"));
  const userData = path.join(tmp, "userData");
  const dataRoot = path.join(tmp, "data", "projects");
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  const store = createProjectLocationStore({ userDataPath: userData, getProjectsDataRoot: () => dataRoot });
  registerProjectFolderIpcHandlers({ locationStore: store, getProjectsDataRoot: () => dataRoot });
  return {
    tmp,
    userData,
    dataRoot,
    store,
    invoke: (channel, ...args) => Promise.resolve(handlers.get(channel)?.(null, ...args)),
  };
}

describe("project-folder IPC handlers", () => {
  let fixture: Fixture;

  beforeEach(() => {
    handlers.clear();
    fixture = createFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
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
});
