import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createProjectLocationStore } from "./project-locations";

type Fixture = {
  tmp: string;
  userData: string;
  dataRoot: string;
  store: ReturnType<typeof createProjectLocationStore>;
};

function createFixture(): Fixture {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-project-locations-"));
  const userData = path.join(tmp, "userData");
  const dataRoot = path.join(tmp, "data", "projects");
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  const store = createProjectLocationStore({ userDataPath: userData, getProjectsDataRoot: () => dataRoot });
  return { tmp, userData, dataRoot, store };
}

function expectThrow(received: () => void, messagePart: string) {
  expect(received).toThrow(messagePart);
}

describe("project location store", () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  });

  it("persists set entries atomically and rehydrates them in a new instance", () => {
    const dir = path.join(fixture.tmp, "ext", "proj-a");
    fs.mkdirSync(dir, { recursive: true });

    fixture.store.set("pid-a", dir);

    const persistedPath = path.join(fixture.userData, "project-locations.json");
    expect(fs.existsSync(persistedPath)).toBe(true);
    // Atomic write: no temporary files left behind.
    expect(fs.readdirSync(fixture.userData)).toEqual(["project-locations.json"]);
    const persisted = JSON.parse(fs.readFileSync(persistedPath, "utf-8")) as {
      version: number;
      locations: Record<string, string>;
    };
    expect(persisted.version).toBe(1);
    expect(persisted.locations).toEqual({ "pid-a": dir });

    const reloaded = createProjectLocationStore({ userDataPath: fixture.userData });
    expect(reloaded.get("pid-a")).toBe(dir);
    expect(reloaded.all()).toEqual({ "pid-a": dir });
  });

  it("rejects locations inside or containing the application data root", () => {
    const insideRoot = path.join(fixture.dataRoot, "inner");
    fs.mkdirSync(insideRoot);
    expectThrow(() => fixture.store.set("pid-1", insideRoot), "项目位置不能位于应用数据目录内部");

    const containingRoot = path.dirname(fixture.dataRoot);
    expectThrow(() => fixture.store.set("pid-2", containingRoot), "项目位置不能包含应用数据目录");

    expect(fixture.store.all()).toEqual({});
  });

  it("rejects duplicate locations, including through symlink aliases and case variants", () => {
    const dir = path.join(fixture.tmp, "ext", "AlphaProj");
    fs.mkdirSync(dir, { recursive: true });
    fixture.store.set("pid-a", dir);

    // Direct duplicate.
    expectThrow(() => fixture.store.set("pid-b", dir), "项目位置已被项目 pid-a 使用");

    // Symlink alias resolves to the same realpath → duplicate.
    const alias = path.join(fixture.tmp, "alias-to-alpha");
    fs.symlinkSync(dir, alias, "dir");
    expectThrow(() => fixture.store.set("pid-b", alias), "项目位置已被项目 pid-a 使用");

    // Case-insensitive duplicate. The differently-cased twin exists on disk so
    // the check holds on both case-insensitive volumes (same entry, realpath
    // resolves to the stored casing) and case-sensitive ones (distinct entries
    // that lowercase to the same comparison key).
    fs.mkdirSync(path.join(fixture.tmp, "ext", "alphaproj"), { recursive: true });
    expectThrow(() => fixture.store.set("pid-b", path.join(fixture.tmp, "ext", "alphaproj")), "项目位置已被项目 pid-a 使用");

    expect(fixture.store.all()).toEqual({ "pid-a": dir });
  });

  it("rejects parent/child nesting between registered locations, symlink-aware", () => {
    const dir = path.join(fixture.tmp, "ext", "proj-a");
    fs.mkdirSync(dir, { recursive: true });
    fixture.store.set("pid-a", dir);

    const child = path.join(dir, "child");
    fs.mkdirSync(child);
    expectThrow(() => fixture.store.set("pid-b", child), "项目位置与项目 pid-a 的位置存在嵌套");

    // A symlink to a location's ancestor is a container → still nested.
    const aliasToParent = path.join(fixture.tmp, "alias-to-ext");
    fs.symlinkSync(path.join(fixture.tmp, "ext"), aliasToParent, "dir");
    expectThrow(() => fixture.store.set("pid-b", aliasToParent), "项目位置与项目 pid-a 的位置存在嵌套");

    expect(fixture.store.all()).toEqual({ "pid-a": dir });
  });

  it("rejects a symlink that points into the data root (NESTED semantics)", () => {
    const targetInsideRoot = path.join(fixture.dataRoot, "sneaky-target");
    fs.mkdirSync(targetInsideRoot);
    const link = path.join(fixture.tmp, "sneaky-link");
    fs.symlinkSync(targetInsideRoot, link, "dir");

    expectThrow(() => fixture.store.set("pid-1", link), "项目位置不能位于应用数据目录内部");
    expect(fixture.store.all()).toEqual({});
  });

  it("tolerates a corrupted locations file by starting from an empty table", () => {
    fs.writeFileSync(path.join(fixture.userData, "project-locations.json"), "{{{not json", "utf-8");

    const reloaded = createProjectLocationStore({ userDataPath: fixture.userData });
    expect(reloaded.all()).toEqual({});
    expect(reloaded.get("pid-a")).toBeUndefined();

    // Still fully operational after the corrupted load.
    const dir = path.join(fixture.tmp, "ext", "proj-a");
    fs.mkdirSync(dir, { recursive: true });
    reloaded.set("pid-a", dir);
    expect(reloaded.get("pid-a")).toBe(dir);
  });

  it("delete removes entries and is a no-op for unknown ids", () => {
    const dir = path.join(fixture.tmp, "ext", "proj-a");
    fs.mkdirSync(dir, { recursive: true });
    fixture.store.set("pid-a", dir);

    fixture.store.delete("unknown");
    expect(fixture.store.get("pid-a")).toBe(dir);

    fixture.store.delete("pid-a");
    expect(fixture.store.get("pid-a")).toBeUndefined();
    expect(fixture.store.all()).toEqual({});

    const reloaded = createProjectLocationStore({ userDataPath: fixture.userData });
    expect(reloaded.get("pid-a")).toBeUndefined();
  });

  it("rejects invalid project ids and non-absolute paths", () => {
    expectThrow(() => fixture.store.set("bad/id", path.join(fixture.tmp, "x")), "项目 ID 无效");
    expectThrow(() => fixture.store.set("pid-1", "relative/path"), "项目位置必须是绝对路径");
    expectThrow(() => fixture.store.set("pid-1", "   "), "项目位置不能为空");
  });
});
