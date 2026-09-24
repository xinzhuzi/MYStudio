// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * C1③ 渲染侧两拍执行面测试(design 测试矩阵:mock bridge,不 mock 回写逻辑)。
 * 桥替身风格先例:secure-local-storage.test.ts 的 fake 桥。每用例 vi.resetModules
 * 重新 import 模块实例(模块体自动执行),并清 globalThis 幂等标记还原首执行语义。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STARTED_FLAG = "__mystudioC1PurgeRestoreStarted";

type BridgeBehavior = {
  mode?: "idle" | "pending" | "quarantine";
  stagedEntries?: Array<[string, string]>;
  stagedOk?: boolean;
  stageOk?: boolean;
};

function installFakeBridge(behavior: BridgeBehavior) {
  const control = {
    getMode: vi.fn(() => ({ mode: behavior.mode ?? "idle" })),
    getStagedSync: vi.fn(() =>
      behavior.stagedOk === false
        ? { ok: false as const, reason: "not-found" }
        : { ok: true as const, entries: behavior.stagedEntries ?? [] },
    ),
    stage: vi.fn(async (entries: Array<[string, string]>) => {
      lastStagedEntries = entries;
      return behavior.stageOk === false ? { ok: false as const, reason: "write-failed" } : { ok: true as const };
    }),
    confirm: vi.fn(async () => ({ ok: true })),
    relaunch: vi.fn(async () => ({ ok: true })),
  };
  vi.stubGlobal("window", { c1Purge: control });
  return control;
}

let lastStagedEntries: Array<[string, string]> | null = null;

/** 模块体在 import 时自动执行;pending 相是异步链,flush 到微任务+宏任务都排空。 */
async function importPurgeModule(): Promise<typeof import("./local-storage-purge-restore")> {
  vi.resetModules();
  delete (globalThis as typeof globalThis & { [STARTED_FLAG]?: boolean })[STARTED_FLAG];
  const module = await import("./local-storage-purge-restore");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return module;
}

beforeEach(() => {
  localStorage.clear();
  lastStagedEntries = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("local-storage-purge-restore 渲染侧", () => {
  it("拍0 pending:全量捕获 localStorage → stage → relaunch(暂存键值逐对深相等)", async () => {
    localStorage.setItem("opencut-api-config", '{"v":2,"cipher":"ZmFrZQ=="}');
    localStorage.setItem("ui-preferences", '{"theme":"dark"}');
    localStorage.setItem("storyboard-cache", "[1,2,3]");
    const control = installFakeBridge({ mode: "pending" });
    await importPurgeModule();
    expect(control.stage).toHaveBeenCalledTimes(1);
    expect(lastStagedEntries).toEqual([
      ["opencut-api-config", '{"v":2,"cipher":"ZmFrZQ=="}'],
      ["ui-preferences", '{"theme":"dark"}'],
      ["storyboard-cache", "[1,2,3]"],
    ]);
    expect(control.relaunch).toHaveBeenCalledTimes(1);
  });

  it("拍0 stage 失败:撤等待态照常启动,不 relaunch(数据未动,下个 boot 重试)", async () => {
    localStorage.setItem("k", "v");
    const control = installFakeBridge({ mode: "pending", stageOk: false });
    await importPurgeModule();
    expect(control.stage).toHaveBeenCalledTimes(1);
    expect(control.relaunch).not.toHaveBeenCalled();
    expect(localStorage.getItem("k")).toBe("v");
  });

  it("拍0 空库守卫:localStorage 异常为空时放弃协议,不 stage 空表(防拍1 回写出空库毁数据)", async () => {
    const control = installFakeBridge({ mode: "pending" });
    await importPurgeModule();
    expect(control.stage).not.toHaveBeenCalled();
    expect(control.relaunch).not.toHaveBeenCalled();
  });

  it("拍1 quarantine:sendSync 取 staged → 同步逐键 setItem 全量回写 → confirm 收尾", async () => {
    const control = installFakeBridge({
      mode: "quarantine",
      stagedEntries: [
        ["opencut-api-config", '{"v":2,"cipher":"QQ=="}'],
        ["ui-preferences", '{"theme":"dark"}'],
      ],
    });
    await importPurgeModule();
    // 回写同步完成(import 返回时已就位,先于任何 store 模块求值)
    expect(localStorage.getItem("opencut-api-config")).toBe('{"v":2,"cipher":"QQ=="}');
    expect(localStorage.getItem("ui-preferences")).toBe('{"theme":"dark"}');
    expect(control.getStagedSync).toHaveBeenCalledTimes(1);
    expect(control.confirm).toHaveBeenCalledTimes(1);
  });

  it("拍1 取档失败:零回写零 confirm(旧库仍在主进程 quarantine,下个 boot 回滚自愈)", async () => {
    const control = installFakeBridge({ mode: "quarantine", stagedOk: false });
    await importPurgeModule();
    expect(localStorage.length).toBe(0);
    expect(control.confirm).not.toHaveBeenCalled();
  });

  it("idle 模式:零动作", async () => {
    const control = installFakeBridge({ mode: "idle" });
    await importPurgeModule();
    expect(control.getStagedSync).not.toHaveBeenCalled();
    expect(control.stage).not.toHaveBeenCalled();
    expect(control.confirm).not.toHaveBeenCalled();
    expect(control.relaunch).not.toHaveBeenCalled();
  });

  it("桥缺席(web dev 未注入):零动作不抛错", async () => {
    vi.stubGlobal("window", {});
    await expect(importPurgeModule()).resolves.toBeTruthy();
    expect(localStorage.length).toBe(0);
  });

  it("getMode 抛错:入口模块吞错不炸(抛=白屏)", async () => {
    vi.stubGlobal("window", {
      c1Purge: {
        getMode: () => {
          throw new Error("sendSync 通道故障");
        },
      },
    });
    await expect(importPurgeModule()).resolves.toBeTruthy();
  });

  it("幂等:同模块实例二次执行零副作用(热重载/双执行守卫)", async () => {
    localStorage.setItem("k", "v");
    const control = installFakeBridge({ mode: "pending" });
    const module = await importPurgeModule();
    expect(control.stage).toHaveBeenCalledTimes(1);
    module.runLocalStoragePurgeRestore();
    expect(control.stage).toHaveBeenCalledTimes(1);
    expect(control.relaunch).toHaveBeenCalledTimes(1);
  });

  it("globalThis 标记跨模块实例幂等(热重载重建模块后仍零副作用)", async () => {
    localStorage.setItem("k", "v");
    const control = installFakeBridge({ mode: "pending" });
    await importPurgeModule();
    expect(control.stage).toHaveBeenCalledTimes(1);
    // 不清 STARTED_FLAG 的二次 import(模拟热重载)
    vi.resetModules();
    await import("./local-storage-purge-restore");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(control.stage).toHaveBeenCalledTimes(1);
  });

  it("拍0 等待态:原生 DOM 全屏覆盖层挂上(文档有元素、role=status、挡交互文案)", async () => {
    const created: Array<{ id: string; text: string; parent: unknown }> = [];
    const overlayElement = {
      id: "",
      style: {} as Record<string, string>,
      textContent: "",
      setAttribute: vi.fn(),
    };
    const documentElement = { appendChild: vi.fn((el: unknown) => created.push(el as never)) };
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => overlayElement),
      documentElement,
    });
    localStorage.setItem("k", "v");
    const control = installFakeBridge({ mode: "pending" });
    await importPurgeModule();
    expect(control.relaunch).toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(overlayElement.id).toBe("c1-purge-pending-overlay");
    expect(overlayElement.textContent).toContain("自动重启");
    expect(overlayElement.style.zIndex).toBe("2147483647");
  });
});
