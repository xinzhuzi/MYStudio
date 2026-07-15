import type { PromptLanguage, Shot } from "@/types/script";

type ShotPromptFields = Pick<
  Shot,
  "visualPrompt" | "imagePrompt" | "imagePromptZh" | "videoPrompt" | "videoPromptZh" | "endFramePrompt" | "endFramePromptZh"
>;

export function applyPromptLanguageToShotPrompts(
  existingShot: Shot,
  calibration: Record<string, unknown>,
  promptLanguage: PromptLanguage = "zh+en",
): ShotPromptFields {
  const value = (field: keyof ShotPromptFields) => (
    typeof calibration[field] === "string" && calibration[field]
      ? calibration[field] as string
      : existingShot[field]
  );
  if (promptLanguage === "zh") {
    return {
      visualPrompt: undefined,
      imagePrompt: undefined,
      imagePromptZh: value("imagePromptZh"),
      videoPrompt: undefined,
      videoPromptZh: value("videoPromptZh"),
      endFramePrompt: undefined,
      endFramePromptZh: value("endFramePromptZh"),
    };
  }
  if (promptLanguage === "en") {
    return {
      visualPrompt: value("visualPrompt"),
      imagePrompt: value("imagePrompt"),
      imagePromptZh: undefined,
      videoPrompt: value("videoPrompt"),
      videoPromptZh: undefined,
      endFramePrompt: value("endFramePrompt"),
      endFramePromptZh: undefined,
    };
  }
  return {
    visualPrompt: value("visualPrompt"),
    imagePrompt: value("imagePrompt"),
    imagePromptZh: value("imagePromptZh"),
    videoPrompt: value("videoPrompt"),
    videoPromptZh: value("videoPromptZh"),
    endFramePrompt: value("endFramePrompt"),
    endFramePromptZh: value("endFramePromptZh"),
  };
}
