import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

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
const userDataDir =
  process.env.MYSTUDIO_SMOKE_USER_DATA_DIR ||
  mkdtempSync(resolve(tmpdir(), "mystudio-smoke-open-"));

if (!existsSync(appBin)) {
  console.error(
    `Packaged app was not found. Checked:\n${appBinCandidates.join("\n")}`,
  );
  process.exit(1);
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
