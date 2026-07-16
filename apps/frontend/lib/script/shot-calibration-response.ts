export interface ShotCalibrationResponse {
  [key: string]: unknown;
  visualDescription: string;
  visualPrompt: string;
  imagePrompt: string;
  imagePromptZh: string;
  videoPrompt: string;
  videoPromptZh: string;
  endFramePrompt: string;
  endFramePromptZh: string;
  needsEndFrame: boolean;
  shotSize: string;
  cameraMovement: string;
  duration: number;
  emotionTags: string[];
  characterNames: string[];
  ambientSound: string;
  soundEffect: string;
  narrativeFunction: string;
  conflictStage?: string;
  shotPurpose: string;
  storyAlignment?: string;
  visualFocus: string;
  cameraPosition: string;
  characterBlocking: string;
  rhythm: string;
  lightingStyle?: string;
  lightingDirection?: string;
  colorTemperature?: string;
  lightingNotes?: string;
  depthOfField?: string;
  focusTarget?: string;
  focusTransition?: string;
  cameraRig?: string;
  movementSpeed?: string;
  atmosphericEffects?: string[];
  effectIntensity?: string;
  playbackSpeed?: string;
  cameraAngle?: string;
  focalLength?: string;
  photographyTechnique?: string;
  specialTechnique?: string;
}

export function parseShotCalibrationResponse(
  result: string,
): Record<string, ShotCalibrationResponse> {
  try {
    let cleaned = result
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }
    const parsed = JSON.parse(cleaned) as { shots?: Record<string, ShotCalibrationResponse> };
    return parsed.shots || {};
  } catch (error) {
    console.error("[calibrateShots] Failed to parse AI response:", result);
    console.error("[calibrateShots] Parse error:", error);

    const partialResult: Record<string, ShotCalibrationResponse> = {};
    const shotPattern = /"(shot_[^"]+)"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g;
    let match: RegExpExecArray | null;
    while ((match = shotPattern.exec(result)) !== null) {
      try {
        partialResult[match[1]] = JSON.parse(match[2]) as ShotCalibrationResponse;
      } catch {
        // A malformed shot does not prevent recovery of later complete shots.
      }
    }
    if (Object.keys(partialResult).length > 0) {
      console.log(`[calibrateShots] 部分解析成功，恢复了 ${Object.keys(partialResult).length} 个分镜`);
      return partialResult;
    }
    throw new Error("解析 AI 响应失败");
  }
}
