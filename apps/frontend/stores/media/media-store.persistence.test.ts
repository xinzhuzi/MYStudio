import { describe, expect, it } from "vitest";
import { mergeMediaData, normalizeMediaUrl, partializeMediaData, splitMediaData, useMediaStore } from "./media-store";
import type { MediaFile, MediaFolder } from "@/types/media";

const folder = (id: string, extra: Partial<MediaFolder> = {}): MediaFolder => ({ id, name: id, parentId: null, createdAt: 1, ...extra });
const file = (id: string, extra: Partial<MediaFile> = {}): MediaFile => ({ id, name: id, type: "image", ...extra });

describe("media store persistence characterization", () => {
  it("keeps the stable persistence key and media partializer", () => {
    const options = useMediaStore.persist.getOptions();

    expect(options.name).toBe("mystudio-media-store");
    expect(options.partialize).toBe(partializeMediaData);
    expect(options.merge).toEqual(expect.any(Function));
  });

  it("splits project, system, auto-created, and shared records", () => {
    const state = {
      folders: [
        folder("p", { projectId: "p1" }),
        folder("project-auto", { projectId: "p1", isAutoCreated: true }),
        folder("sys", { isSystem: true, projectId: "other" }),
        folder("auto", { isAutoCreated: true }),
        folder("shared"),
      ],
      mediaFiles: [file("p", { projectId: "p1" }), file("shared")],
    };
    expect(splitMediaData(state, "p1")).toEqual({
      projectData: { folders: [state.folders[0], state.folders[1]], mediaFiles: [state.mediaFiles[0]] },
      sharedData: { folders: [state.folders[2], state.folders[4]], mediaFiles: [state.mediaFiles[1]] },
    });
  });

  it("merges shared before project and tolerates null", () => {
    expect(mergeMediaData({ folders: [folder("p")], mediaFiles: [file("p")] }, { folders: [folder("s")], mediaFiles: [file("s")] })).toEqual({ folders: [folder("s"), folder("p")], mediaFiles: [file("s"), file("p")] });
    expect(mergeMediaData(null, null)).toEqual({ folders: [], mediaFiles: [] });
  });

  it("normalizes and filters persisted media", () => {
    expect(normalizeMediaUrl(["https://x"])).toBe("https://x");
    expect(normalizeMediaUrl([])).toBeUndefined();
    expect(normalizeMediaUrl({})).toBeUndefined();
    const result = partializeMediaData({
      ...useMediaStore.getState(),
      folders: [folder("keep-folder")],
      mediaFiles: [
        file("keep", {
          file: { name: "session-file" } as unknown as File,
          url: ["https://x"] as unknown as string,
          thumbnailUrl: "https://thumb",
        }),
        file("transient", { url: "data:image/png;base64,abc" }),
        file("drop", { ephemeral: true }),
      ],
    });
    expect(result.mediaFiles).toEqual([
      { ...file("keep"), file: undefined, url: "https://x", thumbnailUrl: "https://thumb" },
      { ...file("transient"), file: undefined, url: undefined, thumbnailUrl: undefined },
    ]);
    expect(result.folders).toEqual([folder("keep-folder")]);
  });
});
