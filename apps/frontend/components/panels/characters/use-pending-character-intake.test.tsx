// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PendingCharacterData } from "@/stores/media-panel-store";

const mocks = vi.hoisted(() => ({
  getStyleById: vi.fn(),
}));

vi.mock("@/lib/constants/visual-styles", () => ({
  getStyleById: mocks.getStyleById,
}));

import { usePendingCharacterIntake } from "./use-pending-character-intake";

function createOptions(data: PendingCharacterData) {
  const setter = () => vi.fn();
  return {
    pendingCharacterData: data,
    setPendingCharacterData: vi.fn(),
    setName: setter(),
    setGender: setter(),
    setAge: setter(),
    setPersonality: setter(),
    setRole: setter(),
    setTraits: setter(),
    setSkills: setter(),
    setKeyActions: setter(),
    setAppearance: setter(),
    setRelationships: setter(),
    setDescription: setter(),
    setTags: setter(),
    setNotes: setter(),
    setPromptLanguage: setter(),
    setVisualPromptEn: setter(),
    setVisualPromptZh: setter(),
    setIdentityAnchors: setter(),
    setCharNegativePrompt: setter(),
    setStoryYear: setter(),
    setEra: setter(),
    setSourceEpisodeId: setter(),
    setStyleId: setter(),
  };
}

describe("usePendingCharacterIntake", () => {
  it("maps incoming script character data and consumes it after initializing the form", () => {
    mocks.getStyleById.mockReturnValue({ id: "ink" });
    const data: PendingCharacterData = {
      name: "沈砚",
      gender: "男",
      age: "25-30岁",
      personality: "克制",
      role: "游侠",
      traits: "谨慎",
      skills: "剑术",
      keyActions: "护送商队",
      appearance: "黑衣佩剑",
      relationships: "与阿岚同行",
      tags: ["主角"],
      notes: "来自第一集",
      promptLanguage: "zh",
      visualPromptEn: "stoic swordsman",
      visualPromptZh: "冷峻剑客",
      identityAnchors: { uniqueMarks: ["眉间剑痕"] },
      negativePrompt: { avoid: ["模糊"] },
      storyYear: 1990,
      era: "现代",
      sourceEpisodeId: "episode-1",
      styleId: "ink",
    };
    const options = createOptions(data);

    renderHook(() => usePendingCharacterIntake(options));

    expect(options.setName).toHaveBeenCalledWith("沈砚");
    expect(options.setGender).toHaveBeenCalledWith("male");
    expect(options.setAge).toHaveBeenCalledWith("young-adult");
    expect(options.setDescription).toHaveBeenCalledWith([
      "【身份/背景】\n游侠",
      "【核心特质】\n谨慎",
      "【技能/能力】\n剑术",
      "【关键事迹】\n护送商队",
      "【外貌特征】\n黑衣佩剑",
      "【人物关系】\n与阿岚同行",
    ].join("\n\n"));
    expect(options.setTags).toHaveBeenCalledWith(["主角"]);
    expect(options.setVisualPromptZh).toHaveBeenCalledWith("冷峻剑客");
    expect(options.setIdentityAnchors).toHaveBeenCalledWith(data.identityAnchors);
    expect(options.setCharNegativePrompt).toHaveBeenCalledWith(data.negativePrompt);
    expect(options.setSourceEpisodeId).toHaveBeenCalledWith("episode-1");
    expect(options.setStyleId).toHaveBeenCalledWith("ink");
    expect(options.setPendingCharacterData).toHaveBeenCalledWith(null);
  });

  it("preserves existing optional form state when the incoming data omits it", () => {
    const options = createOptions({ name: "阿岚", gender: "女", age: "儿童" });

    renderHook(() => usePendingCharacterIntake(options));

    expect(options.setName).toHaveBeenCalledWith("阿岚");
    expect(options.setGender).toHaveBeenCalledWith("female");
    expect(options.setAge).toHaveBeenCalledWith("child");
    expect(options.setDescription).not.toHaveBeenCalled();
    expect(options.setTags).not.toHaveBeenCalled();
    expect(options.setVisualPromptEn).not.toHaveBeenCalled();
    expect(options.setIdentityAnchors).not.toHaveBeenCalled();
    expect(options.setStyleId).not.toHaveBeenCalled();
    expect(options.setSourceEpisodeId).toHaveBeenCalledWith(undefined);
    expect(options.setPendingCharacterData).toHaveBeenCalledWith(null);
  });
});
