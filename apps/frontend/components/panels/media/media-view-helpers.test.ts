import { describe, expect, it } from "vitest";
import type { MediaFile, MediaFolder } from "@/types/media";
import {
  formatMediaDuration,
  getCurrentMediaFolders,
  getFilteredMediaItems,
  getMediaBreadcrumbPath,
  getMediaFolderFileCounts,
  getVisibleMediaFiles,
  getVisibleMediaFolders,
  splitCurrentMediaFolders,
} from "./media-view-helpers";

function folder(
  id: string,
  parentId: string | null,
  overrides: Partial<MediaFolder> = {},
): MediaFolder {
  return {
    id,
    name: id,
    parentId,
    createdAt: 1,
    ...overrides,
  };
}

function mediaFile(
  id: string,
  overrides: Partial<MediaFile> = {},
): MediaFile {
  return {
    id,
    name: id,
    type: "image",
    ...overrides,
  };
}

describe("media view helpers", () => {
  it("keeps system folders visible while isolating project media", () => {
    const folders = [
      folder("system", null, { isSystem: true }),
      folder("project-1", null, { projectId: "project-1" }),
      folder("project-2", null, { projectId: "project-2" }),
    ];
    const files = [
      mediaFile("file-1", { projectId: "project-1" }),
      mediaFile("file-2", { projectId: "project-2" }),
    ];

    expect(getVisibleMediaFolders(folders, false, "project-1")).toEqual(
      folders.slice(0, 2),
    );
    expect(getVisibleMediaFiles(files, false, "project-1")).toEqual([
      files[0],
    ]);
    expect(getVisibleMediaFolders(folders, true)).toBe(folders);
    expect(getVisibleMediaFiles(files, true)).toBe(files);
  });

  it("builds root groups, recursive counts, and breadcrumbs", () => {
    const folders = [
      folder("system", null, { isSystem: true }),
      folder("custom", null),
      folder("child", "custom"),
    ];
    const currentFolders = getCurrentMediaFolders(folders, null);

    expect(splitCurrentMediaFolders(currentFolders, null)).toEqual({
      systemFolders: [folders[0]],
      customFolders: [folders[1]],
    });
    expect(
      getMediaFolderFileCounts(currentFolders, folders, [
        mediaFile("direct", { folderId: "custom" }),
        mediaFile("nested", { folderId: "child" }),
        mediaFile("hidden", { folderId: "child", ephemeral: true }),
      ]),
    ).toEqual({ system: 0, custom: 2 });
    expect(getMediaBreadcrumbPath(folders, "child")).toEqual([
      folders[1],
      folders[2],
    ]);
  });

  it("filters the current folder and preserves configured sort direction", () => {
    const files = [
      mediaFile("beta", { name: "Beta", folderId: null, duration: 8 }),
      mediaFile("alpha", { name: "alpha", folderId: null, duration: 3 }),
      mediaFile("nested", { folderId: "child", duration: 1 }),
      mediaFile("ephemeral", { folderId: null, ephemeral: true }),
    ];

    expect(getFilteredMediaItems(files, null, "name", "asc")).toEqual([
      files[1],
      files[0],
    ]);
    expect(getFilteredMediaItems(files, null, "duration", "desc")).toEqual([
      files[0],
      files[1],
    ]);
    expect(formatMediaDuration(65.9)).toBe("1:05");
  });
});
