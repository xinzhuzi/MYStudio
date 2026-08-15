import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const REQUIRED_FILES = ["manifest.json", "index.html", "bundle.js", "bundle.js.map"];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const EXPECTED_COMPOSITION_IDS = ["StoryboardShot", "ChapterVideo", "DaojieTimeline"] // DaojieTimeline = legacy wire key, see composition-id.ts;

export function hashBundleContent(directory) {
  const files = collectFiles(directory)
    .filter((file) => path.basename(file) !== "manifest.json")
    .map((file) => ({
      path: path.relative(directory, file).split(path.sep).join("/"),
      bytes: fs.readFileSync(file).toString("base64"),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

export function checkRemotionBundleErrors(appRoot, bundleDir, manifestPath) {
  const errors = [];
  if (!fs.existsSync(bundleDir)) errors.push(`缺少固定 Remotion bundle: ${bundleDir}`);
  if (!fs.existsSync(manifestPath)) errors.push("缺少 bundle manifest.json");
  let manifest;
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
    catch { errors.push("bundle manifest.json 不是有效 JSON"); }
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  const expectedVersion = packageJson.dependencies?.remotion;
  if (!SEMVER.test(expectedVersion ?? "")) errors.push("package.json 的 remotion 必须是精确 semver");
  if (manifest) {
    if (manifest.schemaVersion !== 2) errors.push("bundle manifest schemaVersion 必须为 2");
    if (manifest.templateId !== "mystudio-remotion-v1") errors.push("bundle templateId 必须为 mystudio-remotion-v1");
    if (manifest.templateVersion !== "1.0.0") errors.push("bundle templateVersion 必须为 1.0.0");
    if (manifest.remotionVersion !== expectedVersion) errors.push(`bundle Remotion 版本漂移: ${manifest.remotionVersion ?? "missing"} != ${expectedVersion}`);
    if (!sameOrderedStrings(manifest.compositionIds, EXPECTED_COMPOSITION_IDS)) {
      errors.push(`bundle compositionIds 必须为 ${EXPECTED_COMPOSITION_IDS.join(", ")}`);
    }
    if (manifest.compositionId !== "DaojieTimeline") errors.push(`bundle compositionId 必须为 DaojieTimeline: ${manifest.compositionId ?? "missing"}`);
    if (!/^[a-f0-9]{64}$/.test(manifest.contentHash ?? "")) errors.push("bundle manifest contentHash 无效");
    else if (fs.existsSync(bundleDir) && hashBundleContent(bundleDir) !== manifest.contentHash) errors.push("bundle contentHash 与固定目录内容不一致");
  }
  for (const file of REQUIRED_FILES) if (!fs.existsSync(path.join(bundleDir, file))) errors.push(`bundle 缺少文件: ${file}`);
  return { errors, manifest };
}

export function verifyFixedRemotionBundle({ appRoot = process.cwd(), autoGenerate = true } = {}) {
  const bundleDir = path.join(appRoot, ".cache", "remotion-bundle");
  const manifestPath = path.join(bundleDir, "manifest.json");

  let { errors, manifest } = checkRemotionBundleErrors(appRoot, bundleDir, manifestPath);

  if (errors.length && autoGenerate) {
    const bundleScriptPath = path.join(appRoot, "build", "remotion", "bundle.mjs");
    if (fs.existsSync(bundleScriptPath)) {
      console.log(`[remotion-preflight] 发现 Remotion bundle 缺失或需要更新 (${errors.join("; ")})。正在自动执行打包脚本生成...`);
      const result = spawnSync("node", [bundleScriptPath], {
        cwd: appRoot,
        stdio: "inherit",
        env: process.env,
      });
      if (result.status === 0) {
        const recheck = checkRemotionBundleErrors(appRoot, bundleDir, manifestPath);
        errors = recheck.errors;
        manifest = recheck.manifest;
        if (!errors.length) {
          console.log("[remotion-preflight] Remotion bundle 自动生成成功并重新校验通过。");
        }
      }
    }
  }

  if (errors.length) {
    const message = `${errors.join("; ")}。请先运行 npm run remotion:bundle；如版本漂移再运行 npm run remotion:versions。`;
    throw new Error(message);
  }
  return { bundleDir, manifest };
}

function sameOrderedStrings(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(file) : [file];
  });
}
