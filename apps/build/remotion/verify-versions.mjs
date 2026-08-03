import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_REMOTION_PACKAGES = {
  dependencies: [
    "remotion",
    "@remotion/player",
    "@remotion/renderer",
    "@remotion/media",
  ],
  devDependencies: ["@remotion/bundler", "@remotion/cli"],
  optionalDependencies: ["@remotion/compositor-darwin-arm64"],
};

const PLATFORM_OPTIONAL_PACKAGES = {
  "@remotion/compositor-darwin-arm64": { platform: "darwin", arch: "arm64" },
};

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export function verifyRemotionVersions({
  root = process.cwd(),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const manifest = readJson(path.join(root, "package.json"));
  const lock = readJson(path.join(root, "package-lock.json"));
  const errors = [];
  const expectedRemotionVersion = manifest.dependencies?.remotion;
  const expectedMediabunnyVersion = manifest.dependencies?.mediabunny;

  if (!isExactSemver(expectedRemotionVersion)) {
    errors.push("dependencies.remotion 必须是精确 semver");
  }
  if (!isExactSemver(expectedMediabunnyVersion)) {
    errors.push("dependencies.mediabunny 必须是精确 semver");
  }
  if (lock.packages?.[""]?.dependencies?.mediabunny !== expectedMediabunnyVersion) {
    errors.push(
      `package-lock root dependencies.mediabunny 必须精确等于 ${expectedMediabunnyVersion}`,
    );
  }
  if (lock.packages?.["node_modules/mediabunny"]?.version !== expectedMediabunnyVersion) {
    errors.push(
      `package-lock node_modules/mediabunny 版本漂移: ${lock.packages?.["node_modules/mediabunny"]?.version ?? "missing"}`,
    );
  }

  for (const [section, packageNames] of Object.entries(REQUIRED_REMOTION_PACKAGES)) {
    for (const packageName of packageNames) {
      if (manifest[section]?.[packageName] !== expectedRemotionVersion) {
        errors.push(`${section}.${packageName} 必须精确等于 ${expectedRemotionVersion}`);
      }
      if (lock.packages?.[""]?.[section]?.[packageName] !== expectedRemotionVersion) {
        errors.push(`package-lock root ${section}.${packageName} 必须精确等于 ${expectedRemotionVersion}`);
      }
    }
  }

  for (const section of DEPENDENCY_SECTIONS) {
    for (const [packageName, version] of Object.entries(manifest[section] ?? {})) {
      if (isRemotionPackage(packageName) && version !== expectedRemotionVersion) {
        errors.push(`${section}.${packageName} 版本漂移: ${version}`);
      }
    }
    if (manifest[section]?.["@remotion/transitions"] !== undefined) {
      errors.push(`${section} 禁止安装 @remotion/transitions`);
    }
  }

  for (const [packagePath, packageEntry] of Object.entries(lock.packages ?? {})) {
    if (isLockedRemotionPackage(packagePath)
      && packageEntry.version !== expectedRemotionVersion) {
      errors.push(`${packagePath} 锁定版本漂移: ${packageEntry.version ?? "missing"}`);
    }
  }

  for (const packageNames of Object.values(REQUIRED_REMOTION_PACKAGES)) {
    for (const packageName of packageNames) {
      if (!isInstalledPackageRequired(packageName, { platform, arch })) continue;
      const installed = readInstalledPackage(root, packageName, errors);
      if (installed && installed.version !== expectedRemotionVersion) {
        errors.push(`${packageName} 已安装版本漂移: ${installed.version}`);
      }
    }
  }
  const media = readInstalledPackage(root, "@remotion/media", errors);
  if (media?.dependencies?.mediabunny !== expectedMediabunnyVersion) {
    errors.push(
      `@remotion/media 需要 mediabunny ${media?.dependencies?.mediabunny ?? "missing"}，`
      + `当前 manifest 是 ${expectedMediabunnyVersion ?? "missing"}`,
    );
  }
  const installedMediabunny = readInstalledPackage(root, "mediabunny", errors);
  if (installedMediabunny?.version !== expectedMediabunnyVersion) {
    errors.push(`mediabunny 已安装版本漂移: ${installedMediabunny?.version ?? "missing"}`);
  }
  if (fs.existsSync(path.join(root, "node_modules", "@remotion", "transitions", "package.json"))) {
    errors.push("node_modules 禁止存在 @remotion/transitions");
  }

  return {
    success: errors.length === 0,
    expectedRemotionVersion,
    expectedMediabunnyVersion,
    errors,
  };
}

function readInstalledPackage(root, packageName, errors) {
  const packagePath = path.join(root, "node_modules", packageName, "package.json");
  if (!fs.existsSync(packagePath)) {
    errors.push(`缺少已安装包: ${packageName}`);
    return null;
  }
  return readJson(packagePath);
}

function isInstalledPackageRequired(packageName, { platform, arch }) {
  const requirement = PLATFORM_OPTIONAL_PACKAGES[packageName];
  return !requirement || (requirement.platform === platform && requirement.arch === arch);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isExactSemver(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function isRemotionPackage(packageName) {
  return packageName === "remotion" || packageName.startsWith("@remotion/");
}

function isLockedRemotionPackage(packagePath) {
  return /(?:^|\/)node_modules\/(?:remotion|@remotion\/[^/]+)$/.test(packagePath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = verifyRemotionVersions();
  if (!result.success) {
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log(
      `Remotion ${result.expectedRemotionVersion} / Mediabunny ${result.expectedMediabunnyVersion} 版本一致`,
    );
  }
}
