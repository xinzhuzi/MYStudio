import { describe, expect, it, vi } from "vitest";
import {
  createWorkflowFilename,
  safeExtension,
  safePathSegment,
  workflowImageRelativePath,
} from "./image-workflow-file-utils";

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
});
