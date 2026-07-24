// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptData, Shot } from "@/types/script";

const toast = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

import { useScriptNavigation } from "./use-script-navigation";

const scriptData = {
  characters: [{
    id: "character-1",
    name: "谢乘风",
    role: "主角",
    visualPromptZh: "玄衣青年",
    stageInfo: { stageName: "青年期", episodeRange: [3, 5], ageDescription: "25岁" },
    consistencyElements: { facialFeatures: "剑眉", bodyType: "修长", uniqueMarks: "左眉痣" },
  }],
  scenes: [{
    id: "scene-1",
    name: "雨夜城门",
    location: "城门",
    time: "夜",
    atmosphere: "肃杀",
    architectureStyle: "古城",
  }],
  episodes: [],
} as unknown as ScriptData;

const shots = [{
  id: "shot-1",
  index: 1,
  sceneRefId: "scene-1",
  actionSummary: "谢乘风抬头望向城楼",
  dialogue: "开门。",
  characterNames: ["谢乘风", "守卫"],
}, {
  id: "shot-2",
  index: 2,
  sceneRefId: "scene-1",
  actionSummary: "守卫后退",
  characterNames: ["守卫"],
}] as Shot[];

function createOptions() {
  return {
    scriptData,
    shots,
    styleId: "ink",
    promptLanguage: "zh" as const,
    projectBackground: {
      title: "道劫",
      outline: "",
      characterBios: "",
      storyStartYear: 2002,
      era: "现代",
    },
    activeEpisodeIndex: 3,
    activeEpisodeId: "episode-3",
    setActiveTab: vi.fn(),
    selectLibraryCharacter: vi.fn(),
    goToCharacterWithData: vi.fn(),
    goToSceneWithData: vi.fn(),
    goToDirectorWithData: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useScriptNavigation", () => {
  it("passes unlinked character metadata and episode scope to the character library", () => {
    const options = createOptions();
    const { result } = renderHook(() => useScriptNavigation(options));

    act(() => result.current.handleGoToCharacterLibrary("character-1"));

    expect(options.goToCharacterWithData).toHaveBeenCalledWith(expect.objectContaining({
      name: "谢乘风",
      role: "主角",
      visualPromptZh: "玄衣青年",
      storyYear: 2002,
      era: "现代",
      sourceEpisodeIndex: 3,
      sourceEpisodeId: "episode-3",
      stageInfo: { stageName: "青年期", episodeRange: [3, 5], ageDescription: "25岁" },
      consistencyElements: { facialFeatures: "剑眉", bodyType: "修长", uniqueMarks: "左眉痣" },
    }));
  });

  it("passes calibrated scene fields through the simple scene path", () => {
    const options = createOptions();
    const { result } = renderHook(() => useScriptNavigation(options));

    act(() => result.current.handleGoToSceneLibrary("scene-1"));

    expect(options.goToSceneWithData).toHaveBeenCalledWith(expect.objectContaining({
      name: "雨夜城门",
      location: "城门",
      architectureStyle: "古城",
      promptLanguage: "zh",
      sourceEpisodeId: "episode-3",
    }));
  });

  it("builds a single-shot director payload without changing its source contract", () => {
    const options = createOptions();
    const { result } = renderHook(() => useScriptNavigation(options));

    act(() => result.current.handleGoToDirector("shot-1"));

    expect(options.goToDirectorWithData).toHaveBeenCalledWith(expect.objectContaining({
      storyPrompt: expect.stringContaining("动作：谢乘风抬头望向城楼"),
      characterNames: ["谢乘风", "守卫"],
      shotId: "shot-1",
      sceneCount: 1,
      sourceType: "shot",
    }));
  });

  it("aggregates scene shots and deduplicates director character names", () => {
    const options = createOptions();
    const { result } = renderHook(() => useScriptNavigation(options));

    act(() => result.current.handleGoToDirectorFromScene("scene-1"));

    expect(options.goToDirectorWithData).toHaveBeenCalledWith(expect.objectContaining({
      storyPrompt: expect.stringContaining("[分镜2]"),
      characterNames: ["谢乘风", "守卫"],
      sceneCount: 2,
      sourceType: "scene",
      sourceEpisodeIndex: 3,
    }));
  });
});
