import { describe, it, expect } from "vitest";
import { getRefPreviewMode, getPathExtension, isPreviewable, type PreviewMode } from "./ref-preview-mode";

describe("getPathExtension", () => {
  it("extracts lowercased extension from a plain path", () => {
    expect(getPathExtension("a/b/c.PNG")).toBe("png");
  });

  it("strips protocol scheme", () => {
    expect(getPathExtension("local-image://x/y.json")).toBe("json");
    expect(getPathExtension("project-file://pid/rel/scene.MP4")).toBe("mp4");
  });

  it("strips query string and hash", () => {
    expect(getPathExtension("a.json?token=1")).toBe("json");
    expect(getPathExtension("a.md#heading")).toBe("md");
  });

  it("returns empty for no extension or trailing dot", () => {
    expect(getPathExtension("README")).toBe("");
    expect(getPathExtension("a/b.")).toBe("");
  });
});

describe("getRefPreviewMode", () => {
  const cases: Array<[string, PreviewMode]> = [
    ["x.png", "image"],
    ["x.JPG", "image"],
    ["x.webp", "image"],
    ["x.svg", "image"],
    ["README.md", "markdown"],
    ["notes.markdown", "markdown"],
    ["data.json", "json"],
    ["events.jsonl", "json"],
    ["voice.mp3", "audio"],
    ["voice.wav", "audio"],
    ["clip.mp4", "video"],
    ["clip.webm", "video"],
    ["script.txt", "text"],
    ["log.log", "text"],
    ["subs.srt", "text"],
    ["subs.vtt", "text"],
    ["config.yaml", "text"],
    ["config.toml", "text"],
    ["page.html", "text"],
    // protocol URLs
    ["local-image://proj/scene_001.png", "image"],
    ["local-video://proj/ch1.mp4", "video"],
    ["project-file://pid/assets/data.json", "json"],
    // unknown / binary
    ["archive.zip", "binary"],
    ["binary.bin", "binary"],
    ["noext", "binary"],
    ["app.exe", "binary"],
  ];

  for (const [path, expected] of cases) {
    it(`classifies "${path}" as ${expected}`, () => {
      expect(getRefPreviewMode(path)).toBe(expected);
    });
  }
});

describe("isPreviewable", () => {
  it("returns false only for binary", () => {
    expect(isPreviewable("binary")).toBe(false);
    expect(isPreviewable("image")).toBe(true);
    expect(isPreviewable("text")).toBe(true);
    expect(isPreviewable("json")).toBe(true);
  });
});
