// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imageWorkflowAssetTypeToLibraryKind,
  resolveAssetLibrarySourceFilePath,
} from "./image-workflow-asset-bridge";

afterEach(() => {
  delete (window as typeof window & { projectFiles?: unknown }).projectFiles;
});

describe("image workflow asset bridge", () => {
  it("maps workflow target types to the stable asset-library kinds", () => {
    expect(imageWorkflowAssetTypeToLibraryKind("character")).toBe("role");
    expect(imageWorkflowAssetTypeToLibraryKind("scene")).toBe("scene");
    expect(imageWorkflowAssetTypeToLibraryKind("prop")).toBe("tool");
    expect(() => imageWorkflowAssetTypeToLibraryKind()).toThrow("资产工作流缺少资产类型");
  });

  it("resolves project, file, and absolute source paths", async () => {
    const getAbsolutePath = vi.fn(async () => "/tmp/project-image.png");
    Object.assign(window, { projectFiles: { getAbsolutePath } });

    await expect(resolveAssetLibrarySourceFilePath("project-file://demo/image.png"))
      .resolves.toBe("/tmp/project-image.png");
    await expect(resolveAssetLibrarySourceFilePath("file:///tmp/a%20b.png"))
      .resolves.toBe("/tmp/a b.png");
    await expect(resolveAssetLibrarySourceFilePath("/tmp/plain.png"))
      .resolves.toBe("/tmp/plain.png");
    await expect(resolveAssetLibrarySourceFilePath("https://example.com/image.png"))
      .resolves.toBeUndefined();
  });
});
