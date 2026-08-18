import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_REMOTION_PACKAGES = {
  dependencies: [
    "remotion",
    "@remotion/player",
    "@remotion/renderer",
    "@remotion/media",
    "@remotion/three",
    "@remotion/motion-blur",
    "@remotion/noise",
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
  const errors = [];
  const expectedRemotionVersion = manifest.dependencies?.remotion;
  const expectedMediabunnyVersion = manifest.dependencies?.mediabunny;
  const lockText = readLockfileText(root, errors);

  if (!isExactSemver(expectedRemotionVersion)) {
    errors.push("dependencies.remotion 必须是精确 semver");
  }
  if (!isExactSemver(expectedMediabunnyVersion)) {
    errors.push("dependencies.mediabunny 必须是精确 semver");
  }

  for (const [section, packageNames] of Object.entries(REQUIRED_REMOTION_PACKAGES)) {
    for (const packageName of packageNames) {
      if (manifest[section]?.[packageName] !== expectedRemotionVersion) {
        errors.push(`${section}.${packageName} 必须精确等于 ${expectedRemotionVersion}`);
      }
    }
  }

  // pnpm-lock.yaml 文本断言(零 yaml 依赖):锁与 manifest 的同步本身由
  // install --frozen-lockfile 强制,这里只拦「锁定版本不一致」与禁止项。
  if (lockText !== null) {
    for (const specifier of uniqueMatches(lockText, /^\s+mediabunny:\s*(\S+)$/gm)) {
      // 精确 semver 的说明符(根依赖)必须全等;^/~ range 是传递依赖的合法声明,
      // 其最终解析版本由下方 mediabunny@x 锁定键校验兜底。
      if (isExactSemver(specifier) && specifier !== expectedMediabunnyVersion) {
        errors.push(`pnpm-lock mediabunny 说明符必须精确等于 ${expectedMediabunnyVersion}: ${specifier}`);
      }
    }
    for (const [packageName, version] of lockedPackageEntries(lockText)) {
      if (packageName === "@remotion/transitions") {
        errors.push("pnpm-lock 禁止锁定 @remotion/transitions");
        continue;
      }
      const expected = packageName === "mediabunny" ? expectedMediabunnyVersion : expectedRemotionVersion;
      if (packageName === "mediabunny" || isRemotionPackage(packageName)) {
        if (version !== expected) {
          errors.push(`pnpm-lock ${packageName}@${version} 锁定版本漂移(期望 ${expected})`);
        }
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

function readLockfileText(root, errors) {
  try {
    return fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  } catch {
    errors.push("缺少 pnpm-lock.yaml");
    return null;
  }
}

function uniqueMatches(text, pattern) {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))];
}

/** packages 段的锁定键:remotion@4.0.499 / '@remotion/media@4.0.499'(peer 变体取 @ 前版本)。 */
function lockedPackageEntries(text) {
  const entries = [];
  for (const match of text.matchAll(/^\s{2}'?((?:@remotion\/[a-z0-9-]+|remotion|mediabunny))@(\d[^:\s'(]*)/gm)) {
    entries.push([match[1], match[2]]);
  }
  return entries;
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
