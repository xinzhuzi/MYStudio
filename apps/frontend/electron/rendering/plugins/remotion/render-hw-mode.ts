// D3「硬件加速渲染」开关的持久化与读取（08-18-effect-upgrade，Step C 尾巴）。
//
// 约束（复审 M2）：开关严禁写入 plan.renderSettings——remotion-chapter-renderer.ts:155
// 对 renderSettings 单独哈希并入 inputHash，写入=不用新资源也触发全章缓存失效。故
// 本开关落在应用级文件（userData/render-hw.json），渲染入口在构造 renderMedia 调用
// 参数时读取；独立渲染器（standalone）另支持 MYSTUDIO_RENDER_HW=1 env 覆盖。
//
// 开=chromeMode:"chrome"（系统 Chrome，Metal GPU；本机 forceIPv4 补丁已在库）；
// 关（默认）=chromeMode:"headless-shell" + chromiumOptions:{gl:"swangle"}（软渲基线）。

import fs from "node:fs";
import path from "node:path";

export interface RenderHwSettings {
  hardwareAcceleration: boolean;
}

const FILE_NAME = "render-hw.json";

function settingsPath(userDataDir: string): string {
  return path.join(userDataDir, FILE_NAME);
}

export function readRenderHwSettings(userDataDir: string): RenderHwSettings {
  if (process.env.MYSTUDIO_RENDER_HW === "1") return { hardwareAcceleration: true };
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(userDataDir), "utf8")) as { hardwareAcceleration?: unknown };
    return { hardwareAcceleration: raw.hardwareAcceleration === true };
  } catch {
    return { hardwareAcceleration: false };
  }
}

export function writeRenderHwSettings(userDataDir: string, settings: RenderHwSettings): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(settingsPath(userDataDir), JSON.stringify(settings, null, 2), "utf8");
}

/** 系统 Chrome 探测（macOS 常规安装路径；不存在返回 null=回退软渲）。 */
export function detectSystemChrome(): string | null {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    `${process.env.HOME ?? ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  ];
  try {
    const fsSync = candidates.find((c) => c && fs.existsSync(c));
    return fsSync ?? null;
  } catch {
    return null;
  }
}

/**
 * renderMedia 通道参数（按开关分支；调用方不得把本结果并入 plan/hashInput）。
 * （史实更新 1007：4.0.533 起 remotion 已提供 chromeMode（'chrome'|'headless-shell'），
 * 4.0.499 时代确无——现行仍走 browserExecutable 指系统 Chrome + 不传 swangle
 * （真 GPU 跑 headless）；是否改用原生 chromeMode 待单独评估，勿随手切。）
 * 探测不到系统 Chrome 时回退软渲（调用方以 browserExecutable 为准判通道）。
 */
export function renderChannelOptions(
  settings: RenderHwSettings,
): {
  browserExecutable: string | null;
  chromiumOptions: { gl?: "swangle" };
} {
  if (settings.hardwareAcceleration) {
    const chrome = detectSystemChrome();
    if (chrome) return { browserExecutable: chrome, chromiumOptions: {} };
  }
  return { browserExecutable: null, chromiumOptions: { gl: "swangle" } };
}
