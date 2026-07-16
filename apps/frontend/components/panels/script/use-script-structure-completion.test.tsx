// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptData } from "@/types/script";

const importSingleEpisodeContent = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/script/full-script-service", () => ({ importSingleEpisodeContent }));
vi.mock("sonner", () => ({ toast }));

import { useScriptStructureCompletion } from "./use-script-structure-completion";

function createScriptData(sceneIds: string[] = []): ScriptData {
  return {
    title: "Test",
    language: "zh",
    characters: [],
    scenes: [],
    episodes: [{ id: "episode-1", index: 0, title: "Episode 1", sceneIds }],
    storyParagraphs: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useScriptStructureCompletion", () => {
  it("automatically imports a short-to-long episode transition when no scenes exist", async () => {
    importSingleEpisodeContent.mockResolvedValue({ success: true, sceneCount: 2 });
    const setStatus = vi.fn();
    const { rerender } = renderHook(
      ({ rawScript }) => useScriptStructureCompletion({
        projectId: "project-1",
        activeEpisodeIndex: 0,
        effectiveRawScript: rawScript,
        scriptData: createScriptData(),
        status: "idle",
        setStatus,
      }),
      { initialProps: { rawScript: "short" } },
    );

    rerender({ rawScript: "A".repeat(60) });

    await waitFor(() => expect(importSingleEpisodeContent).toHaveBeenCalledWith(
      "A".repeat(60),
      0,
      "project-1",
    ));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("completed"));
    expect(toast.success).toHaveBeenCalledWith("结构补全完成：解析出 2 个场景");
  });

  it("asks for confirmation instead of replacing an existing episode structure", () => {
    const { result, rerender } = renderHook(
      ({ rawScript }) => useScriptStructureCompletion({
        projectId: "project-1",
        activeEpisodeIndex: 0,
        effectiveRawScript: rawScript,
        scriptData: createScriptData(["scene-1"]),
        status: "idle",
        setStatus: vi.fn(),
      }),
      { initialProps: { rawScript: "short" } },
    );

    rerender({ rawScript: "B".repeat(60) });

    expect(result.current.overwriteConfirmOpen).toBe(true);
    expect(importSingleEpisodeContent).not.toHaveBeenCalled();
  });

  it("exposes failures and resets status after three seconds", async () => {
    vi.useFakeTimers();
    importSingleEpisodeContent.mockResolvedValue({ success: false, sceneCount: 0, error: "parse failed" });
    const setStatus = vi.fn();
    const { result } = renderHook(() => useScriptStructureCompletion({
      projectId: "project-1",
      activeEpisodeIndex: 0,
      effectiveRawScript: "C".repeat(60),
      scriptData: createScriptData(),
      status: "idle",
      setStatus,
    }));

    await act(async () => result.current.completeStructure());
    expect(setStatus).toHaveBeenCalledWith("processing");
    expect(setStatus).toHaveBeenCalledWith("error");
    expect(toast.error).toHaveBeenCalledWith("parse failed");

    act(() => vi.advanceTimersByTime(3000));
    expect(setStatus).toHaveBeenLastCalledWith("idle");
  });
});
