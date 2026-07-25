import { describe, expect, it } from "vitest";
import {
  mergePropLibraryDataForStorage,
  splitPropLibraryDataForStorage,
  type PropFolder,
  type PropItem,
} from "./props-library-store";

const prop = (id: string, projectId?: string): PropItem => ({
  id,
  name: id,
  projectId,
  description: id,
  imageUrl: "",
  folderId: null,
  createdAt: 1,
});

const folder = (id: string, projectId?: string): PropFolder => ({
  id,
  name: id,
  parentId: null,
  projectId,
  createdAt: 1,
});

describe("props library project storage", () => {
  it("splits project props from shared props", () => {
    const state = {
      items: [prop("shared"), prop("dao-prop", "dao-project"), prop("other-prop", "other-project")],
      folders: [folder("shared-folder"), folder("dao-folder", "dao-project"), folder("other-folder", "other-project")],
      selectedFolderId: "dao-folder",
    };

    const { projectData, sharedData } = splitPropLibraryDataForStorage(state, "dao-project");

    expect(projectData.items.map((item) => item.id)).toEqual(["dao-prop"]);
    expect(projectData.folders.map((item) => item.id)).toEqual(["dao-folder"]);
    expect(projectData.selectedFolderId).toBe("dao-folder");
    expect(sharedData.items.map((item) => item.id)).toEqual(["shared"]);
    expect(sharedData.folders.map((item) => item.id)).toEqual(["shared-folder"]);
    expect(sharedData.selectedFolderId).toBe("all");
  });

  it("merges shared props before current project props", () => {
    const merged = mergePropLibraryDataForStorage(
      {
        items: [prop("dao-prop", "dao-project")],
        folders: [folder("dao-folder", "dao-project")],
        selectedFolderId: "dao-folder",
      },
      {
        items: [prop("shared")],
        folders: [folder("shared-folder")],
        selectedFolderId: "all",
      },
    );

    expect(merged.items.map((item) => item.id)).toEqual(["shared", "dao-prop"]);
    expect(merged.folders.map((item) => item.id)).toEqual(["shared-folder", "dao-folder"]);
    expect(merged.selectedFolderId).toBe("dao-folder");
  });
});
