// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyReferencedWorkflowAssets } from "./workflow-project-clone-assets.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-workflow-clone-assets-"));
  temporaryRoots.push(root);
  const sourceProjectRoot = path.join(root, "source-project");
  const sourceAssetsRoot = path.join(root, "source-storage", "assets");
  const cloneRoot = path.join(root, "clone");
  const targetProjectRoot = path.join(cloneRoot, "projects", "_p", "project-1");
  const targetAssetsRoot = path.join(cloneRoot, "assets");
  const projectImage = path.join(sourceProjectRoot, "assets", "files", "role", "project.png");
  const assetImage = path.join(sourceAssetsRoot, "files", "role", "asset.png");
  const thumbnail = path.join(sourceAssetsRoot, "thumbs", "role", "asset-thumb.png");
  for (const filePath of [projectImage, assetImage, thumbnail]) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  fs.writeFileSync(projectImage, "project-image", "utf8");
  fs.writeFileSync(assetImage, "asset-image", "utf8");
  fs.writeFileSync(thumbnail, "asset-thumbnail", "utf8");
  return { root, sourceProjectRoot, sourceAssetsRoot, cloneRoot, targetProjectRoot, targetAssetsRoot };
}

describe("copyReferencedWorkflowAssets", () => {
  it("copies only referenced project and asset files into their protocol roots", () => {
    const fixture = createFixture();

    const result = copyReferencedWorkflowAssets({
      documents: [{
        projectImage: "project-file://project-1/assets/files/role/project.png",
        assetImage: "asset-file://role/asset.png",
        assetThumbnail: "asset-file://role/asset-thumb.png?thumb=1",
        foreignProject: "project-file://project-2/assets/files/role/not-this-clone.png",
      }],
      cloneRoot: fixture.cloneRoot,
      projectId: "project-1",
      sourceProjectRoot: fixture.sourceProjectRoot,
      sourceAssetsRoot: fixture.sourceAssetsRoot,
      targetProjectRoot: fixture.targetProjectRoot,
      targetAssetsRoot: fixture.targetAssetsRoot,
    });

    expect(result.copied).toHaveLength(3);
    expect(result.blocked).toEqual([]);
    expect(result.ignored).toEqual([
      expect.objectContaining({ reason: "foreign-project" }),
    ]);
    expect(fs.readFileSync(path.join(fixture.targetProjectRoot, "assets", "files", "role", "project.png"), "utf8")).toBe("project-image");
    expect(fs.readFileSync(path.join(fixture.targetAssetsRoot, "files", "role", "asset.png"), "utf8")).toBe("asset-image");
    expect(fs.readFileSync(path.join(fixture.targetAssetsRoot, "thumbs", "role", "asset-thumb.png"), "utf8")).toBe("asset-thumbnail");
  });

  it("resolves project-file store segments from a migrated project store", () => {
    const fixture = createFixture();
    const storedMedia = path.join(fixture.sourceProjectRoot, "store", "media", "ai-image", "stored.png");
    fs.mkdirSync(path.dirname(storedMedia), { recursive: true });
    fs.writeFileSync(storedMedia, "stored-media", "utf8");

    const result = copyReferencedWorkflowAssets({
      documents: [{ media: "project-file://project-1/media/ai-image/stored.png" }],
      cloneRoot: fixture.cloneRoot,
      projectId: "project-1",
      sourceProjectRoot: fixture.sourceProjectRoot,
      sourceAssetsRoot: fixture.sourceAssetsRoot,
      targetProjectRoot: fixture.targetProjectRoot,
      targetAssetsRoot: fixture.targetAssetsRoot,
    });

    expect(result.blocked).toEqual([]);
    expect(result.copied).toHaveLength(1);
    expect(fs.readFileSync(path.join(fixture.targetProjectRoot, "media", "ai-image", "stored.png"), "utf8")).toBe("stored-media");
  });

  it("does not copy missing, traversal, or symlink-escaping references", () => {
    const fixture = createFixture();
    const externalFile = path.join(fixture.root, "outside.png");
    const escapedPath = path.join(fixture.sourceProjectRoot, "assets", "files", "role", "escaped.png");
    fs.writeFileSync(externalFile, "outside", "utf8");
    fs.symlinkSync(externalFile, escapedPath);

    const result = copyReferencedWorkflowAssets({
      documents: [{
        missing: "asset-file://role/missing.png",
        traversal: "asset-file://../outside.png",
        escaped: "project-file://project-1/assets/files/role/escaped.png",
      }],
      cloneRoot: fixture.cloneRoot,
      projectId: "project-1",
      sourceProjectRoot: fixture.sourceProjectRoot,
      sourceAssetsRoot: fixture.sourceAssetsRoot,
      targetProjectRoot: fixture.targetProjectRoot,
      targetAssetsRoot: fixture.targetAssetsRoot,
    });

    expect(result.copied).toEqual([]);
    expect(result.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "source-missing" }),
      expect.objectContaining({ reason: "invalid-url" }),
      expect.objectContaining({ reason: "source-escapes-root" }),
    ]));
    expect(fs.existsSync(path.join(fixture.targetAssetsRoot, "files", "role", "missing.png"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.targetProjectRoot, "assets", "files", "role", "escaped.png"))).toBe(false);
  });

  it("rejects a clone target reached through a symbolic link", () => {
    const fixture = createFixture();
    const outsideRoot = path.join(fixture.root, "outside-clone");
    fs.mkdirSync(path.dirname(fixture.targetProjectRoot), { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.symlinkSync(outsideRoot, fixture.targetProjectRoot);

    const result = copyReferencedWorkflowAssets({
      documents: [{ projectImage: "project-file://project-1/assets/files/role/project.png" }],
      cloneRoot: fixture.cloneRoot,
      projectId: "project-1",
      sourceProjectRoot: fixture.sourceProjectRoot,
      sourceAssetsRoot: fixture.sourceAssetsRoot,
      targetProjectRoot: fixture.targetProjectRoot,
      targetAssetsRoot: fixture.targetAssetsRoot,
    });

    expect(result.copied).toEqual([]);
    expect(result.blocked).toEqual([
      expect.objectContaining({ reason: "unsafe-target" }),
    ]);
    expect(fs.existsSync(path.join(outsideRoot, "assets", "files", "role", "project.png"))).toBe(false);
  });
});
