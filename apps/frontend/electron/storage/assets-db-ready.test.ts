import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ensureAssetsDatabaseReady,
  getDbPath,
  runSqliteExec,
  runSqliteJsonSync,
} from "./assets-sqlite";

const dirs = [mkdtempSync(path.join(os.tmpdir(), "assets-a-")), mkdtempSync(path.join(os.tmpdir(), "assets-b-"))];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("资产库库路径就绪闸(1123 启动崩溃根修)", () => {
  it("未初始化时拒绝拼出相对 assets.db(该相对路径正是启动崩溃元凶)", () => {
    expect(() => getDbPath()).toThrow(/尚未初始化/);
  });

  it("惰性就绪才建库;同根幂等;换根(项目切换)自动重挂", () => {
    ensureAssetsDatabaseReady(() => dirs[0]);
    expect(getDbPath()).toBe(path.join(dirs[0], "assets.db"));
    expect(existsSync(getDbPath())).toBe(true);

    runSqliteExec(getDbPath(), "CREATE TABLE IF NOT EXISTS probe(x TEXT);");
    const tables = runSqliteJsonSync<Array<{ name: string }>>(getDbPath(), "SELECT name FROM sqlite_master WHERE type='table';");
    expect(tables.some((row) => row.name === "probe")).toBe(true);

    ensureAssetsDatabaseReady(() => dirs[0]);
    expect(getDbPath()).toBe(path.join(dirs[0], "assets.db"));

    ensureAssetsDatabaseReady(() => dirs[1]);
    expect(getDbPath()).toBe(path.join(dirs[1], "assets.db"));
    expect(existsSync(getDbPath())).toBe(true);
  });
});
