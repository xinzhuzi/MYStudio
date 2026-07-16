import type { Character, CharacterVariation } from "@/stores/character-library-store";

type ReferenceBucketKind = "anchor" | "character" | "scene" | "style";

export type ReferenceBucket = {
  kind: ReferenceBucketKind;
  images: string[];
};

export type SceneCharacterContext = {
  characterId: string;
  name: string;
  identityNotes: string[];
  referenceImages: string[];
};

export const MAX_REFERENCE_IMAGES = 14;
const MAX_NANO_BANANA_REFERENCE_IMAGES = 6;
const NANO_BANANA_IDENTITY_MODELS = new Set([
  "nano-banana-pro",
  "gemini-3-pro-image-preview",
  "nano-banana-2",
  "gemini-3.1-pro-image-preview",
]);
const REFERENCE_BUCKET_PRIORITY: Record<ReferenceBucketKind, number> = {
  anchor: 0,
  character: 1,
  scene: 2,
  style: 3,
};

export function normalizeCharacterIdentityText(value?: string | null, maxLength = 96): string {
  if (!value) return "";
  const normalized = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-*•·]+/, "")
    .replace(/[;,，；。]+$/g, "")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function isNanoBananaProModel(model?: string | null): boolean {
  return NANO_BANANA_IDENTITY_MODELS.has((model || "").trim().toLowerCase());
}

export function optimizeReferenceImagesForModel(
  model: string | undefined,
  buckets: ReferenceBucket[],
): string[] {
  const orderedBuckets = isNanoBananaProModel(model)
    ? [...buckets].sort((left, right) => REFERENCE_BUCKET_PRIORITY[left.kind] - REFERENCE_BUCKET_PRIORITY[right.kind])
    : buckets;
  const limit = isNanoBananaProModel(model) ? MAX_NANO_BANANA_REFERENCE_IMAGES : MAX_REFERENCE_IMAGES;
  const refs: string[] = [];
  const seen = new Set<string>();

  for (const bucket of orderedBuckets) {
    for (const image of bucket.images) {
      if (!image || seen.has(image)) continue;
      seen.add(image);
      refs.push(image);
      if (refs.length >= limit) return refs;
    }
  }
  return refs;
}

export function buildReferencePriorityHint(model: string | undefined, hasCharacterReferences: boolean): string {
  if (!isNanoBananaProModel(model) || !hasCharacterReferences) return "";
  return [
    "Reference priority:",
    "the earliest character references are canonical identity anchors;",
    "later references are only for scene, lighting, framing, and mood;",
    "later references must never override face-name-body identity.",
  ].join(" ");
}

export function buildCharacterIdentityNotes(
  character: Character,
  selectedVariation?: CharacterVariation,
): string[] {
  const notes: string[] = [];
  const push = (value?: string | null, maxLength = 96) => {
    const normalized = normalizeCharacterIdentityText(value, maxLength);
    if (!normalized || notes.includes(normalized)) return;
    notes.push(normalized);
  };
  const anchors = character.identityAnchors;
  if (anchors) {
    const boneStructure = [anchors.faceShape, anchors.jawline, anchors.cheekbones].filter(Boolean).join(", ");
    const facialFeatures = [anchors.eyeShape, anchors.eyeDetails, anchors.noseShape, anchors.lipShape].filter(Boolean).join(", ");
    const hairDetails = [anchors.hairStyle, anchors.hairlineDetails].filter(Boolean).join(", ");
    const colorDetails = [
      anchors.colorAnchors?.iris ? `iris ${anchors.colorAnchors.iris}` : "",
      anchors.colorAnchors?.hair ? `hair ${anchors.colorAnchors.hair}` : "",
      anchors.colorAnchors?.skin ? `skin ${anchors.colorAnchors.skin}` : "",
      anchors.colorAnchors?.lips ? `lips ${anchors.colorAnchors.lips}` : "",
    ].filter(Boolean).join(", ");
    if (boneStructure) push(`bone structure ${boneStructure}`);
    if (facialFeatures) push(`facial features ${facialFeatures}`);
    if (anchors.uniqueMarks?.length) push(`unique marks ${anchors.uniqueMarks.slice(0, 2).join(", ")}`);
    if (hairDetails) push(`hair ${hairDetails}`);
    if (colorDetails) push(`color anchors ${colorDetails}`);
    if (anchors.skinTexture) push(`skin texture ${anchors.skinTexture}`);
  }
  if (notes.length < 4) push(character.appearance);
  if (notes.length < 4) push(character.visualTraits);
  if (notes.length < 4) push(character.description);
  if (notes.length < 4) push(character.role);
  if (selectedVariation) {
    const variationPrompt = selectedVariation.visualPromptZh || selectedVariation.visualPrompt || selectedVariation.name;
    push(`current outfit/state ${variationPrompt}`, 84);
  }
  return notes.slice(0, 4);
}

export function buildSceneCharacterContexts(
  characters: Character[],
  characterIds: string[],
  variationMap?: Record<string, string>,
): SceneCharacterContext[] {
  if (!characterIds?.length) return [];

  return characterIds.flatMap((characterId) => {
    const character = characters.find((item) => item.id === characterId);
    if (!character) return [];

    const variationId = variationMap?.[characterId];
    const selectedVariation = variationId
      ? character.variations?.find((variation) => variation.id === variationId)
      : undefined;

    const referenceImages: string[] = [];
    const seen = new Set<string>();
    const pushReferenceImage = (value?: string | null) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      referenceImages.push(value);
    };

    pushReferenceImage(character.thumbnailUrl);
    pushReferenceImage(selectedVariation?.referenceImage);

    for (const view of character.views || []) {
      pushReferenceImage(view.imageBase64 || view.imageUrl);
    }

    for (const image of character.referenceImages || []) {
      pushReferenceImage(image);
    }

    for (const image of selectedVariation?.clothingReferenceImages || []) {
      pushReferenceImage(image);
    }

    return [{
      characterId,
      name: character.name || "Unnamed character",
      identityNotes: buildCharacterIdentityNotes(character, selectedVariation),
      referenceImages: referenceImages.slice(0, MAX_REFERENCE_IMAGES),
    }];
  });
}

export function buildCharacterIdentityBlock(contexts: SceneCharacterContext[]): string {
  if (contexts.length === 0) return "";
  const lines = ["Character identity lock:"];
  contexts.forEach((context) => {
    const summary = context.identityNotes.length > 0
      ? context.identityNotes.join("; ")
      : "use the canonical earliest reference as the exact face/body identity anchor";
    lines.push(`- ${context.name}: ${summary}.`);
  });
  lines.push(contexts.length > 1
    ? "Do not swap face identity, body identity, speaking ownership, or action ownership between named characters."
    : "The named character must remain the exact same person in every output.");
  return lines.join("\n");
}

export function buildSceneCharacterCastLine(contexts: SceneCharacterContext[]): string {
  if (contexts.length === 0) return "";
  const names = contexts.map((context) => context.name).join(", ");
  return contexts.length === 1
    ? `Exact scene cast: ${names} only. Do not add any other person.`
    : `Exact scene cast: ${names}. Keep the face-name-body mapping exact for each named character and do not swap who performs or receives the action.`;
}
