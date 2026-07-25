import fs from "node:fs";
import path from "node:path";

const SELECTABLE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function hasSelectableImageFile(dirPath: string) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true }).some((entry) => {
      return entry.isFile() && SELECTABLE_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
    });
  } catch {
    return false;
  }
}

export function getAssetImagePickerDefaultPath(mediaRoot: string) {
  const resolvedMediaRoot = path.resolve(mediaRoot);
  try {
    const imageDirs = fs.readdirSync(resolvedMediaRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(resolvedMediaRoot, entry.name))
      .filter(hasSelectableImageFile);

    return imageDirs.length === 1 ? imageDirs[0] : resolvedMediaRoot;
  } catch {
    return resolvedMediaRoot;
  }
}
