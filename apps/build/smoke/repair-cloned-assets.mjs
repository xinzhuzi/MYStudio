import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

function isInsideRoot(rootPath, targetPath) {
  const root = resolve(rootPath);
  const target = resolve(targetPath);
  return target === root || target.startsWith(`${root}${sep}`);
}

export function repairMissingCharacterThumbnails({
  characterStorePath,
  sourceAssetFilesRoot,
  roleAssets,
}) {
  const document = JSON.parse(readFileSync(characterStorePath, "utf8"));
  const characters = Array.isArray(document?.state?.characters)
    ? document.state.characters
    : [];
  const assetsByName = new Map(
    roleAssets
      .filter((asset) => asset?.type === "role" && typeof asset.name === "string")
      .map((asset) => [asset.name, asset]),
  );
  const repairs = [];

  for (const character of characters) {
    const currentPath = character?.thumbnailUrl;
    if (typeof currentPath !== "string" || !isAbsolute(currentPath) || existsSync(currentPath)) {
      continue;
    }
    const asset = assetsByName.get(character.name);
    if (!asset || typeof asset.filePath !== "string" || isAbsolute(asset.filePath)) {
      continue;
    }
    const replacementPath = resolve(sourceAssetFilesRoot, asset.filePath);
    if (!isInsideRoot(sourceAssetFilesRoot, replacementPath) || !existsSync(replacementPath)) {
      continue;
    }
    character.thumbnailUrl = replacementPath;
    repairs.push({
      assetId: asset.id,
      characterId: character.id,
      name: character.name,
      from: currentPath,
      to: replacementPath,
    });
  }

  if (repairs.length > 0) {
    writeFileSync(characterStorePath, `${JSON.stringify(document, null, 2)}\n`);
  }
  return repairs;
}
