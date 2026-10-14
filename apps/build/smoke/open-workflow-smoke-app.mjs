import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  probeRunningInstances,
  resolvePrekillMode,
} from "./smoke-process-lifecycle.mjs";

const appBinCandidates = [
  process.env.MYSTUDIO_SMOKE_APP_BIN,
  resolve(
    process.cwd(),
    "release",
    "build",
    "mac-arm64",
    "mac-arm64",
    "漫影工作室.app",
    "Contents",
    "MacOS",
    "漫影工作室",
  ),
  resolve(
    process.cwd(),
    "release",
    "build",
    "mac-arm64",
    "漫影工作室.app",
    "Contents",
    "MacOS",
    "漫影工作室",
  ),
].filter(Boolean);
const appBin =
  appBinCandidates.find((candidate) => existsSync(candidate)) ??
  appBinCandidates[0];
const skipPrekill = process.env.MYSTUDIO_SMOKE_SKIP_PREKILL === "1";
// 10-15 R20(audit4-residuals):prekill 三态对齐 f5166c75——默认=探测实例在即
// 中止不盲杀;SKIP=跳过不杀;FORCE=旧盲杀显式口。SKIP 优先于 FORCE。
const prekillForce = process.env.MYSTUDIO_SMOKE_PREKILL_FORCE === "1";
const userDataDir =
  process.env.MYSTUDIO_SMOKE_USER_DATA_DIR ||
  mkdtempSync(resolve(tmpdir(), "mystudio-smoke-open-"));

if (!existsSync(appBin)) {
  console.error(
    `Packaged app was not found. Checked:\n${appBinCandidates.join("\n")}`,
  );
  process.exit(1);
}

function runOptional(command, args) {
  spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: "ignore",
  });
}

function stopExistingMYStudioInstances() {
  const prekillMode = resolvePrekillMode({ skipPrekill, prekillForce });
  if (prekillMode === "skip") {
    console.log("[open] skipping pre-run MYStudio instance cleanup");
    return;
  }
  // 10-15 R20 三态守卫(f5166c75 对齐):默认=pgrep 探测实例在即中止,不再盲杀
  // 用户在驾实例(残留冒烟僵尸与用户实例不可区分,保守按实例在)。
  if (prekillMode === "guard") {
    if (probeRunningInstances().length > 0) {
      console.error(
        "[open] 检测到漫影工作室实例正在运行,已中止(prekill 不再默认盲杀)。"
        + "请关闭 App 后重跑;若确认是残留冒烟僵尸,可设 "
        + "MYSTUDIO_SMOKE_SKIP_PREKILL=1 跳过 prekill,或 "
        + "MYSTUDIO_SMOKE_PREKILL_FORCE=1 显式清理。",
      );
      process.exit(1);
    }
    console.log("[open] no running MYStudio instance detected; proceeding without prekill");
    return;
  }
  // FORCE=旧盲杀语义显式口:以下 legacy 清理逐字保留(build-scripts.test.ts 锁)。
  if (process.platform === "darwin") {
    runOptional("osascript", [
      "-e",
      'tell application id "com.my.manying-studio" to quit',
    ]);
  }
  for (const processName of [
    "漫影工作室",
    "漫影工作室 Helper",
    "manying-studio",
  ]) {
    runOptional("pkill", ["-x", processName]);
  }
  runOptional("pkill", ["-f", "漫影工作室.app/Contents"]);
  console.log("[open] closed existing MYStudio instances before opening workflow app");
}

function bringAppToForeground(pid) {
  if (process.platform !== "darwin" || !pid) return;
  const script = `tell application "System Events" to set frontmost of first process whose unix id is ${pid} to true`;
  const result = spawnSync("osascript", ["-e", script], { stdio: "ignore" });
  if (result.status !== 0) {
    console.warn(
      "[open] failed to bring app to foreground; macOS may require Automation or Accessibility permission",
    );
  }
}

stopExistingMYStudioInstances();

const args = [`--user-data-dir=${userDataDir}`];
if (process.env.MYSTUDIO_SMOKE_DEBUG_PORT) {
  args.push(`--remote-debugging-port=${process.env.MYSTUDIO_SMOKE_DEBUG_PORT}`);
}

const child = spawn(appBin, args, {
  cwd: process.cwd(),
  detached: true,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1", MYSTUDIO_SMOKE: "1" },
  stdio: "ignore",
});

child.unref();
setTimeout(() => bringAppToForeground(child.pid), 1_000).unref();

console.log(
  `[open] workflow smoke app started and left open: pid=${child.pid}, userDataDir=${userDataDir}, appBin=${appBin}`,
);
