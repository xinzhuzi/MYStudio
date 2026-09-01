import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inspectPackagedRemotionApp } from '../remotion/verify-packaged-remotion.mjs';

const packagedApp = resolve(process.cwd(), 'release', 'build', 'mac-arm64', 'mac-arm64', '漫影工作室.app');
const installedApp = '/Applications/漫影工作室.app';
const packagedAsar = resolve(packagedApp, 'Contents', 'Resources', 'app.asar');
const installedAsar = resolve(installedApp, 'Contents', 'Resources', 'app.asar');
const installedBin = resolve(installedApp, 'Contents', 'MacOS', '漫影工作室');
const userDataDirFromEnv = process.env.MYSTUDIO_SMOKE_USER_DATA_DIR || '';
const userDataDir =
  userDataDirFromEnv || mkdtempSync(resolve(tmpdir(), 'mystudio-installed-smoke-'));
// 08-24 根治「冒烟空壳」:本脚本自建的冒烟隔离 profile 在链尾整体清理
// (MYSTUDIO_SMOKE_KEEP_USER_DATA=1 保留供排查)。
const ownsUserDataDir = !userDataDirFromEnv;
const debugPort = process.env.MYSTUDIO_SMOKE_DEBUG_PORT || '9363';
const smokeCommandLabel = 'npm run smoke:desktop';
const skipPrekill = process.env.MYSTUDIO_SMOKE_SKIP_PREKILL === '1';

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function runOptional(command, args) {
  spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'ignore',
  });
}

function sleepSync(seconds) {
  spawnSync('sleep', [String(seconds)], { stdio: 'ignore' });
}

function stopInstalledAppIfRunning() {
  if (skipPrekill) {
    console.log('Skipping pre-run MYStudio instance cleanup');
    return;
  }
  runOptional('osascript', [
    '-e',
    'tell application id "com.manju2026.manying-studio" to quit',
  ]);
  for (const processName of [
    '漫影工作室',
    '漫影工作室 Helper',
    'manying-studio',
  ]) {
    runOptional('pkill', ['-x', processName]);
  }
  runOptional('pkill', ['-f', '漫影工作室.app/Contents']);
  // 09-01 根修:detached 图片 sidecar(image_gen.main)不随 app 退出,覆盖安装后
  // 穿成「health 200 但文件态陈旧」的假健康进程,新装 app 直接复用→生成秒败 500。
  runOptional('pkill', ['-f', 'image_gen.main']);
  killSingletonLockHolder();
  console.log('Closed existing MYStudio instances before install smoke');
}

// 08-25 修复:dev 形态实例(npm run dev / electron .,进程名 Electron、bundle 不同)
// 不会被上面的包名/bundle 清理命中,但它持有真实 userData 的单实例锁——
// open-verify 以用户双击方式对真实 userData 启动,会被它静默弹退成「启动崩溃」。
// 解析真实 userData SingletonLock 符号链接的持锁 pid 并终止,覆盖任何形态的锁持有者;
// MYSTUDIO_SMOKE_SKIP_PREKILL=1 仍可整体跳过。
function killSingletonLockHolder() {
  const lockPath = resolve(
    homedir(),
    'Library/Application Support/漫影工作室/SingletonLock',
  );
  let target;
  try {
    target = readlinkSync(lockPath);
  } catch {
    return; // 无锁(正常空闲)
  }
  const match = /-(\d+)$/.exec(target);
  if (!match) return;
  const pid = Number(match[1]);
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  runOptional('kill', [String(pid)]);
  sleepSync(1);
  runOptional('kill', ['-9', String(pid)]);
  console.log(`Killed singleton-lock holder pid=${pid} (${target})`);
}

function assertNoBackupApps() {
  const backups = readdirSync('/Applications')
    .filter((name) => /^漫影工作室\.app\.(?:backup-|backup$)/.test(name));
  if (backups.length > 0) {
    throw new Error(`Found forbidden backup app copies in /Applications: ${backups.join(', ')}`);
  }
}

// ditto merges into an existing bundle instead of replacing it, so stale
// chunks from an older build survive a bare copy. Removing the destination
// immediately before the copy is what turns install into a clean replace —
// and keeps the window in which the app is absent down to seconds.
function installPackagedApp() {
  rmSync(installedApp, { recursive: true, force: true });
  run('ditto', [packagedApp, installedApp]);
}

function verifyInstalledIntegrity() {
  if (!existsSync(installedAsar) || !existsSync(installedBin)) {
    throw new Error(`Installed app is incomplete: ${installedApp}`);
  }
  const packagedHash = sha256(packagedAsar);
  const installedHash = sha256(installedAsar);
  if (packagedHash !== installedHash) {
    throw new Error(`Installed app.asar hash mismatch: packaged=${packagedHash}, installed=${installedHash}`);
  }
  console.log(`Installed app.asar hash verified: ${installedHash}`);
}

function findInstalledAppPid() {
  const result = spawnSync('pgrep', ['-f', `${installedApp}/Contents/MacOS`], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) {
    return null;
  }
  return result.stdout.trim().split('\n')[0];
}

function reportRecentCrashLogs() {
  const reportsDir = resolve(homedir(), 'Library', 'Logs', 'DiagnosticReports');
  if (!existsSync(reportsDir)) {
    return;
  }
  const since = Date.now() - 5 * 60_000;
  for (const name of readdirSync(reportsDir)) {
    if (!/漫影工作室|manying/.test(name)) {
      continue;
    }
    const full = resolve(reportsDir, name);
    if (statSync(full).mtimeMs < since) {
      continue;
    }
    console.log(`[open-verify] recent crash report: ${name}`);
  }
}

// The smoke above launches the binary with a throwaway user-data dir, which
// cannot prove the user-facing double-click path. This gate launches the
// installed bundle through Launch Services against the real user data and
// requires the main process to come up and stay up.
function verifyRealOpen() {
  console.log('[open-verify] launching installed app the way a user double-click would');
  run('open', [installedApp]);
  const spawnDeadline = Date.now() + 20_000;
  let pid = findInstalledAppPid();
  while (!pid && Date.now() < spawnDeadline) {
    sleepSync(0.5);
    pid = findInstalledAppPid();
  }
  if (!pid) {
    reportRecentCrashLogs();
    throw new Error(`Installed app did not come up via 'open' within 20s: ${installedApp}`);
  }
  console.log(`[open-verify] app process is alive (pid=${pid}); confirming it stays up`);
  sleepSync(3);
  if (!findInstalledAppPid()) {
    reportRecentCrashLogs();
    throw new Error('Installed app process exited within 3s of launching — treating as launch crash');
  }
  console.log('[open-verify] quitting the verified instance');
  runOptional('osascript', [
    '-e',
    'tell application id "com.manju2026.manying-studio" to quit',
  ]);
  const quitDeadline = Date.now() + 10_000;
  while (findInstalledAppPid() && Date.now() < quitDeadline) {
    sleepSync(0.5);
  }
  runOptional('pkill', ['-f', '漫影工作室.app/Contents']);
}

if (!existsSync(packagedAsar)) {
  throw new Error(`Packaged app.asar not found: ${packagedAsar}`);
}

inspectPackagedRemotionApp(packagedApp);

assertNoBackupApps();
stopInstalledAppIfRunning();
installPackagedApp();
assertNoBackupApps();

verifyInstalledIntegrity();

inspectPackagedRemotionApp(installedApp);

console.log(`Running installed smoke: ${smokeCommandLabel}`);
run('npm', ['run', 'smoke:desktop'], {
  env: {
    MYSTUDIO_SMOKE_APP_BIN: installedBin,
    MYSTUDIO_SMOKE_USER_DATA_DIR: userDataDir,
    MYSTUDIO_SMOKE_DEBUG_PORT: debugPort,
  },
});

// "Must be able to open" is part of the contract. If the app cannot open,
// remediate once by stopping instances and cleanly reinstalling the staged
// artifact (covers a stomped or partial install, e.g. a concurrent session
// replacing the bundle mid-chain). If it still cannot open, fail closed so
// the caller can trigger a full re-package.
try {
  verifyRealOpen();
} catch (error) {
  console.log(`[open-verify] first attempt failed: ${error.message}`);
  console.log('[open-verify] remediation: stop instances and cleanly reinstall the staged artifact');
  stopInstalledAppIfRunning();
  installPackagedApp();
  assertNoBackupApps();
  verifyInstalledIntegrity();
  verifyRealOpen();
  console.log('[open-verify] recovered after clean reinstall');
}

console.log('Installed app verified: smoke passed and app opens via Launch Services');

// 冒烟空壳根治收尾:open-verify 已退出其拉起的实例,清掉自建隔离 profile。
// (verifyRealOpen 用 Launch Services 起的是真实 userData 的普通实例,与此目录无关)
if (ownsUserDataDir && process.env.MYSTUDIO_SMOKE_KEEP_USER_DATA !== '1') {
  try {
    rmSync(userDataDir, { recursive: true, force: true });
    console.log(`[install-smoke] cleaned isolated userData: ${userDataDir}`);
  } catch (error) {
    console.warn(`[install-smoke] isolated userData 清理失败(可忽略,tmp 自清): ${error}`);
  }
}
