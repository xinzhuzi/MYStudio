import type { QuadVariationType } from "@/components/quad-grid";
import type { SplitScene } from "@/stores/director-store";

export type QuadGridPromptOptions = {
  scene: SplitScene;
  variationType: QuadVariationType;
  useCharacterRef: boolean;
  aspect: "16:9" | "9:16";
  styleTokens?: string[];
  emotionDescription?: string;
  includeDialogueBoxConstraint?: boolean;
};

export type QuadGridPrompt = {
  variationLabels: string[];
  prompt: string;
};

const VARIATION_LABELS = {
  angle: ["正面偏左", "正面偏右", "侧面特写", "全景俯瞰"],
  composition: ["全身远景", "半身中景", "面部特写", "环境交代"],
  moment: ["动作起始", "动作过程", "动作高潮", "动作结束"],
} as const;

const VARIATION_PROMPTS = {
  angle: ["slight left angle view", "slight right angle view", "side profile close-up", "wide aerial overview"],
  composition: ["full body wide shot", "medium shot waist up", "close-up face", "establishing shot with environment"],
  moment: ["action beginning", "action in progress", "action climax", "action ending"],
} as const;

export function buildStoryboardQuadGridPrompt({
  scene,
  variationType,
  useCharacterRef,
  aspect,
  styleTokens = [],
  emotionDescription = "",
  includeDialogueBoxConstraint = false,
}: QuadGridPromptOptions): QuadGridPrompt {
  const basePrompt = scene.imagePromptZh?.trim()
    || scene.imagePrompt?.trim()
    || scene.videoPromptZh?.trim()
    || scene.videoPrompt?.trim()
    || "";
  const characterCount = scene.characterIds?.length || 0;
  const characterCountPhrase = !useCharacterRef
    ? "Keep the EXACT same number of characters and their positions as the reference image. Do NOT add or remove characters. Maintain the original character composition."
    : characterCount === 0
      ? "NO human figures in any panel, empty scene or environment only."
      : characterCount === 1
        ? "EXACTLY ONE person in each panel, single character only, do NOT duplicate the character."
        : `EXACTLY ${characterCount} distinct people in each panel, no more no less, each person appears only ONCE.`;
  const verticalConstraint = aspect === "9:16"
    ? "vertical composition, tighter framing, avoid letterboxing, "
    : "";
  const actionDescription = scene.actionSummary?.trim() || "";
  const actionContext = variationType === "moment" && actionDescription
    ? `Action sequence context: ${actionDescription}. `
    : "";
  const moodContext = emotionDescription ? `Mood across all panels: ${emotionDescription} ` : "";
  const sceneContext = [scene.sceneName, scene.sceneLocation].filter(Boolean).join(" - ");
  const settingContext = sceneContext ? `Setting: ${sceneContext}. ` : "";
  const styleContext = styleTokens.length > 0
    ? `Artistic style consistent: ${styleTokens.join(", ")}. `
    : "";

  const promptParts = [
    "Generate a 2x2 grid image with 4 panels, each panel separated by thin white lines.",
    "Layout: 2 rows, 2 columns, reading order left-to-right, top-to-bottom.",
  ];
  VARIATION_PROMPTS[variationType].forEach((variationPrompt, index) => {
    const row = Math.floor(index / 2) + 1;
    const column = (index % 2) + 1;
    promptParts.push(
      `Panel [row ${row}, col ${column}]: ${verticalConstraint}${characterCountPhrase} ${basePrompt}, ${variationPrompt}`,
    );
  });
  if (settingContext) promptParts.push(settingContext);
  if (actionContext) promptParts.push(actionContext);
  if (moodContext) promptParts.push(moodContext);
  if (styleContext) promptParts.push(styleContext);
  promptParts.push("Keep character appearance, wardrobe and facial features consistent across all 4 panels.");
  promptParts.push("Keep lighting and color grading consistent across all 4 panels.");
  promptParts.push(
    includeDialogueBoxConstraint
      ? "IMPORTANT: NO TEXT, NO WORDS, NO LETTERS, NO CAPTIONS, NO SPEECH BUBBLES, NO DIALOGUE BOXES, NO SUBTITLES, NO WRITING of any kind in any panel."
      : "IMPORTANT: NO TEXT, NO WORDS, NO LETTERS, NO CAPTIONS, NO SPEECH BUBBLES, NO SUBTITLES, NO WRITING of any kind in any panel.",
  );

  return {
    variationLabels: [...VARIATION_LABELS[variationType]],
    prompt: promptParts.join(" "),
  };
}
