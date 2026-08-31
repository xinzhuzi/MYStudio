import { describe, expect, it } from "vitest";
import { collectCharacterReferenceImages } from "./storyboard-reference-utils";

describe("collectCharacterReferenceImages", () => {
  it("round-robins character references and removes duplicates", () => {
    expect(collectCharacterReferenceImages([
      { characterId: "a", name: "A", identityNotes: [], referenceImages: ["a-1", "a-2"] },
      { characterId: "b", name: "B", identityNotes: [], referenceImages: ["b-1", "a-2", "b-3"] },
    ])).toEqual(["a-1", "b-1", "a-2", "b-3"]);
  });

  it("stops at the requested limit", () => {
    expect(collectCharacterReferenceImages([
      { characterId: "a", name: "A", identityNotes: [], referenceImages: ["a-1", "a-2"] },
      { characterId: "b", name: "B", identityNotes: [], referenceImages: ["b-1", "b-2"] },
    ], 2)).toEqual(["a-1", "b-1"]);
  });
});
