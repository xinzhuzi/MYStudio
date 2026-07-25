import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAssetImagePickerDefaultPath } from "./asset-image-picker";

const mediaRoots: string[] = [];

function createMediaRoot() {
  const root = mkdtempSync(join(tmpdir(), "mystudio-media-picker-"));
  mediaRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of mediaRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("asset image picker default path", () => {
  it("opens the only image-containing media folder directly", () => {
    const mediaRoot = createMediaRoot();
    const shotsDir = join(mediaRoot, "shots");
    mkdirSync(shotsDir);
    writeFileSync(join(shotsDir, "frame.png"), "png");

    expect(getAssetImagePickerDefaultPath(mediaRoot)).toBe(shotsDir);
  });

  it("opens the media root when images exist in multiple folders", () => {
    const mediaRoot = createMediaRoot();
    const shotsDir = join(mediaRoot, "shots");
    const assetsDir = join(mediaRoot, "studio-assets");
    mkdirSync(shotsDir);
    mkdirSync(assetsDir);
    writeFileSync(join(shotsDir, "frame.png"), "png");
    writeFileSync(join(assetsDir, "role.webp"), "webp");

    expect(getAssetImagePickerDefaultPath(mediaRoot)).toBe(mediaRoot);
  });

  it("opens the media root when no folder contains selectable images", () => {
    const mediaRoot = createMediaRoot();
    const aiImageDir = join(mediaRoot, "ai-image");
    mkdirSync(aiImageDir);
    writeFileSync(join(aiImageDir, "note.txt"), "not an image");

    expect(getAssetImagePickerDefaultPath(mediaRoot)).toBe(mediaRoot);
  });
});
