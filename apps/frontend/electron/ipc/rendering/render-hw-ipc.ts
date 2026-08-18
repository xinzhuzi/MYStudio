/**
 * D3「硬件加速渲染」开关 IPC（08-18-effect-upgrade）。
 * 渲染设置页读写 userData/render-hw.json；渲染入口（chapter renderer/standalone）
 * 在构造 renderMedia 调用参数时读取——严禁并入 plan.renderSettings（M2 缓存陷阱）。
 */
import { ipcMain } from "electron";
import {
  readRenderHwSettings,
  writeRenderHwSettings,
} from "@rendering/plugins/remotion/render-hw-mode";

export function registerRenderHwIpcHandlers(getUserDataDir: () => string): void {
  ipcMain.handle("render-hw-get", () => readRenderHwSettings(getUserDataDir()));
  ipcMain.handle("render-hw-set", (_event, settings: { hardwareAcceleration?: unknown }) => {
    if (!settings || typeof settings !== "object") {
      throw new Error("render-hw-set 参数必须是对象");
    }
    writeRenderHwSettings(getUserDataDir(), { hardwareAcceleration: settings.hardwareAcceleration === true });
    return readRenderHwSettings(getUserDataDir());
  });
}
