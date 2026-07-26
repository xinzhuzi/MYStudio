import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export function resolveAppBundlePath(appBin) {
  const marker = "/Contents/MacOS/";
  const markerIndex = appBin.indexOf(marker);
  if (markerIndex < 0) return null;
  return appBin.slice(0, markerIndex);
}

export function shouldFallbackToLaunchServices({
  platform,
  childExit,
  launchMode,
}) {
  if (platform !== "darwin" || launchMode !== "auto" || !childExit) {
    return false;
  }
  return childExit.code === 134 || childExit.signal === "SIGABRT";
}

export function spawnSmokeApp({
  appBin,
  args,
  cwd,
  env,
  launchMode = "direct",
  detached = false,
}) {
  if (launchMode === "direct") {
    return {
      child: spawn(appBin, args, {
        cwd,
        env,
        detached,
        stdio: ["ignore", "pipe", "pipe"],
      }),
      launchMode,
      tracksChildExit: true,
      bundlePath: null,
    };
  }

  const bundlePath = resolveAppBundlePath(appBin);
  if (!bundlePath || !existsSync(bundlePath)) {
    throw new Error(
      `LaunchServices requires a macOS .app bundle; resolved path was ${bundlePath || "missing"}`,
    );
  }

  return {
    child: spawn("open", ["-na", bundlePath, "--args", ...args], {
      cwd,
      env,
      detached,
      stdio: ["ignore", "pipe", "pipe"],
    }),
    launchMode: "launch-services",
    tracksChildExit: false,
    bundlePath,
  };
}
