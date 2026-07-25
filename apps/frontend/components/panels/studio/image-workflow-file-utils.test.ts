import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowFilename,
  prepareReferenceImages,
  safeExtension,
  safePathSegment,
  workflowImageRelativePath,
} from "./image-workflow-file-utils";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("image workflow file utils", () => {
  it("keeps workflow files under a sanitized project-relative directory", () => {
    expect(workflowImageRelativePath("Flow / 道劫", "参考 图.PNG")).toBe(
      "workflow-images/flow-道劫/参考-图.png",
    );
    expect(safePathSegment("***")).toBe("file");
    expect(safeExtension("image.jpeg")).toBe(".jpeg");
    expect(safeExtension("image")).toBe(".png");
  });

  it("builds stable filename fields while preserving uniqueness suffixes", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(createWorkflowFilename("gen", "Node 1", "Hero Pose.JPG")).toBe(
      "gen-node-1-hero-pose-1234-i.jpg",
    );
    vi.restoreAllMocks();
  });

  it("reads project references through the optional project-files bridge", async () => {
    const readAsBase64 = vi.fn(async () => ({ success: true, base64: "data:image/png;base64,abc" }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { projectFiles: { readAsBase64 } },
    });

    await expect(prepareReferenceImages(["project-file://demo/ref.png"]))
      .resolves.toEqual(["data:image/png;base64,abc"]);
    expect(readAsBase64).toHaveBeenCalledWith("project-file://demo/ref.png");
  });

  it("preserves the project-reference error when the bridge is unavailable", async () => {
    await expect(prepareReferenceImages(["project-file://demo/ref.png"]))
      .rejects.toThrow("项目内参考图读取失败：project-file://demo/ref.png");
  });
});
