import { describe, expect, it } from "vitest";
import {
  parseLocalMediaPath,
  resolveDataDirPath,
  resolveDataFilePath,
  resolveLocalMediaPath,
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
});
