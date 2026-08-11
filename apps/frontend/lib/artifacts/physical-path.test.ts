import { describe, expect, it } from "vitest";
import {
  getArtifactPhysicalDirectory,
  normalizeArtifactPhysicalPath,
  parseProjectFilePath,
} from "./physical-path";

describe("artifact physical path helpers", () => {
  it("unwraps project-file URLs for the owning project", () => {
    const value = "project-file://project-1/workflow-images/chapter-001/shot%20001.png";
    expect(parseProjectFilePath(value)).toEqual({
      projectId: "project-1",
      relativePath: "workflow-images/chapter-001/shot 001.png",
    });
    expect(normalizeArtifactPhysicalPath(value, "project-1")).toBe(
      "workflow-images/chapter-001/shot 001.png",
    );
    expect(getArtifactPhysicalDirectory(value, "project-1")).toBe(
      "workflow-images/chapter-001",
    );
  });

  it("rejects cross-project and non-project protocol refs", () => {
    expect(normalizeArtifactPhysicalPath("project-file://project-2/shot.png", "project-1")).toBeNull();
    expect(normalizeArtifactPhysicalPath("local-image://assets/shot.png", "project-1")).toBeNull();
    expect(normalizeArtifactPhysicalPath("/tmp/shot.png", "project-1")).toBeNull();
  });

  it("keeps inventory-relative paths and rejects traversal", () => {
    expect(normalizeArtifactPhysicalPath("./exports/chapter-001/final.mp4")).toBe(
      "exports/chapter-001/final.mp4",
    );
    expect(normalizeArtifactPhysicalPath("exports/../outside.mp4")).toBeNull();
  });
});
