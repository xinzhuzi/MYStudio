import { spawnSync } from "node:child_process";

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function signalSpawnedApp(childProcess, signal, detached) {
  const pid = childProcess.pid;
  if (!pid) return;
  if (detached && process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      if (error?.code === "ESRCH") return;
    }
  }
  try {
    childProcess.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

export async function terminateSpawnedApp(
  childProcess,
  { detached = true, logPrefix = "[smoke]" } = {},
) {
  const pid = childProcess.pid;
  if (!pid) return;
  signalSpawnedApp(childProcess, "SIGTERM", detached);
  const deadline = Date.now() + 2_500;
  while (isProcessRunning(pid) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (isProcessRunning(pid)) signalSpawnedApp(childProcess, "SIGKILL", detached);
  childProcess.unref();
  console.log(`${logPrefix} terminated smoke app: pid=${pid}`);
}

// ── 10-15 audit4-residuals R20:自起 PID 精收 + 三态 prekill 守卫的可测核 ──
// 背景(复核账 L4):杀进程一律按自起 PID 精确收,禁 pkill 名字盲杀/-9 全杀;
// prekill(杀运行前既存实例)无自起 pid 可言,统一对齐 f5166c75 三态守卫:
// 默认=pgrep 探测实例在即中止 / MYSTUDIO_SMOKE_SKIP_PREKILL=1 跳过不杀 /
// MYSTUDIO_SMOKE_PREKILL_FORCE=1 旧盲杀语义显式口(SKIP 优先于 FORCE)。
// 本节全部依赖注入(runner/isAlive/delay),测试零真实进程零真实等待。

/** pgrep stdout(每行一 pid)→ 正整数 pid 数组;空/脏行/非正整数剔除。 */
export function parsePgrepPids(stdout) {
  return String(stdout ?? "")
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** 现存在 pids − launch 前快照 pids = 自起实例差集(顺序保持,before 集合化)。 */
export function diffSelfStartedPids(beforePids, afterPids) {
  const before = new Set(beforePids ?? []);
  return (afterPids ?? []).filter((pid) => !before.has(pid));
}

/** 三态决策(纯):skip > force > guard。与 smoke-desktop f5166c75 定序逐字一致。 */
export function resolvePrekillMode({ skipPrekill = false, prekillForce = false } = {}) {
  if (skipPrekill) return "skip";
  if (prekillForce) return "force";
  return "guard";
}

/** pgrep 探测实例 pids(默认真跑 pgrep;测试注入 run)。零命中/无 stdout=空数组。 */
export function probeRunningInstances({ pattern = "漫影工作室.app", run } = {}) {
  const exec = run ?? ((cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }));
  const probe = exec("pgrep", ["-f", pattern]);
  return parsePgrepPids(probe?.stdout);
}

/**
 * 自起实例精收:对给定 pids 逐一 SIGTERM → 宽限轮询(迭代有界,墙钟无关)→
 * 幸存者补 SIGKILL。去重并滤除 pid≤1(永不碰 init/自己)。返回实际下刀的 pids。
 */
export async function terminatePidsPrecisely(
  pids,
  {
    run = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" }),
    isAlive = isProcessRunning,
    delay = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms)),
    graceMs = 2_500,
    logPrefix = "[smoke]",
  } = {},
) {
  const targets = [...new Set(pids ?? [])].filter(
    (pid) => Number.isInteger(pid) && pid > 1,
  );
  if (!targets.length) return [];
  for (const pid of targets) {
    try {
      run("kill", ["-TERM", String(pid)]);
    } catch {
      /* 可选:pid 已退 */
    }
  }
  let survivors = targets.filter((pid) => isAlive(pid));
  const maxWaits = Math.max(1, Math.ceil(graceMs / 100));
  for (let i = 0; i < maxWaits && survivors.length > 0; i += 1) {
    await delay(100);
    survivors = survivors.filter((pid) => isAlive(pid));
  }
  for (const pid of survivors) {
    try {
      run("kill", ["-KILL", String(pid)]);
    } catch {
      /* 可选:竞态已退 */
    }
  }
  console.log(
    `${logPrefix} precisely terminated self-started instance pids: ${targets.join(", ")}` +
      (survivors.length ? ` (SIGKILL after grace: ${survivors.join(", ")})` : ""),
  );
  return targets;
}
