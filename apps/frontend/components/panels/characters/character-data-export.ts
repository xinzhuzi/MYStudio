import { getStyleById } from "@/lib/constants/visual-styles";
import type {
  CharacterIdentityAnchors,
  CharacterNegativePrompt,
} from "@/types/script";
import {
  AGE_PRESETS,
  GENDER_PRESETS,
  SHEET_ELEMENTS,
  type SheetElementId,
} from "./character-generation-prompt";

export interface CharacterDataExportInput {
  name: string;
  gender: string;
  age: string;
  personality: string;
  description: string;
  identityAnchors?: CharacterIdentityAnchors;
  charNegativePrompt?: CharacterNegativePrompt;
  visualPromptEn?: string;
  visualPromptZh?: string;
  isManuallyModified: boolean;
  storyYear?: number;
  era?: string;
  styleId: string;
  referenceImageCount: number;
  selectedElements: readonly SheetElementId[];
}

export function buildCharacterDataText({
  name,
  gender,
  age,
  personality,
  description,
  identityAnchors,
  charNegativePrompt,
  visualPromptEn,
  visualPromptZh,
  isManuallyModified,
  storyYear,
  era,
  styleId,
  referenceImageCount,
  selectedElements,
}: CharacterDataExportInput): string {
  const lines: string[] = [];
  const hasCalibrationData = Boolean(
    identityAnchors || charNegativePrompt || visualPromptEn || visualPromptZh,
  );

  lines.push(`角色名称: ${name || "(未填写)"}`);
  const genderLabel = GENDER_PRESETS.find((preset) => preset.id === gender)?.label;
  if (genderLabel) lines.push(`性别: ${genderLabel}`);
  const ageLabel = AGE_PRESETS.find((preset) => preset.id === age)?.label;
  if (ageLabel) lines.push(`年龄段: ${ageLabel}`);
  if (personality) lines.push(`性格特征: ${personality}`);

  if (description) {
    lines.push("");
    lines.push("角色描述:");
    lines.push(description);
  }

  if (hasCalibrationData) {
    lines.push("");
    lines.push(`AI 校准信息: ${isManuallyModified ? "已修改" : "已校准"}`);

    if (identityAnchors) {
      lines.push("");
      lines.push("--- 6层身份锚点 ---");

      const boneFeatures = [
        identityAnchors.faceShape,
        identityAnchors.jawline,
        identityAnchors.cheekbones,
      ].filter(Boolean);
      if (boneFeatures.length > 0) {
        lines.push(`① 骨相层: ${boneFeatures.join(", ")}`);
      }

      const facialFeatures = [
        identityAnchors.eyeShape,
        identityAnchors.eyeDetails,
        identityAnchors.noseShape,
        identityAnchors.lipShape,
      ].filter(Boolean);
      if (facialFeatures.length > 0) {
        lines.push(`② 五官层: ${facialFeatures.join(", ")}`);
      }

      if (identityAnchors.uniqueMarks?.length) {
        lines.push(`③ 辨识标记层: ${identityAnchors.uniqueMarks.join(", ")}`);
      }

      if (identityAnchors.colorAnchors) {
        const colors: string[] = [];
        if (identityAnchors.colorAnchors.iris) colors.push(`瞳色:${identityAnchors.colorAnchors.iris}`);
        if (identityAnchors.colorAnchors.hair) colors.push(`发色:${identityAnchors.colorAnchors.hair}`);
        if (identityAnchors.colorAnchors.skin) colors.push(`肤色:${identityAnchors.colorAnchors.skin}`);
        if (identityAnchors.colorAnchors.lips) colors.push(`唇色:${identityAnchors.colorAnchors.lips}`);
        if (colors.length > 0) {
          lines.push(`④ 色彩锚点层: ${colors.join(", ")}`);
        }
      }

      if (identityAnchors.skinTexture) {
        lines.push(`⑤ 皮肤纹理层: ${identityAnchors.skinTexture}`);
      }

      const hairFeatures = [
        identityAnchors.hairStyle,
        identityAnchors.hairlineDetails,
      ].filter(Boolean);
      if (hairFeatures.length > 0) {
        lines.push(`⑥ 发型锚点层: ${hairFeatures.join(", ")}`);
      }
    }

    if (charNegativePrompt) {
      lines.push("");
      lines.push("--- 负面提示词 ---");
      if (charNegativePrompt.avoid?.length) {
        lines.push(`避免: ${charNegativePrompt.avoid.join(", ")}`);
      }
      if (charNegativePrompt.styleExclusions?.length) {
        lines.push(`风格排除: ${charNegativePrompt.styleExclusions.join(", ")}`);
      }
    }

    if (visualPromptEn || visualPromptZh) {
      lines.push("");
      lines.push("--- 专业视觉提示词 ---");
      if (visualPromptEn) lines.push(`EN: ${visualPromptEn}`);
      if (visualPromptZh) lines.push(`ZH: ${visualPromptZh}`);
    }
  }

  if (storyYear || era) {
    lines.push("");
    lines.push("--- 年代信息 ---");
    if (storyYear) lines.push(`故事年份: ${storyYear}年`);
    if (era) lines.push(`时代背景: ${era}`);
  }

  const stylePreset = getStyleById(styleId);
  const styleLabel = stylePreset?.name || styleId;
  lines.push("");
  lines.push(`视觉风格: ${styleLabel}`);
  if (stylePreset?.prompt) {
    lines.push(`风格提示词: ${stylePreset.prompt.substring(0, 100)}...`);
  }

  if (referenceImageCount > 0) {
    lines.push(`参考图片: ${referenceImageCount} 张`);
  }

  const selectedSheetElements = selectedElements.flatMap((id) => {
    const element = SHEET_ELEMENTS.find((candidate) => candidate.id === id);
    return element ? [element] : [];
  });
  if (selectedSheetElements.length > 0) {
    lines.push(`生成内容: ${selectedSheetElements.map((element) => element.label).join(", ")}`);
    lines.push(`内容提示词: ${selectedSheetElements.map((element) => element.prompt).join(", ")}`);
  }

  return lines.join("\n");
}
