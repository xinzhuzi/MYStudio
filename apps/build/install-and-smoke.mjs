import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const packagedApp = resolve(process.cwd(), 'release', 'build', 'mac-arm64', 'mac-arm64', '漫影工作室.app');
const installedApp = '/Applications/漫影工作室.app';
const packagedAsar = resolve(packagedApp, 'Contents', 'Resources', 'app.asar');
const installedAsar = resolve(installedApp, 'Contents', 'Resources', 'app.asar');
const installedBin = resolve(installedApp, 'Contents', 'MacOS', '漫影工作室');
const userDataDir =
  process.env.MYSTUDIO_SMOKE_USER_DATA_DIR || mkdtempSync(resolve(tmpdir(), 'mystudio-installed-smoke-'));
const debugPort = process.env.MYSTUDIO_SMOKE_DEBUG_PORT || '9363';
const smokeCommandLabel = 'npm run smoke:desktop';

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

function stopInstalledAppIfRunning() {
  runOptional('osascript', [
    '-e',
    'tell application id "com.manju2026.manying-studio" to quit',
  ]);
  runOptional('pkill', ['-x', '漫影工作室']);
}

function assertNoBackupApps() {
  const backups = readdirSync('/Applications')
    .filter((name) => /^漫影工作室\.app\.(?:backup-|backup$)/.test(name));
  if (backups.length > 0) {
    throw new Error(`Found forbidden backup app copies in /Applications: ${backups.join(', ')}`);
  }
}

if (!existsSync(packagedAsar)) {
  throw new Error(`Packaged app.asar not found: ${packagedAsar}`);
}

assertNoBackupApps();
stopInstalledAppIfRunning();
run('ditto', [packagedApp, installedApp]);
assertNoBackupApps();

if (!existsSync(installedAsar) || !existsSync(installedBin)) {
  throw new Error(`Installed app is incomplete: ${installedApp}`);
}

const packagedHash = sha256(packagedAsar);
const installedHash = sha256(installedAsar);
if (packagedHash !== installedHash) {
  throw new Error(`Installed app.asar hash mismatch: packaged=${packagedHash}, installed=${installedHash}`);
}

console.log(`Installed app.asar hash verified: ${installedHash}`);
console.log(`Running installed smoke: ${smokeCommandLabel}`);
run('npm', ['run', 'smoke:desktop'], {
  env: {
    MYSTUDIO_SMOKE_APP_BIN: installedBin,
    MYSTUDIO_SMOKE_USER_DATA_DIR: userDataDir,
    MYSTUDIO_SMOKE_DEBUG_PORT: debugPort,
  },
});
