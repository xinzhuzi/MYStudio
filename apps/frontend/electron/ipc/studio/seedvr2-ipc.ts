// SeedVR2 修复档 IPC(09-01-seedvr2-7bsharp-rollout)。
// 通道名用字符串字面量注册(IPC 契约测试按字面量扫描);handler 一律 fail-closed。

import { ipcMain } from "electron";

import { probeSeedVr2 } from "@rendering/plugins/seedvr2/seedvr2-probe";

export function registerSeedVr2IpcHandlers(): { dispose: () => void } {
  ipcMain.handle("seedvr2-restore-probe", () => probeSeedVr2());
  return {
    dispose: () => {
      ipcMain.removeHandler("seedvr2-restore-probe");
    },
  };
}
