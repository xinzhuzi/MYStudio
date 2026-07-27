import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const REQUIRED_FILES = ["manifest.json", "index.html", "bundle.js", "bundle.js.map"];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

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

export function verifyFixedRemotionBundle({ appRoot = process.cwd() } = {}) {
  const bundleDir = path.join(appRoot, ".cache", "remotion-bundle");
  const manifestPath = path.join(bundleDir, "manifest.json");
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
    if (manifest.schemaVersion !== 1) errors.push("bundle manifest schemaVersion 必须为 1");
    if (manifest.remotionVersion !== expectedVersion) errors.push(`bundle Remotion 版本漂移: ${manifest.remotionVersion ?? "missing"} != ${expectedVersion}`);
    if (manifest.compositionId !== "DaojieTimeline") errors.push(`bundle compositionId 必须为 DaojieTimeline: ${manifest.compositionId ?? "missing"}`);
    if (!/^[a-f0-9]{64}$/.test(manifest.contentHash ?? "")) errors.push("bundle manifest contentHash 无效");
    else if (fs.existsSync(bundleDir) && hashBundleContent(bundleDir) !== manifest.contentHash) errors.push("bundle contentHash 与固定目录内容不一致");
  }
  for (const file of REQUIRED_FILES) if (!fs.existsSync(path.join(bundleDir, file))) errors.push(`bundle 缺少文件: ${file}`);
  if (errors.length) {
    const message = `${errors.join("; ")}。请先运行 npm run remotion:bundle；如版本漂移再运行 npm run remotion:versions。`;
    throw new Error(message);
  }
  return { bundleDir, manifest };
}

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(file) : [file];
  });
}
