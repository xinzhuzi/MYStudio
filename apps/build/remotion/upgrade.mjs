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
const REMOTION_SKILL_NAME = "remotion-best-practices";
const REMOTION_SKILLS_ADD_ARGS = [
  "-y",
  "--loglevel=error",
  "skills@1.2.0",
  "add",
  "remotion-dev/skills",
  "--skill",
  REMOTION_SKILL_NAME,
  "--agent",
  "codex",
  "-y",
];
const REMOTION_SKILLS_ADD_COMMAND = `npx ${REMOTION_SKILLS_ADD_ARGS.join(" ")}`;

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
  const upgradeScript = path.join(appRoot, "build", "remotion", "upgrade.mjs");
  return [
    {
      command: remotionBin,
      args: [
        "upgrade",
        `--version=${targetVersion}`,
        "--package-manager=npm",
        "--save-exact",
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
    { command: "npx", args: REMOTION_SKILLS_ADD_ARGS, cwd: repositoryRoot },
    {
      command: "node",
      args: [upgradeScript, "--verify-remotion-skills"],
      cwd: appRoot,
    },
    { command: "npm", args: ["run", "remotion:bundle"], cwd: appRoot },
    { command: "npm", args: ["run", "typecheck"], cwd: appRoot },
    { command: "npm", args: ["run", "lint"], cwd: appRoot },
    { command: "npm", args: ["test"], cwd: appRoot },
  ];
}

export function verifyProjectRemotionSkills({
  repositoryRoot = resolveRepositoryRootFromCwd(),
} = {}) {
  const skillRoot = path.join(repositoryRoot, ".agents", "skills", REMOTION_SKILL_NAME);
  const skillPath = path.join(skillRoot, "SKILL.md");
  const upgradeReferencePath = path.join(skillRoot, "remotion-upgrade", "REFERENCE.md");
  const errors = [];

  if (!fs.existsSync(skillPath)) {
    errors.push(`${relativeToRoot(repositoryRoot, skillPath)} 缺失`);
  } else {
    const skillSource = fs.readFileSync(skillPath, "utf8");
    const skillName = readFrontmatterName(skillSource);
    if (skillName !== REMOTION_SKILL_NAME) {
      errors.push(
        `${relativeToRoot(repositoryRoot, skillPath)} frontmatter name 必须是 ${REMOTION_SKILL_NAME}`,
      );
    }
  }

  if (!fs.existsSync(upgradeReferencePath)) {
    errors.push(`${relativeToRoot(repositoryRoot, upgradeReferencePath)} 缺失`);
  } else {
    const upgradeReferenceSource = fs.readFileSync(upgradeReferencePath, "utf8");
    if (!upgradeReferenceSource.includes(REMOTION_SKILLS_ADD_COMMAND)) {
      errors.push(
        `${relativeToRoot(repositoryRoot, upgradeReferencePath)} 必须记录 pinned Remotion Skills 安装命令`,
      );
    }
  }

  return {
    success: errors.length === 0,
    skillPath,
    upgradeReferencePath,
    errors,
  };
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

function readFrontmatterName(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return null;
  const nameLine = match[1]
    .split(/\r?\n/)
    .find((line) => line.startsWith("name:"));
  return nameLine?.slice("name:".length).trim() ?? null;
}

function resolveRepositoryRootFromCwd(cwd = process.cwd()) {
  if (fs.existsSync(path.join(cwd, ".agents"))) return cwd;
  return path.resolve(cwd, "..");
}

function relativeToRoot(root, filePath) {
  return path.relative(root, filePath) || ".";
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
    if (args.includes("--verify-remotion-skills")) {
      const result = verifyProjectRemotionSkills();
      if (!result.success) {
        throw new Error(`Remotion Skills 校验失败:\n- ${result.errors.join("\n- ")}`);
      }
      console.log(`Remotion Skills 已安装: ${REMOTION_SKILL_NAME}`);
    } else {
      const result = runUpgrade({ targetVersion, dryRun });
      if (dryRun) {
        console.log(JSON.stringify(result, null, 2));
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
