/**
 * H3 批量防休眠 IPC(P2a;PRD §5.4 N3+C7):
 * 过夜批(19 镜 960P≈6-7h)期间 Mac 空闲自动休眠=引擎被杀=全批断。
 * 主进程 powerSaveBlocker('prevent-app-suspension') 在批量 start/stop 边界开停,
 * 幂等:重复 start 返回同一 blocker;无活动时 stop 为 no-op。
 * 边界如实(§六):只防「空闲自动休眠」,防不了手动合盖——发车确认对话另带警示文案。
 */
import { ipcMain, powerSaveBlocker } from "electron";

let activeBlockerId: number | null = null;

export function registerPowerSaveIpcHandlers(): void {
  ipcMain.handle("h3-power-save-start", () => {
    if (activeBlockerId !== null && powerSaveBlocker.isStarted(activeBlockerId)) {
      return { started: true, id: activeBlockerId, alreadyRunning: true };
    }
    activeBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    return { started: true, id: activeBlockerId, alreadyRunning: false };
  });

  ipcMain.handle("h3-power-save-stop", () => {
    if (activeBlockerId !== null && powerSaveBlocker.isStarted(activeBlockerId)) {
      powerSaveBlocker.stop(activeBlockerId);
    }
    activeBlockerId = null;
    return { started: false };
  });
}
