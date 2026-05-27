import moyinCharacterReference from "@/assets/style-thumbnails/moyin-character-reference.jpg";
import moyinScene01 from "@/assets/style-thumbnails/moyin-scene-01.png";
import moyinScene02 from "@/assets/style-thumbnails/moyin-scene-02.png";
import moyinScene03 from "@/assets/style-thumbnails/moyin-scene-03.png";
import moyinScene04 from "@/assets/style-thumbnails/moyin-scene-04.png";
import type { StylePreset } from "./visual-styles";

const THUMBNAILS_BY_CATEGORY: Record<StylePreset["category"], string[]> = {
  "3d": [moyinCharacterReference, moyinScene01],
  "2d": [moyinCharacterReference, moyinScene02],
  "real": [moyinScene01, moyinScene03],
  "stop_motion": [moyinScene02, moyinScene04],
};

function stableIndex(value: string, length: number) {
  if (length <= 1) return 0;
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total += value.charCodeAt(index) * (index + 1);
  }
  return total % length;
}

export function getStyleThumbnailSource(style: Pick<StylePreset, "id" | "category">) {
  const categoryThumbnails = THUMBNAILS_BY_CATEGORY[style.category] ?? [];
  return categoryThumbnails[stableIndex(style.id, categoryThumbnails.length)] ?? moyinCharacterReference;
}
