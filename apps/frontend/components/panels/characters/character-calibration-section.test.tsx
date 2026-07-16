// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CharacterIdentityAnchors, CharacterNegativePrompt } from "@/types/script";
import { CharacterCalibrationSection } from "./character-calibration-section";

afterEach(cleanup);

function setup(options?: { expanded?: boolean; isGenerating?: boolean; language?: "zh" | "en" }) {
  const setIdentityAnchors = vi.fn();
  const setCharNegativePrompt = vi.fn();
  const setVisualPromptEn = vi.fn();
  const setVisualPromptZh = vi.fn();
  const setCalibrationExpanded = vi.fn();
  const setIsManuallyModified = vi.fn();
  render(
    <CharacterCalibrationSection
      hasCalibrationData
      identityAnchors={{ faceShape: "椭圆", uniqueMarks: ["痣"] } as CharacterIdentityAnchors}
      setIdentityAnchors={setIdentityAnchors}
      charNegativePrompt={{ avoid: ["模糊"] } as CharacterNegativePrompt}
      setCharNegativePrompt={setCharNegativePrompt}
      visualPromptEn="English portrait"
      setVisualPromptEn={setVisualPromptEn}
      visualPromptZh="中文肖像"
      setVisualPromptZh={setVisualPromptZh}
      promptLanguage={options?.language || "zh"}
      calibrationExpanded={options?.expanded ?? true}
      setCalibrationExpanded={setCalibrationExpanded}
      isManuallyModified={false}
      setIsManuallyModified={setIsManuallyModified}
      isGenerating={options?.isGenerating || false}
    />,
  );
  return { setIdentityAnchors, setVisualPromptEn, setVisualPromptZh, setCalibrationExpanded, setIsManuallyModified };
}

describe("CharacterCalibrationSection", () => {
  it("updates identity anchors and the active localized prompt", () => {
    const callbacks = setup();
    fireEvent.change(screen.getByPlaceholderText("脸型"), { target: { value: "方" } });
    expect(callbacks.setIdentityAnchors).toHaveBeenCalledWith(expect.objectContaining({ faceShape: "方" }));
    fireEvent.change(screen.getByPlaceholderText("中文提示词"), { target: { value: "新肖像" } });
    expect(callbacks.setVisualPromptZh).toHaveBeenCalledWith("新肖像");
    expect(callbacks.setVisualPromptEn).not.toHaveBeenCalled();
    expect(callbacks.setIsManuallyModified).toHaveBeenCalledWith(true);
  });

  it("keeps the accordion disabled during generation", () => {
    const callbacks = setup({ expanded: false, isGenerating: true });
    const toggle = screen.getByRole("button", { name: /AI 校准信息/ });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(callbacks.setCalibrationExpanded).not.toHaveBeenCalled();
  });
});
