import { describe, expect, it, vi } from "vitest";
import { normalizeStoryboardReferenceImages } from "./storyboard-reference-image-normalizer";

describe("normalizeStoryboardReferenceImages", () => {
  it("keeps supported remote and data references in order", async () => {
    await expect(normalizeStoryboardReferenceImages([
      "", "https://cdn.test/a.png", "data:image/png;base64,AAAA", "file:///tmp/a.png",
    ], { readLocalImage: vi.fn() })).resolves.toEqual([
      "https://cdn.test/a.png", "data:image/png;base64,AAAA",
    ]);
  });

  it("preserves legacy local conversion while optionally enforcing a data URI", async () => {
    const readLocalImage = vi.fn(async () => "raw-base64");
    await expect(normalizeStoryboardReferenceImages(["local-image://a"], { readLocalImage }))
      .resolves.toEqual(["raw-base64"]);
    await expect(normalizeStoryboardReferenceImages(["local-image://a"], {
      readLocalImage, validateLocalDataUri: true,
    })).resolves.toEqual([]);
  });

  it("caps input before conversion and reports local read failures", async () => {
    const onReadError = vi.fn();
    const readLocalImage = vi.fn(async () => { throw new Error("missing"); });
    await expect(normalizeStoryboardReferenceImages([
      "local-image://bad", "https://cdn.test/after-limit.png",
    ], { readLocalImage, max: 1, onReadError })).resolves.toEqual([]);
    expect(readLocalImage).toHaveBeenCalledOnce();
    expect(onReadError).toHaveBeenCalledWith("local-image://bad", expect.any(Error));
  });
});
