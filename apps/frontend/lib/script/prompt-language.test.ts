import { describe, expect, it } from "vitest";
import type { Shot } from "@/types/script";
import { applyPromptLanguageToShotPrompts } from "./prompt-language";

const shot = {
  visualPrompt: "old visual",
  imagePrompt: "old image",
  imagePromptZh: "旧图片",
  videoPrompt: "old video",
  videoPromptZh: "旧视频",
  endFramePrompt: "old end",
  endFramePromptZh: "旧尾帧",
} as Shot;
const calibration = { imagePrompt: "new image", imagePromptZh: "新图片", videoPrompt: "" };

describe("applyPromptLanguageToShotPrompts", () => {
  it("keeps only Chinese fields for zh", () => {
    expect(applyPromptLanguageToShotPrompts(shot, calibration, "zh")).toEqual({
      visualPrompt: undefined,
      imagePrompt: undefined,
      imagePromptZh: "新图片",
      videoPrompt: undefined,
      videoPromptZh: "旧视频",
      endFramePrompt: undefined,
      endFramePromptZh: "旧尾帧",
    });
  });

  it("keeps only English fields for en and falls back on empty calibration", () => {
    expect(applyPromptLanguageToShotPrompts(shot, calibration, "en")).toEqual({
      visualPrompt: "old visual",
      imagePrompt: "new image",
      imagePromptZh: undefined,
      videoPrompt: "old video",
      videoPromptZh: undefined,
      endFramePrompt: "old end",
      endFramePromptZh: undefined,
    });
  });

  it("preserves both languages by default", () => {
    expect(applyPromptLanguageToShotPrompts(shot, calibration)).toMatchObject({
      imagePrompt: "new image",
      imagePromptZh: "新图片",
      videoPrompt: "old video",
      videoPromptZh: "旧视频",
    });
  });
});
