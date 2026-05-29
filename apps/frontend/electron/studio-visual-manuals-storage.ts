import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  STUDIO_VISUAL_MANUAL_MODULES,
  type StudioVisualManualCategory,
  type StudioVisualManualCreatePayload,
  type StudioVisualManualDetail,
  type StudioVisualManualImage,
  type StudioVisualManualImagesWritePayload,
  type StudioVisualManualModule,
  type StudioVisualManualSummary,
  type StudioVisualManualWritePayload,
} from "../types/studio-visual-manual";
import { ensureStudioSkillsSynced, markStoredStudioSkillPathDeleted } from "./studio-skills-storage";

type VisualManualStorageOptions = {
  sourceRoot: string;
  fallbackSourceRoots?: string[];
  storageRoot: string;
  makeFileUrl: (relativePath: string) => string;
};

const imageFilePattern = /\.(png|jpe?g|gif|webp|svg)$/i;

export async function listStoredVisualManuals(options: VisualManualStorageOptions): Promise<StudioVisualManualSummary[]> {
  await ensureStudioSkillsSynced(options);
  const artRoot = path.join(options.storageRoot, "art_skills");
  if (!fs.existsSync(artRoot)) return [];

  const entries = await fs.promises.readdir(artRoot, { withFileTypes: true });
  const manuals = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readStoredVisualManualSummary(options, entry.name)));

  return manuals.sort((left, right) => {
    const categoryDelta = getCategorySortIndex(left.category) - getCategorySortIndex(right.category);
    if (categoryDelta !== 0) return categoryDelta;
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}

export async function readStoredVisualManual(
  options: VisualManualStorageOptions,
  stylePath: string,
): Promise<StudioVisualManualDetail> {
  await ensureStudioSkillsSynced(options);
  const normalizedStylePath = normalizeStylePath(stylePath);
  const summary = await readStoredVisualManualSummary(options, normalizedStylePath);
  return {
    ...summary,
    modules: await readVisualManualModules(options.storageRoot, normalizedStylePath),
  };
}

export async function writeStoredVisualManual(
  storageRoot: string,
  stylePath: string,
  payload: StudioVisualManualWritePayload,
) {
  const normalizedStylePath = normalizeStylePath(stylePath);
  const manualRoot = resolveVisualManualDirectory(storageRoot, normalizedStylePath);
  if (!fs.existsSync(manualRoot)) {
    throw new Error("视觉风格不存在");
  }

  const moduleByValue = new Map(payload.modules.map((module) => [module.value, module.content]));
  if (payload.name.trim()) {
    const existingReadme = moduleByValue.get("README")
      ?? await readOptionalText(path.join(manualRoot, "README.md"));
    moduleByValue.set("README", applyManualName(payload.name.trim(), existingReadme));
  }

  await Promise.all(STUDIO_VISUAL_MANUAL_MODULES.map(async (definition) => {
    if (!moduleByValue.has(definition.value)) return;
    const filePath = resolveVisualManualFile(storageRoot, normalizedStylePath, definition.relativePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, moduleByValue.get(definition.value) ?? "", "utf-8");
  }));

  if (payload.images) {
    await writeVisualManualImages(storageRoot, normalizedStylePath, payload.images);
  }
}

export async function writeStoredVisualManualImages(
  storageRoot: string,
  stylePath: string,
  payload: StudioVisualManualImagesWritePayload,
) {
  const normalizedStylePath = normalizeStylePath(stylePath);
  const manualRoot = resolveVisualManualDirectory(storageRoot, normalizedStylePath);
  if (!fs.existsSync(manualRoot)) {
    throw new Error("视觉风格不存在");
  }

  await writeVisualManualImages(storageRoot, normalizedStylePath, payload.images);
}

export async function createStoredVisualManual(storageRoot: string, payload: StudioVisualManualCreatePayload) {
  const normalizedStylePath = normalizeStylePath(payload.stylePath);
  const manualRoot = resolveVisualManualDirectory(storageRoot, normalizedStylePath);
  if (fs.existsSync(manualRoot)) {
    throw new Error("视觉风格目录已存在");
  }

  await Promise.all(STUDIO_VISUAL_MANUAL_MODULES.map(async (definition) => {
    const filePath = resolveVisualManualFile(storageRoot, normalizedStylePath, definition.relativePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const content = definition.value === "README"
      ? [`# ${payload.name.trim() || normalizedStylePath}`, payload.description?.trim() ?? ""].filter(Boolean).join("\n\n") + "\n"
      : "";
    await fs.promises.writeFile(filePath, content, "utf-8");
  }));

  await fs.promises.mkdir(path.join(manualRoot, "images"), { recursive: true });
  return normalizedStylePath;
}

/** 从已有风格复制创建新风格 */
export async function duplicateStoredVisualManual(
  sourceStorageRoot: string,
  sourceStylePath: string,
  payload: StudioVisualManualCreatePayload,
  targetStorageRoot?: string,
) {
  const normalizedSource = normalizeStylePath(sourceStylePath);
  const normalizedTarget = normalizeStylePath(payload.stylePath);
  const sourceRoot = resolveVisualManualDirectory(sourceStorageRoot, normalizedSource);
  const destRoot = targetStorageRoot || sourceStorageRoot;
  const targetRoot = path.resolve(destRoot, "art_skills", normalizedTarget);

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`源风格目录不存在: ${normalizedSource}`);
  }
  if (fs.existsSync(targetRoot)) {
    throw new Error("目标风格目录已存在");
  }

  // 递归复制整个目录
  await copyDirRecursive(sourceRoot, targetRoot);

  // 覆写 README.md 中的名称
  const readmePath = path.join(targetRoot, "README.md");
  if (fs.existsSync(readmePath)) {
    const content = await fs.promises.readFile(readmePath, "utf-8");
    const newContent = content.replace(/^#\s+.*/m, `# ${payload.name.trim() || normalizedTarget}`);
    await fs.promises.writeFile(readmePath, newContent, "utf-8");
  }

  return normalizedTarget;
}

async function copyDirRecursive(src: string, dest: string) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function readStoredVisualManualSummary(
  options: VisualManualStorageOptions,
  stylePath: string,
): Promise<StudioVisualManualSummary> {
  const normalizedStylePath = normalizeStylePath(stylePath);
  const manualRoot = resolveVisualManualDirectory(options.storageRoot, normalizedStylePath);
  const readme = await readOptionalText(path.join(manualRoot, "README.md"));
  const modules = await readVisualManualModules(options.storageRoot, normalizedStylePath);
  const sourcePath = findVisualManualSourcePath(options, normalizedStylePath);
  const sourceExists = Boolean(sourcePath);
  const moduleCount = modules.filter((module) => module.content.trim()).length;
  const images = await collectVisualManualImages(options.storageRoot, normalizedStylePath, options.makeFileUrl);

  return {
    id: normalizedStylePath,
    stylePath: normalizedStylePath,
    name: getManualName(readme, normalizedStylePath),
    description: getManualDescription(readme),
    category: getManualCategory(normalizedStylePath),
    storagePath: manualRoot,
    sourcePath: sourcePath,
    sourceExists,
    isCustomized: sourceExists ? await hasCustomizedManualFiles(options, normalizedStylePath) : true,
    moduleCount,
    imageCount: images.length,
    images,
  };
}

async function readVisualManualModules(storageRoot: string, stylePath: string): Promise<StudioVisualManualModule[]> {
  return Promise.all(STUDIO_VISUAL_MANUAL_MODULES.map(async (definition) => ({
    ...definition,
    content: await readOptionalText(resolveVisualManualFile(storageRoot, stylePath, definition.relativePath)),
  })));
}

async function collectVisualManualImages(
  storageRoot: string,
  stylePath: string,
  makeFileUrl: (relativePath: string) => string,
): Promise<StudioVisualManualImage[]> {
  const imagesRoot = resolveVisualManualDirectory(storageRoot, path.posix.join(stylePath, "images"));
  if (!fs.existsSync(imagesRoot)) return [];

  const entries = await fs.promises.readdir(imagesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && imageFilePattern.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"))
    .map((entry) => {
      const relativePath = path.posix.join("art_skills", stylePath, "images", entry.name);
      const filePath = path.join(imagesRoot, entry.name);
      return {
        name: entry.name,
        relativePath,
        filePath,
        url: makeFileUrl(relativePath),
      };
    });
}

async function writeVisualManualImages(
  storageRoot: string,
  stylePath: string,
  images: NonNullable<StudioVisualManualWritePayload["images"]>,
) {
  const manualRoot = resolveVisualManualDirectory(storageRoot, stylePath);
  const imagesRoot = path.join(manualRoot, "images");
  await fs.promises.mkdir(imagesRoot, { recursive: true });

  const retainedNames = new Set<string>();
  for (const image of images) {
    if (image.relativePath) {
      const existingName = getRetainedImageName(stylePath, image.relativePath);
      if (existingName) retainedNames.add(existingName);
      continue;
    }

    if (!image.dataUrl) continue;
    const imageBuffer = parseDataUrlImage(image.dataUrl);
    const targetName = makeUniqueImageFilename(imagesRoot, image.name, imageBuffer.extension);
    await fs.promises.writeFile(path.join(imagesRoot, targetName), imageBuffer.buffer);
    retainedNames.add(targetName);
  }

  const entries = await fs.promises.readdir(imagesRoot, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !imageFilePattern.test(entry.name)) return;
    if (retainedNames.has(entry.name)) return;
    const relativePath = path.posix.join("art_skills", stylePath, "images", entry.name);
    await markStoredStudioSkillPathDeleted(storageRoot, relativePath);
    await fs.promises.unlink(path.join(imagesRoot, entry.name));
  }));
}

function getRetainedImageName(stylePath: string, relativePath: string) {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/").replace(/^\/+/, ""));
  const expectedPrefix = path.posix.join("art_skills", stylePath, "images") + "/";
  if (!normalized.startsWith(expectedPrefix)) return null;
  const filename = path.posix.basename(normalized);
  if (!filename || filename.includes("/") || !imageFilePattern.test(filename)) return null;
  return filename;
}

function parseDataUrlImage(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|gif|webp|svg\+xml));base64,([\s\S]+)$/i);
  if (!match) {
    throw new Error("无效的参考图数据");
  }

  const mimeType = match[1].toLowerCase();
  const extension = mimeType.includes("png")
    ? ".png"
    : mimeType.includes("webp")
      ? ".webp"
      : mimeType.includes("gif")
        ? ".gif"
        : mimeType.includes("svg")
          ? ".svg"
          : ".jpg";
  return {
    buffer: Buffer.from(match[2], "base64"),
    extension,
  };
}

function makeUniqueImageFilename(imagesRoot: string, originalName: string | undefined, extension: string) {
  const parsed = path.parse(originalName ?? "");
  const safeName = parsed.name
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const baseName = safeName || "style-ref";
  let filename = `${baseName}-${crypto.randomUUID()}${extension}`;
  while (fs.existsSync(path.join(imagesRoot, filename))) {
    filename = `${baseName}-${crypto.randomUUID()}${extension}`;
  }
  return filename;
}

async function hasCustomizedManualFiles(options: VisualManualStorageOptions, stylePath: string) {
  for (const definition of STUDIO_VISUAL_MANUAL_MODULES) {
    const storedPath = resolveVisualManualFile(options.storageRoot, stylePath, definition.relativePath);
    const sourcePath = findVisualManualSourceFilePath(options, stylePath, definition.relativePath);
    const storedExists = fs.existsSync(storedPath);
    if (!storedExists && !sourcePath) continue;
    if (!storedExists || !sourcePath) return true;
    if (await hashFile(storedPath) !== await hashFile(sourcePath)) return true;
  }
  if (await hasCustomizedManualImages(options, stylePath)) return true;
  return false;
}

async function hasCustomizedManualImages(options: VisualManualStorageOptions, stylePath: string) {
  const sourceImagesRoot = findVisualManualSourceDirectory(options, path.posix.join(stylePath, "images"));
  const storedImagesRoot = resolveVisualManualDirectory(options.storageRoot, path.posix.join(stylePath, "images"));
  const sourceImages = sourceImagesRoot ? await collectImageHashes(sourceImagesRoot) : new Map<string, string>();
  const storedImages = await collectImageHashes(storedImagesRoot);
  if (sourceImages.size !== storedImages.size) return true;
  for (const [filename, hash] of sourceImages) {
    if (storedImages.get(filename) !== hash) return true;
  }
  return false;
}

async function collectImageHashes(imagesRoot: string) {
  const result = new Map<string, string>();
  if (!fs.existsSync(imagesRoot)) return result;
  const entries = await fs.promises.readdir(imagesRoot, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !imageFilePattern.test(entry.name)) return;
    result.set(entry.name, await hashFile(path.join(imagesRoot, entry.name)));
  }));
  return result;
}

async function readOptionalText(filePath: string) {
  try {
    return await fs.promises.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

function applyManualName(name: string, readme: string) {
  const lines = readme.replace(/\r\n/g, "\n").split("\n");
  const firstLineIndex = lines.findIndex((line) => line.trim());
  if (firstLineIndex < 0) return `${name}\n`;
  const prefix = lines[firstLineIndex].match(/^(\s*#+\s*)/)?.[1] ?? "";
  lines[firstLineIndex] = `${prefix}${name}`;
  return lines.join("\n");
}

function getManualName(readme: string, fallback: string) {
  const firstLine = readme.split(/\r?\n/).find((line) => line.trim());
  return cleanManualText(firstLine ?? fallback) || fallback;
}

function getManualDescription(readme: string) {
  const lines = readme
    .split(/\r?\n/)
    .map((line) => cleanManualText(line))
    .filter(Boolean);
  return lines.find((line, index) => index > 0 && !line.startsWith("#"))?.slice(0, 180);
}

function cleanManualText(value: string) {
  return value
    .replace(/^#+\s*/, "")
    .replace(/--/g, "")
    .trim();
}

function getManualCategory(stylePath: string): StudioVisualManualCategory {
  const lower = stylePath.toLowerCase();
  if (lower.includes("daojie")) return "daojie";
  if (lower.startsWith("2d") || lower.includes("_2d")) return "2d";
  if (lower.startsWith("3d") || lower.includes("_3d")) return "3d";
  if (lower.includes("realpeople") || lower.includes("real")) return "real";
  if (lower.includes("stop_motion") || lower.includes("stopmotion")) return "stop_motion";
  return "other";
}

function getCategorySortIndex(category: StudioVisualManualCategory) {
  return {
    daojie: 0,
    "2d": 1,
    "3d": 2,
    real: 3,
    stop_motion: 4,
    other: 5,
  }[category];
}

function getSourceRoots(options: VisualManualStorageOptions) {
  return [options.sourceRoot, ...(options.fallbackSourceRoots ?? [])]
    .map((root) => path.resolve(root))
    .filter((root) => fs.existsSync(root));
}

function findVisualManualSourcePath(options: VisualManualStorageOptions, stylePath: string) {
  return findVisualManualSourceDirectory(options, stylePath);
}

function findVisualManualSourceDirectory(options: VisualManualStorageOptions, relativePath: string) {
  for (const root of getSourceRoots(options)) {
    const sourcePath = path.resolve(root, "art_skills", relativePath);
    assertInsideRoot(path.join(root, "art_skills"), sourcePath);
    if (fs.existsSync(sourcePath)) return sourcePath;
  }
  return undefined;
}

function findVisualManualSourceFilePath(options: VisualManualStorageOptions, stylePath: string, relativePath: string) {
  for (const root of getSourceRoots(options)) {
    const sourcePath = path.resolve(root, "art_skills", stylePath, relativePath);
    assertInsideRoot(path.join(root, "art_skills", stylePath), sourcePath);
    if (fs.existsSync(sourcePath)) return sourcePath;
  }
  return undefined;
}

function normalizeStylePath(stylePath: string) {
  const normalized = path.posix.normalize(stylePath.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("/")
  ) {
    throw new Error("无效的视觉风格路径");
  }
  return normalized;
}

function resolveVisualManualDirectory(storageRoot: string, relativePath: string) {
  const targetPath = path.resolve(storageRoot, "art_skills", relativePath);
  assertInsideRoot(path.join(storageRoot, "art_skills"), targetPath);
  return targetPath;
}

function resolveVisualManualFile(storageRoot: string, stylePath: string, relativePath: string) {
  const targetPath = path.resolve(storageRoot, "art_skills", stylePath, relativePath);
  assertInsideRoot(path.join(storageRoot, "art_skills", stylePath), targetPath);
  return targetPath;
}

function assertInsideRoot(root: string, targetPath: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(targetPath);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + path.sep)) {
    throw new Error("视觉风格路径越界");
  }
}

async function hashFile(filePath: string) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.promises.readFile(filePath));
  return hash.digest("hex");
}
