// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptScene, Shot } from "@/types/script";
import { usePropertyPanelCopyActions } from "./use-property-panel-copy-actions";

const writeText = vi.fn(async (_text: string): Promise<void> => undefined);

describe("usePropertyPanelCopyActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("copies scene metadata using the selected prompt language", async () => {
    const scene = {
      id: "scene-1",
      name: "雨夜街口",
      location: "旧镇街口",
      time: "夜",
      atmosphere: "雨",
      visualPrompt: "水墨雨夜街口",
      visualPromptEn: "ink wash rainy street",
    } as unknown as ScriptScene;
    const { result } = renderHook(() => usePropertyPanelCopyActions({
      scene,
      episodeShots: [],
      promptLanguage: "zh",
    }));

    await act(async () => result.current.handleCopySceneData());

    const copiedText = String(writeText.mock.calls[0]?.[0]);
    expect(copiedText).toContain("# 场景设定：雨夜街口");
    expect(copiedText).toContain("中文：水墨雨夜街口");
    expect(copiedText).not.toContain("ink wash rainy street");
    expect(result.current.copiedScene).toBe(true);
  });

  it("copies the shot tri-prompt contract including explicit no-dialogue text", async () => {
    const shot = {
      id: "shot-1",
      index: 1,
      shotSize: "MS",
      dialogue: "",
      imagePromptZh: "首帧画面",
      videoPromptZh: "人物转身",
      needsEndFrame: false,
    } as unknown as Shot;
    const { result } = renderHook(() => usePropertyPanelCopyActions({
      shot,
      episodeShots: [],
      promptLanguage: "zh",
    }));

    await act(async () => result.current.handleCopyShotTriPrompts());

    const copiedText = String(writeText.mock.calls[0]?.[0]);
    expect(copiedText).toContain("对白: 无");
    expect(copiedText).toContain("中文: 首帧画面");
    expect(copiedText).toContain("需要尾帧: ✗ 否");
    expect(result.current.copiedShotPrompts).toBe(true);
  });
});
