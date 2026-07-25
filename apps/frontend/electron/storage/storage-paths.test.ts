import { describe, expect, it } from "vitest";
import {
  createProjectFileUrl,
  parseLocalMediaPath,
  parseProjectFileUrl,
  resolveDataDirPath,
  resolveDataFilePath,
  resolveLocalMediaPath,
  resolveProjectFileUrl,
  resolveProjectScopedFilePath,
} from "./storage-paths";

describe("storage path helpers", () => {
  it("keeps file-storage keys inside the data root", () => {
    expect(resolveDataFilePath("/data", "_p/project/script")).toBe("/data/_p/project/script.json");
    expect(() => resolveDataFilePath("/data", "../secrets")).toThrow("escapes");
  });

  it("keeps file-storage prefixes inside the data root", () => {
    expect(resolveDataDirPath("/data", "_p/project")).toBe("/data/_p/project");
    expect(() => resolveDataDirPath("/data", "../../")).toThrow("escapes");
  });

  it("parses local-image URLs without allowing traversal", () => {
    expect(parseLocalMediaPath("local-image://studio-assets/cover.png")).toEqual({
      category: "studio-assets",
      filename: "cover.png",
    });
    expect(parseLocalMediaPath("file:///tmp/cover.png")).toBe(null);
    expect(() => parseLocalMediaPath("local-image://studio-assets/../secret.png")).toThrow("escapes");
  });

  it("resolves local media paths inside the media root", () => {
    expect(resolveLocalMediaPath("/media", "local-image://studio-assets/cover.png")).toBe("/media/studio-assets/cover.png");
    expect(() => resolveLocalMediaPath("/media", "local-image://studio-assets/../../secret.png")).toThrow("escapes");
  });

  it("keeps project workflow files inside the active project directory", () => {
    expect(createProjectFileUrl("dao-project", "workflow-images/flow-1/cover.png")).toBe(
      "project-file://dao-project/workflow-images/flow-1/cover.png",
    );
    expect(parseProjectFileUrl("project-file://dao-project/workflow-images/flow-1/cover.png")).toEqual({
      projectId: "dao-project",
      relativePath: "workflow-images/flow-1/cover.png",
    });
    expect(resolveProjectScopedFilePath("/data/projects", "dao-project", "workflow-images/flow-1/cover.png")).toBe(
      "/data/projects/_p/dao-project/workflow-images/flow-1/cover.png",
    );
    expect(resolveProjectFileUrl("/data/projects", "project-file://dao-project/workflow-images/flow-1/cover.png")).toBe(
      "/data/projects/_p/dao-project/workflow-images/flow-1/cover.png",
    );
    expect(() => resolveProjectFileUrl("/data/projects", "project-file://dao-project/../secret.png")).toThrow("escapes");
    expect(() => createProjectFileUrl("../dao", "workflow-images/cover.png")).toThrow("escapes");
    expect(() => createProjectFileUrl("dao/project", "workflow-images/cover.png")).toThrow("escapes");
    expect(() => createProjectFileUrl("dao\0project", "workflow-images/cover.png")).toThrow("Invalid");
    expect(() => parseProjectFileUrl("project-file://dao%2Fproject/workflow-images/cover.png")).toThrow("escapes");
    expect(() => resolveProjectScopedFilePath("/data/projects", "../dao", "workflow-images/cover.png")).toThrow("escapes");
  });
});
