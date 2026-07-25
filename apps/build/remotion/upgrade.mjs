import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export function validateUpgradeTarget(currentVersion, targetVersion) {
  if (!isExactSemver(targetVersion)) {
    throw new Error("Remotion 升级目标必须是精确 semver，例如 4.0.500");
  }
  if (!isExactSemver(currentVersion)) {
    throw new Error("package.json 中的 Remotion 版本不是精确 semver");
  }
  const currentMajor = Number(currentVersion.split(".")[0]);
  const targetMajor = Number(targetVersion.split(".")[0]);
  if (currentMajor !== 4 || targetMajor !== currentMajor) {
    throw new Error(
      `拒绝跨大版本升级 ${currentVersion} -> ${targetVersion}；请新建 Trellis 迁移任务`,
    );
  }
}

export function restoreUnmanagedDependencySpecs(before, after) {
  const restored = structuredClone(after);
  for (const section of DEPENDENCY_SECTIONS) {
    const beforeSection = before[section] ?? {};
    const afterSection = restored[section] ?? {};
    for (const packageName of new Set([
      ...Object.keys(beforeSection),
      ...Object.keys(afterSection),
    ])) {
      if (isUpgradeManagedPackage(packageName)) continue;
      if (beforeSection[packageName] === undefined) delete afterSection[packageName];
      else afterSection[packageName] = beforeSection[packageName];
    }
    if (Object.keys(afterSection).length > 0 || restored[section] !== undefined) {
      restored[section] = afterSection;
    }
  }
  return restored;
}

export function buildUpgradePlan({ appRoot, targetVersion }) {
  const repositoryRoot = path.resolve(appRoot, "..");
  const remotionBin = path.join(appRoot, "node_modules", ".bin", "remotion");
  return [
    {
      command: remotionBin,
      args: [
        "upgrade",
        `--version=${targetVersion}`,
        "--package-manager=npm",
        "--no-fund",
        "--no-audit",
        "--registry=https://registry.npmjs.org/",
      ],
      cwd: appRoot,
    },
    {
      command: "npm",
      args: [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-fund",
        "--no-audit",
        "--registry=https://registry.npmjs.org/",
      ],
      cwd: appRoot,
    },
    { command: "npm", args: ["run", "remotion:versions"], cwd: appRoot },
    { command: remotionBin, args: ["skills", "update"], cwd: repositoryRoot },
    { command: "npm", args: ["run", "remotion:bundle"], cwd: appRoot },
    { command: "npm", args: ["run", "typecheck"], cwd: appRoot },
    { command: "npm", args: ["run", "lint"], cwd: appRoot },
    { command: "npm", args: ["test"], cwd: appRoot },
  ];
}

export function runUpgrade({
  appRoot = process.cwd(),
  targetVersion,
  dryRun = false,
} = {}) {
  const manifestPath = path.join(appRoot, "package.json");
  const before = readJson(manifestPath);
  const currentVersion = before.dependencies?.remotion;
  validateUpgradeTarget(currentVersion, targetVersion);
  if (!before.scripts?.["remotion:bundle"]) {
    throw new Error("remotion:bundle 尚未接线；固定 bundle 完成前拒绝实际升级");
  }
  const plan = buildUpgradePlan({ appRoot, targetVersion });
  if (dryRun) return { currentVersion, targetVersion, plan };

  runCommand(plan[0]);
  const afterCli = readJson(manifestPath);
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(restoreUnmanagedDependencySpecs(before, afterCli), null, 2)}\n`,
    "utf8",
  );
  plan.slice(1).forEach(runCommand);
  return { currentVersion, targetVersion, plan };
}

function runCommand(step) {
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${step.command} ${step.args.join(" ")} 失败，退出码 ${result.status}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isExactSemver(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function isUpgradeManagedPackage(packageName) {
  return packageName === "remotion"
    || packageName.startsWith("@remotion/")
    || packageName === "mediabunny"
    || packageName.startsWith("@mediabunny/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const targetVersion = args.find((arg) => !arg.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  try {
    const result = runUpgrade({ targetVersion, dryRun });
    if (dryRun) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
