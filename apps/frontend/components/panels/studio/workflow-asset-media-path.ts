import type { ContinuityAssetVersion } from "@/types/studio";
import type { Character } from "@/stores/library/character-library-store";
import type { Scene } from "@/stores/library/scene-store";
import type { PropItem } from "@/stores/library/props-library-store";

/**
 * 资产「当前样子」的有序候选媒体路径(08-27 二期 R2 唯一事实源):
 *
 * ① 最新批准连续性版本首图(权威最新——连续性在管的资产以它为准);
 * ② legacy 链(与一期锚写入/面板取图优先级逐字符一致,无连续性版本时行为不变)。
 *
 * 三个消费点共用:面板父卡显示取 candidates[0];锚写入记 candidates[0];
 * 过期比对命中候选集合任一即不算路径过期(一期已写锚的兼容层,宁可漏报)。
 * 纯函数,零 store 运行时依赖(仅 type import),无循环引用风险。
 */
export interface ResolveAssetCurrentMediaPathsInput {
  kind: "character" | "scene" | "prop";
  character?: Character;
  scene?: Scene;
  prop?: PropItem;
  latestApprovedVersion?: ContinuityAssetVersion | null;
}

export function resolveAssetCurrentMediaPaths(
  input: ResolveAssetCurrentMediaPathsInput,
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value: string | undefined | null) => {
    if (!value || typeof value !== "string") return;
    if (!candidates.includes(value)) candidates.push(value);
  };
  pushCandidate(input.latestApprovedVersion?.referenceImagePaths?.[0]);
  pushCandidate(resolveLegacyAssetMediaPath(input));
  return candidates;
}

/**
 * 一期取图优先级,逐字符保留:
 * - character: thumbnailUrl → views 首张有图视图 → referenceImages[0]
 * - scene: referenceImage → referenceImageBase64 → contactSheetImage(非空白)
 * - prop: imageUrl
 */
function resolveLegacyAssetMediaPath(
  input: ResolveAssetCurrentMediaPathsInput,
): string | undefined {
  if (input.kind === "character") {
    const character = input.character;
    return character
      ? character.thumbnailUrl
        ?? character.views.find((view) => view.imageUrl)?.imageUrl
        ?? character.referenceImages?.[0]
      : undefined;
  }
  if (input.kind === "scene") {
    const scene = input.scene;
    if (!scene) return undefined;
    return (
      scene.referenceImage
      ?? scene.referenceImageBase64
      ?? (scene.contactSheetImage?.trim() ? scene.contactSheetImage : undefined)
    );
  }
  return input.prop?.imageUrl;
}
