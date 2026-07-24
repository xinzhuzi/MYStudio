import type { ScriptScene } from "@/types/script";

type SceneDescriptionSource = Pick<
  ScriptScene,
  "architectureStyle" | "colorPalette" | "eraDetails" | "lightingDesign"
>;

export interface SceneDescriptions {
  sceneDescEn: string;
  sceneDescZh: string;
}

/**
 * Build the bilingual scene-design summary shared by all contact-sheet flows.
 * Keep the field order and separators stable because the resulting text is
 * embedded directly in provider prompts.
 */
export function buildSceneDescriptions(scene: SceneDescriptionSource): SceneDescriptions {
  return {
    sceneDescEn: [
      scene.architectureStyle && `Architecture: ${scene.architectureStyle}`,
      scene.colorPalette && `Color palette: ${scene.colorPalette}`,
      scene.eraDetails && `Era: ${scene.eraDetails}`,
      scene.lightingDesign && `Lighting: ${scene.lightingDesign}`,
    ].filter(Boolean).join(". "),
    sceneDescZh: [
      scene.architectureStyle && `建筑风格：${scene.architectureStyle}`,
      scene.colorPalette && `色彩基调：${scene.colorPalette}`,
      scene.eraDetails && `时代特征：${scene.eraDetails}`,
      scene.lightingDesign && `光影设计：${scene.lightingDesign}`,
    ].filter(Boolean).join("，"),
  };
}
