import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundle as remotionBundle } from "@remotion/bundler";
import { sha256 } from "../shared/paid-image-request-ledger.mjs";

export const BUNDLE_MANIFEST_SCHEMA_VERSION = 2;
export const REMOTION_TEMPLATE_ID = "mystudio-remotion-v1";
export const REMOTION_TEMPLATE_VERSION = "1.0.0";

// The composition entry and manifest are deliberately fixed. Export paths only
// consume this output; they never invoke the bundler per render job.
export const FIXED_COMPOSITION_ENTRY = "frontend/electron/rendering/plugins/remotion/composition/entry.tsx";
export const FIXED_COMPOSITION_ID = "DaojieTimeline";
export const BUNDLED_COMPOSITION_IDS = ["StoryboardShot", "ChapterVideo", FIXED_COMPOSITION_ID];
export const BUNDLE_OUTPUT_DIR = ".cache/remotion-bundle";

export function bundleManifestSchema() {
  return {
    schemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
    fields: [
      "schemaVersion",
      "templateId",
      "templateVersion",
      "remotionVersion",
      "compositionIds",
      "compositionId",
      "contentHash",
    ],
  };
}

export function buildBundleManifest({ remotionVersion, contentHash }) {
  if (!isExactSemver(remotionVersion)) {
    throw new Error("bundle manifest 需要精确 Remotion semver");
  }
  if (!/^[a-f0-9]{64}$/.test(String(contentHash))) {
    throw new Error("bundle manifest 需要 sha256 contentHash");
  }
  return {
    schemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
    templateId: REMOTION_TEMPLATE_ID,
    templateVersion: REMOTION_TEMPLATE_VERSION,
    remotionVersion,
    compositionIds: [...BUNDLED_COMPOSITION_IDS],
    compositionId: FIXED_COMPOSITION_ID,
    contentHash,
  };
}

export function hashBundleContent(value) {
  return sha256(typeof value === "string" ? value : JSON.stringify(value));
}

export function resolveCompositionEntry({ appRoot = process.cwd() } = {}) {
  return path.join(appRoot, FIXED_COMPOSITION_ENTRY);
}

export function resolveBundleOutput({ appRoot = process.cwd() } = {}) {
  return path.join(appRoot, BUNDLE_OUTPUT_DIR);
}

export async function runBundle({
  appRoot = process.cwd(),
  outDir = resolveBundleOutput({ appRoot }),
  bundleFn = remotionBundle,
} = {}) {
  const entryPath = resolveCompositionEntry({ appRoot });
  if (!fs.existsSync(entryPath)) {
    throw new Error(`固定 composition entry 不存在: ${FIXED_COMPOSITION_ENTRY}`);
  }
  const remotionVersion = readRemotionVersion(appRoot);
  const outputParent = path.dirname(outDir);
  fs.mkdirSync(outputParent, { recursive: true });
  const temporaryDir = fs.mkdtempSync(
    path.join(outputParent, `${path.basename(outDir)}.tmp-`),
  );
  try {
    await bundleFn({
      entryPoint: entryPath,
      outDir: temporaryDir,
      enableCaching: true,
      onProgress: () => undefined,
    });
    const contentHash = hashDirectory(temporaryDir);
    const manifest = buildBundleManifest({
      remotionVersion,
      contentHash,
    });
    fs.writeFileSync(
      path.join(temporaryDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    replaceDirectory(temporaryDir, outDir);
    return { outputDir: outDir, manifest };
  } catch (error) {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

function readRemotionVersion(appRoot) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
  );
  const version = packageJson.dependencies?.remotion;
  if (!isExactSemver(version)) {
    throw new Error("package.json 的 remotion 必须是精确 semver");
  }
  return version;
}

function hashDirectory(directory) {
  const files = collectFiles(directory)
    .map((filePath) => path.relative(directory, filePath).split(path.sep).join("/"))
    .sort();
  return hashBundleContent(files.map((relativePath) => ({
    path: relativePath,
    bytes: fs.readFileSync(path.join(directory, relativePath)).toString("base64"),
  })));
}

function collectFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(filePath) : [filePath];
  });
}

function replaceDirectory(temporaryDir, outputDir) {
  if (fs.existsSync(outputDir)) {
    const previousDir = `${outputDir}.previous-${Date.now()}-${process.pid}`;
    fs.renameSync(outputDir, previousDir);
  }
  fs.renameSync(temporaryDir, outputDir);
}

function isExactSemver(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBundle()
    .then(({ outputDir, manifest }) => {
      console.log(`Remotion bundle 已生成: ${outputDir} (${manifest.contentHash})`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
