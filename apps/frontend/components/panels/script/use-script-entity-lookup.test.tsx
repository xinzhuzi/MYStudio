// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { findCharacterByDescription } from "@/lib/script/ai-character-finder";
import { findSceneByDescription } from "@/lib/script/ai-scene-finder";
import { useScriptEntityLookup } from "./use-script-entity-lookup";

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { featureConfig: vi.fn() } }));
vi.mock("@/lib/script/ai-character-finder", () => ({ findCharacterByDescription: vi.fn() }));
vi.mock("@/lib/script/ai-scene-finder", () => ({ findSceneByDescription: vi.fn() }));

describe("useScriptEntityLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("reports missing configuration before lookup", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue(null);
    const { result } = renderHook(() => useScriptEntityLookup({ episodes: [], characters: [], scenes: [] }));
    await expect(result.current.handleAIFindCharacter("阿青")).resolves.toEqual({
      found: false, name: "", message: "请先配置 AI 接口",
    });
    expect(findCharacterByDescription).not.toHaveBeenCalled();
  });

  it("passes configured character lookup context", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({ allApiKeys: ["k1", "k2"], platform: "openai", baseUrl: "https://api.test" } as never);
    vi.mocked(findCharacterByDescription).mockResolvedValue({ found: true, name: "阿青", message: "找到", character: { id: "c1", name: "阿青" } } as never);
    const background = { title: "道劫" } as never;
    const { result } = renderHook(() => useScriptEntityLookup({ background, episodes: [], characters: [], scenes: [] }));
    await expect(result.current.handleAIFindCharacter("青衣女子")).resolves.toMatchObject({ found: true, name: "阿青" });
    expect(findCharacterByDescription).toHaveBeenCalledWith("青衣女子", background, [], [], {
      apiKey: "k1,k2", provider: "openai", baseUrl: "https://api.test",
    });
  });

  it("returns the established scene failure result", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({ allApiKeys: ["k"], platform: "openai" } as never);
    vi.mocked(findSceneByDescription).mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useScriptEntityLookup({ background: { title: "道劫" } as never, episodes: [], characters: [], scenes: [] }));
    await expect(result.current.handleAIFindScene("矿场")).resolves.toEqual({ found: false, message: "查找失败，请重试" });
  });
});
