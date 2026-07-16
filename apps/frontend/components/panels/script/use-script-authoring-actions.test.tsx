// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { generateScriptFromIdea, generateShotList, parseScript } from "@/lib/script/script-parser";
import { toast } from "sonner";
import { useScriptAuthoringActions } from "./use-script-authoring-actions";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { featureConfig: vi.fn(), featureNotConfiguredMessage: vi.fn(() => "未配置") },
}));
vi.mock("@/lib/script/script-parser", () => ({
  generateScriptFromIdea: vi.fn(),
  generateShotList: vi.fn(),
  parseScript: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function renderActions(overrides: Record<string, unknown> = {}) {
  const callbacks = {
    setRawScript: vi.fn(),
    setParseStatus: vi.fn(),
    setScriptData: vi.fn(),
    setShots: vi.fn(),
    setShotStatus: vi.fn(),
    importFullScript: vi.fn(async () => undefined),
  };
  const options = {
    projectId: "project-1",
    rawScript: "场景：矿场",
    language: "中文",
    targetDuration: "60s",
    styleId: "ink",
    scriptData: null,
    libraryCharacters: [],
    ...callbacks,
    ...overrides,
  };
  return { ...renderHook(() => useScriptAuthoringActions(options as never)), callbacks };
}

describe("useScriptAuthoringActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("preserves missing-config parse exit", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue(null);
    const { result, callbacks } = renderActions();
    await result.current.handleParse();
    expect(toast.error).toHaveBeenCalledWith("未配置");
    expect(callbacks.setParseStatus).not.toHaveBeenCalled();
  });

  it("generates an idea and reuses the full import workflow", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({
      allApiKeys: ["k"], platform: "openai", baseUrl: "https://api.test", models: ["model-1"],
    } as never);
    vi.mocked(generateScriptFromIdea).mockResolvedValue("生成的剧本");
    const { result, callbacks } = renderActions();
    await result.current.handleGenerateFromIdea("矿奴觉醒");
    expect(callbacks.setRawScript).toHaveBeenCalledWith("project-1", "生成的剧本");
    expect(callbacks.importFullScript).toHaveBeenCalledWith("生成的剧本");
  });

  it("parses structure and streams reindexed shots", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({
      allApiKeys: ["k"], platform: "openai", baseUrl: "https://api.test", models: ["model-1"],
    } as never);
    const data = {
      title: "道劫",
      characters: [{ id: "char-1", name: "江临" }],
      scenes: [{ id: "scene-1", name: "矿场", location: "矿场", time: "夜", atmosphere: "压抑" }],
      episodes: [],
    };
    vi.mocked(parseScript).mockResolvedValue(data as never);
    vi.mocked(generateShotList).mockImplementation(async (_data, _options, _progress, onShots) => {
      onShots?.([{ id: "old", index: 9, actionSummary: "抬头" } as never], 0);
      return [{ id: "final", index: 1, actionSummary: "抬头" } as never];
    });
    const { result, callbacks } = renderActions();

    await result.current.handleParse();

    expect(callbacks.setScriptData).toHaveBeenCalledWith("project-1", expect.objectContaining({
      episodes: [expect.objectContaining({ id: "default", sceneIds: ["scene-1"] })],
    }));
    expect(callbacks.setShots).toHaveBeenCalledWith("project-1", [expect.objectContaining({ id: "shot-1", index: 1 })]);
    expect(callbacks.setShotStatus).toHaveBeenLastCalledWith("project-1", "ready");
  });
});
