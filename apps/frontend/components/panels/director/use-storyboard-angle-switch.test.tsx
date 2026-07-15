// @vitest-environment jsdom

import { useRef } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryboardGenerationUi } from "./use-storyboard-generation-ui";
import { useStoryboardAngleSwitch } from "./use-storyboard-angle-switch";

const generateAngleSwitch = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/ai/runninghub-client", () => ({
  generateAngleSwitch: (...args: unknown[]) => generateAngleSwitch(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

const scene = {
  id: 4,
  imageDataUrl: "start-image",
  imageHttpUrl: null,
  endFrameImageUrl: "end-image",
  endFrameHttpUrl: null,
  startFrameAngleSwitchHistory: [] as Array<{ imageUrl: string; angleLabel: string; timestamp: number }>,
  endFrameAngleSwitchHistory: [] as Array<{ imageUrl: string; angleLabel: string; timestamp: number }>,
};

function useHarness(getLatestScenes: () => typeof scene[] = () => [scene]) {
  const controller = useStoryboardGenerationUi({ defaultImageGenMode: "merged" });
  const addHistory = useRef(vi.fn()).current;
  const actions = useStoryboardAngleSwitch({
    scenes: [scene],
    controller,
    getProviderByPlatform: () => ({
      id: "runninghub",
      name: "RunningHub",
      platform: "runninghub",
      apiKey: "key",
      baseUrl: "https://runninghub.example",
      model: ["app-id"],
    }),
    addHistory,
    getLatestScenes,
  });
  return { controller, actions, addHistory };
}

describe("useStoryboardAngleSwitch", () => {
  beforeEach(() => {
    generateAngleSwitch.mockReset();
    toastError.mockReset();
  });

  it("opens only when the requested frame exists", () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.actions.openAngleSwitch(4, "end"));
    expect(result.current.controller.angleSwitchTarget).toEqual({ sceneId: 4, type: "end" });
    expect(result.current.controller.angleSwitchOpen).toBe(true);
  });

  it("persists generated history and selects the latest adapter snapshot", async () => {
    generateAngleSwitch.mockResolvedValue("generated-image");
    const latestScene = {
      ...scene,
      startFrameAngleSwitchHistory: [{ imageUrl: "generated-image", angleLabel: "label", timestamp: 1 }],
    };
    const { result } = renderHook(() => useHarness(() => [latestScene]));
    act(() => result.current.actions.openAngleSwitch(4, "start"));

    await act(async () => {
      await result.current.actions.generate({
        direction: "front",
        elevation: "eye-level",
        shotSize: "medium-shot",
        applyToSameScene: false,
        applyToAll: false,
      });
    });

    expect(result.current.addHistory).toHaveBeenCalledOnce();
    expect(result.current.controller.selectedHistoryIndex).toBe(0);
    expect(result.current.controller.angleSwitchResult?.newImage).toBe("generated-image");
    expect(result.current.controller.angleSwitchResultOpen).toBe(true);
  });

  it("closes the input dialog when RunningHub configuration is incomplete", async () => {
    const { result } = renderHook(() => {
      const controller = useStoryboardGenerationUi({ defaultImageGenMode: "merged" });
      const actions = useStoryboardAngleSwitch({
        scenes: [scene],
        controller,
        getProviderByPlatform: () => undefined,
        addHistory: vi.fn(),
        getLatestScenes: () => [scene],
      });
      return { controller, actions };
    });
    act(() => result.current.actions.openAngleSwitch(4, "start"));

    await act(async () => {
      await result.current.actions.generate({
        direction: "front",
        elevation: "eye-level",
        shotSize: "medium-shot",
        applyToSameScene: false,
        applyToAll: false,
      });
    });

    expect(result.current.controller.angleSwitchOpen).toBe(false);
    expect(toastError).toHaveBeenCalledWith("请先在设置中配置 RunningHub（API Key / Base URL / 模型AppId）");
  });
});
