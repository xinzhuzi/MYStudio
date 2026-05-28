import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');
const releaseDir = resolve(projectRoot, 'release');
const defaultBuildOutputDir = resolve(releaseDir, 'build');
const electronViteOutDir = resolve(releaseDir, '.electron-vite');
const legacyElectronViteOutDirs = [
  resolve(projectRoot, 'out'),
  resolve(projectRoot, 'dist-electron'),
];
const cacheRoot = resolve(releaseDir, '.cache');
const legacyBuildCacheDirs = [
  resolve(projectRoot, '.cache', 'electron'),
  resolve(projectRoot, '.cache', 'electron-builder'),
];
const tempDir = resolve(cacheRoot, 'tmp');
const electronCacheDir = resolve(cacheRoot, 'electron');
const electronBuilderCacheDir = resolve(cacheRoot, 'electron-builder');
const desktopBuilderConfigPath = resolve(projectRoot, 'src', 'config', 'electron-builder.yml');
const brandDir = resolve(projectRoot, 'src', 'assets', 'brand');
const cliArgs = process.argv.slice(2);
const supportedTargets = ['mac', 'win', 'linux'];
const supportedArchs = ['x64', 'arm64', 'universal', 'ia32', 'armv7l'];
const requestedTarget = cliArgs
  .find((arg) => supportedTargets.includes(arg.replace(/^--/, '')))
  ?.replace(/^--/, '');
const requestedArchs = cliArgs
  .filter((arg) => supportedArchs.includes(arg.replace(/^--/, '')))
  .map((arg) => arg.replace(/^--/, ''));
const platformToTarget = {
  darwin: 'mac',
  win32: 'win',
  linux: 'linux',
};
const buildTarget = requestedTarget || platformToTarget[process.platform];
const buildStamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
const logoPath = resolve(brandDir, 'logo.png');
const iconPngPath = resolve(brandDir, 'manying-studio-icon.png');
const iconIcoPath = resolve(brandDir, 'manying-studio-icon.ico');
const iconIcnsPath = resolve(brandDir, 'manying-studio-icon.icns');

if (!supportedTargets.includes(buildTarget || '')) {
  console.error(
    `Unsupported desktop target "${buildTarget ?? process.platform}". Use one of --mac, --win, or --linux.`,
  );
  process.exit(1);
}

for (const directory of [releaseDir, tempDir, electronCacheDir, electronBuilderCacheDir]) {
  mkdirSync(directory, { recursive: true });
}

const env = {
  ...process.env,
  TEMP: tempDir,
  TMP: tempDir,
  ELECTRON_CACHE: electronCacheDir,
  ELECTRON_BUILDER_CACHE: electronBuilderCacheDir,
};

function run(command, args) {
  const result = spawnSync(
    process.platform === 'win32' ? 'cmd.exe' : command,
    process.platform === 'win32' ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args,
    {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function normalizeArch(arch) {
  return arch === 'arm' ? 'armv7l' : arch;
}

function resolveBuilderArgs(arch) {
  const builderArgs = [];

  switch (buildTarget) {
    case 'mac':
      builderArgs.push('--mac');
      break;
    case 'win':
      builderArgs.push('--win');
      break;
    case 'linux':
      builderArgs.push('--linux');
      break;
    default:
      break;
  }

  if (arch) {
    builderArgs.push(`--${arch}`);
  }

  return builderArgs;
}

function resolveBuildArchs() {
  if (requestedArchs.length > 0) {
    return [...new Set(requestedArchs)];
  }

  return [normalizeArch(process.arch)];
}

function resolveFinalBuildOutputDir(arch) {
  return resolve(defaultBuildOutputDir, `${buildTarget}-${arch}`);
}

function resolveStagingBuildOutputDir(arch) {
  return resolve(releaseDir, `build-staging-${buildTarget}-${arch}-${buildStamp}`);
}

function shouldGenerateIcons() {
  if (!existsSync(logoPath)) {
    return false;
  }

  if (!existsSync(iconPngPath) || !existsSync(iconIcoPath)) {
    return true;
  }

  return buildTarget === 'mac' && !existsSync(iconIcnsPath);
}

function tryRemoveDirectory(directory) {
  if (!existsSync(directory)) {
    return true;
  }

  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    return true;
  } catch {
    return false;
  }
}

function finalizeBuildOutput(stagingBuildOutputDir, finalBuildOutputDir) {
  if (!existsSync(stagingBuildOutputDir)) {
    return;
  }

  mkdirSync(defaultBuildOutputDir, { recursive: true });

  if (tryRemoveDirectory(finalBuildOutputDir)) {
    try {
      renameSync(stagingBuildOutputDir, finalBuildOutputDir);
      console.log(`Build artifacts available at ${finalBuildOutputDir}`);
      return;
    } catch {
    }
  }

  console.warn(
    `Build artifacts were created at ${stagingBuildOutputDir} because ${finalBuildOutputDir} is still locked.`,
  );
}

function buildForArch(arch) {
  const stagingBuildOutputDir = resolveStagingBuildOutputDir(arch);
  const finalBuildOutputDir = resolveFinalBuildOutputDir(arch);

  run('npx', [
    'electron-builder',
    ...resolveBuilderArgs(arch),
    '--config',
    desktopBuilderConfigPath,
    `-c.directories.output=${stagingBuildOutputDir}`,
  ]);
  finalizeBuildOutput(stagingBuildOutputDir, finalBuildOutputDir);
}

function cleanDirectory(directory, label) {
  if (!existsSync(directory)) return;

  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    console.log(`Cleaned ${label} at ${directory}`);
  } catch (error) {
    console.warn(
      `Could not clean ${label} at ${directory}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function cleanIntermediateOutput() {
  cleanDirectory(electronViteOutDir, 'Electron Vite intermediate build output');

  for (const directory of legacyElectronViteOutDirs) {
    cleanDirectory(directory, 'legacy Electron Vite root output');
  }

  for (const directory of legacyBuildCacheDirs) {
    cleanDirectory(directory, 'legacy Electron build cache root output');
  }
}

if (shouldGenerateIcons()) {
  run('node', [resolve(projectRoot, 'src', 'scripts', 'generate-icon.mjs')]);
}

const buildArchs = resolveBuildArchs();

cleanIntermediateOutput();

run('npx', ['electron-vite', 'build', '--config', resolve(projectRoot, 'src', 'config', 'electron-vite.config.ts')]);

for (const arch of buildArchs) {
  buildForArch(arch);
}

cleanIntermediateOutput();
