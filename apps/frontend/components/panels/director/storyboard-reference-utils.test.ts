import { describe, expect, it } from "vitest";
import type { Character } from "@/stores/character-library-store";
import {
  buildCharacterIdentityBlock,
  buildCharacterIdentityNotes,
  buildReferencePriorityHint,
  buildSceneCharacterContexts,
  buildSceneCharacterCastLine,
  normalizeCharacterIdentityText,
  optimizeReferenceImagesForModel,
  type SceneCharacterContext,
} from "./storyboard-reference-utils";

const context = (name: string, notes: string[] = []): SceneCharacterContext => ({
  characterId: name,
  name,
  identityNotes: notes,
  referenceImages: [],
});

describe("storyboard reference utilities", () => {
  it("prioritizes and caps nano-banana references while preserving normal bucket order", () => {
    const buckets = [
      { kind: "style" as const, images: ["style", "duplicate"] },
      { kind: "scene" as const, images: ["scene"] },
      { kind: "character" as const, images: ["character", "duplicate", "character-2"] },
      { kind: "anchor" as const, images: ["anchor", "anchor-2"] },
    ];
    expect(optimizeReferenceImagesForModel("nano-banana-pro", buckets)).toEqual([
      "anchor", "anchor-2", "character", "duplicate", "character-2", "scene",
    ]);
    expect(optimizeReferenceImagesForModel("other-model", buckets).slice(0, 4)).toEqual([
      "style", "duplicate", "scene", "character",
    ]);
  });

  it("normalizes identity text and truncates with the original ellipsis rule", () => {
    expect(normalizeCharacterIdentityText(" •  narrow\n eyes； ")).toBe("narrow eyes；");
    expect(normalizeCharacterIdentityText("abcdefghij", 8)).toBe("abcde...");
  });

  it("builds at most four stable character identity notes", () => {
    const character = {
      identityAnchors: {
        faceShape: "long face",
        jawline: "sharp jaw",
        eyeShape: "almond eyes",
        uniqueMarks: ["left brow scar", "mole", "ignored"],
        hairStyle: "high ponytail",
      },
      appearance: "dark robe",
    } as Character;
    expect(buildCharacterIdentityNotes(character)).toEqual([
      "bone structure long face, sharp jaw",
      "facial features almond eyes",
      "unique marks left brow scar, mole",
      "hair high ponytail",
    ]);
  });

  it("keeps single and multi-character cast and identity wording exact", () => {
    expect(buildSceneCharacterCastLine([context("阿青")])).toBe(
      "Exact scene cast: 阿青 only. Do not add any other person.",
    );
    expect(buildSceneCharacterCastLine([context("阿青"), context("玄策")])).toContain("阿青, 玄策");
    expect(buildCharacterIdentityBlock([context("阿青", ["left brow scar"])] )).toContain(
      "- 阿青: left brow scar.",
    );
    expect(buildCharacterIdentityBlock([])).toBe("");
    expect(buildReferencePriorityHint("gemini-3-pro-image-preview", true)).toContain("canonical identity anchors");
    expect(buildReferencePriorityHint("other-model", true)).toBe("");
  });

  it("preserves scene character order while resolving selected-variation references", () => {
    const character = {
      id: "character-1",
      name: "阿青",
      description: "剑客",
      visualTraits: "ink warrior",
      thumbnailUrl: "thumbnail",
      views: [
        { viewType: "front", imageUrl: "front-url", imageBase64: "front-base64", generatedAt: 1 },
        { viewType: "side", imageUrl: "side-url", generatedAt: 1 },
      ],
      referenceImages: ["base-reference", "thumbnail"],
      variations: [{
        id: "battle",
        name: "战斗装",
        visualPrompt: "battle robe",
        referenceImage: "variation-reference",
        clothingReferenceImages: ["clothing-reference", "front-base64"],
      }],
      createdAt: 1,
      updatedAt: 1,
    } as Character;

    const contexts = buildSceneCharacterContexts(
      [character],
      ["character-1", "missing", "character-1"],
      { "character-1": "battle" },
    );

    expect(contexts).toHaveLength(2);
    expect(contexts[0].characterId).toBe("character-1");
    expect(contexts[0].referenceImages).toEqual([
      "thumbnail",
      "variation-reference",
      "front-base64",
      "side-url",
      "base-reference",
      "clothing-reference",
    ]);
    expect(contexts[0].identityNotes).toContain("current outfit/state battle robe");
    expect(contexts[1].referenceImages).toEqual(contexts[0].referenceImages);
  });

  it("returns no contexts for empty IDs and caps each character reference list", () => {
    const character = {
      id: "character-1",
      name: "",
      description: "",
      visualTraits: "",
      views: [],
      referenceImages: Array.from({ length: 20 }, (_, index) => `reference-${index}`),
      variations: [],
      createdAt: 1,
      updatedAt: 1,
    } as Character;

    expect(buildSceneCharacterContexts([character], [])).toEqual([]);
    const [context] = buildSceneCharacterContexts([character], ["character-1"]);
    expect(context.name).toBe("Unnamed character");
    expect(context.referenceImages).toHaveLength(14);
    expect(context.referenceImages[0]).toBe("reference-0");
    expect(context.referenceImages[13]).toBe("reference-13");
  });
});
