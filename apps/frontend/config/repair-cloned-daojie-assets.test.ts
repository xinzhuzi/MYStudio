import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type Repair = {
  assetId: string;
  characterId: string;
  name: string;
  from: string;
  to: string;
};

let repairMissingCharacterThumbnails: (input: {
  characterStorePath: string;
  sourceAssetFilesRoot: string;
  roleAssets: Array<Record<string, unknown>>;
}) => Repair[];

beforeAll(async () => {
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), "build/smoke/repair-cloned-daojie-assets.mjs"),
  ).href;
  ({ repairMissingCharacterThumbnails } = await import(moduleUrl));
});

function createCharacterStore(root: string, characters: Array<Record<string, unknown>>) {
  const storePath = resolve(root, "characters.json");
  writeFileSync(storePath, `${JSON.stringify({ state: { characters } }, null, 2)}\n`);
  return storePath;
}

describe("repair cloned Daojie asset references", () => {
  it("replaces only missing absolute thumbnails with an existing same-name role asset", () => {
    const root = mkdtempSync(resolve(tmpdir(), "mystudio-clone-assets-"));
    const assetFilesRoot = resolve(root, "assets", "files");
    const replacementPath = resolve(assetFilesRoot, "role", "yanliao.png");
    mkdirSync(resolve(assetFilesRoot, "role"), { recursive: true });
    writeFileSync(replacementPath, "image");
    const existingPath = resolve(root, "existing.png");
    writeFileSync(existingPath, "existing");
    const missingPath = resolve(root, "missing.png");
    const storePath = createCharacterStore(root, [
      { id: "char-yanliao", name: "Yanliao", thumbnailUrl: missingPath },
      { id: "char-existing", name: "Existing", thumbnailUrl: existingPath },
    ]);

    const repairs = repairMissingCharacterThumbnails({
      characterStorePath: storePath,
      sourceAssetFilesRoot: assetFilesRoot,
      roleAssets: [
        { id: "asset-yanliao", type: "role", name: "Yanliao", filePath: "role/yanliao.png" },
        { id: "asset-existing", type: "role", name: "Existing", filePath: "role/other.png" },
      ],
    });
    const saved = JSON.parse(readFileSync(storePath, "utf8"));

    expect(repairs).toEqual([
      expect.objectContaining({
        assetId: "asset-yanliao",
        characterId: "char-yanliao",
        from: missingPath,
        to: replacementPath,
      }),
    ]);
    expect(saved.state.characters[0].thumbnailUrl).toBe(replacementPath);
    expect(saved.state.characters[1].thumbnailUrl).toBe(existingPath);
    expect(existsSync(replacementPath)).toBe(true);
  });

  it("does not accept an asset path that escapes the asset root", () => {
    const root = mkdtempSync(resolve(tmpdir(), "mystudio-clone-assets-escape-"));
    const assetFilesRoot = resolve(root, "assets", "files");
    mkdirSync(assetFilesRoot, { recursive: true });
    const missingPath = resolve(root, "missing.png");
    const storePath = createCharacterStore(root, [
      { id: "char-1", name: "Unsafe", thumbnailUrl: missingPath },
    ]);

    const repairs = repairMissingCharacterThumbnails({
      characterStorePath: storePath,
      sourceAssetFilesRoot: assetFilesRoot,
      roleAssets: [
        { id: "asset-1", type: "role", name: "Unsafe", filePath: "../../outside.png" },
      ],
    });

    expect(repairs).toEqual([]);
    expect(JSON.parse(readFileSync(storePath, "utf8")).state.characters[0].thumbnailUrl)
      .toBe(missingPath);
  });
});
