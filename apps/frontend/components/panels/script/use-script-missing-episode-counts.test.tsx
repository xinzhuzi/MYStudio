// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptImportStatus } from "@/stores/script-store";
import type { EpisodeRawScript } from "@/types/script";
import {
  getMissingSynopsisEpisodes,
  getMissingTitleEpisodes,
} from "@/lib/script/full-script-service";
import { useScriptMissingEpisodeCounts } from "./use-script-missing-episode-counts";

vi.mock("@/lib/script/full-script-service", () => ({
  getMissingSynopsisEpisodes: vi.fn(),
  getMissingTitleEpisodes: vi.fn(),
}));

type HookProps = {
  importStatus: ScriptImportStatus;
  projectId: string;
  episodeRawScripts: EpisodeRawScript[];
};

describe("useScriptMissingEpisodeCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads both counts when the import is ready and refreshes on episode-array replacement", async () => {
    vi.mocked(getMissingTitleEpisodes).mockReturnValue([{ episodeIndex: 1 }] as never);
    vi.mocked(getMissingSynopsisEpisodes).mockReturnValue([{ episodeIndex: 2 }, { episodeIndex: 3 }] as never);
    const { result, rerender } = renderHook(
      (props: HookProps) => useScriptMissingEpisodeCounts(props),
      { initialProps: { importStatus: "ready", projectId: "project-1", episodeRawScripts: [] } },
    );

    await waitFor(() => expect(result.current.missingTitleCount).toBe(1));
    expect(result.current.missingSynopsisCount).toBe(2);

    vi.mocked(getMissingTitleEpisodes).mockReturnValue([{ episodeIndex: 1 }, { episodeIndex: 2 }] as never);
    vi.mocked(getMissingSynopsisEpisodes).mockReturnValue([] as never);
    rerender({ importStatus: "ready", projectId: "project-1", episodeRawScripts: [] });

    await waitFor(() => expect(result.current.missingTitleCount).toBe(2));
    expect(result.current.missingSynopsisCount).toBe(0);
    expect(getMissingTitleEpisodes).toHaveBeenCalledTimes(2);
    expect(getMissingSynopsisEpisodes).toHaveBeenCalledTimes(2);
  });

  it("preserves existing counts while its ready-and-project gate is false", async () => {
    vi.mocked(getMissingTitleEpisodes).mockReturnValue([{ episodeIndex: 1 }] as never);
    vi.mocked(getMissingSynopsisEpisodes).mockReturnValue([{ episodeIndex: 1 }] as never);
    const { result, rerender } = renderHook(
      (props: HookProps) => useScriptMissingEpisodeCounts(props),
      { initialProps: { importStatus: "ready", projectId: "project-1", episodeRawScripts: [] } },
    );

    await waitFor(() => expect(result.current.missingTitleCount).toBe(1));
    rerender({ importStatus: "idle", projectId: "project-1", episodeRawScripts: [] });

    expect(result.current.missingTitleCount).toBe(1);
    expect(result.current.missingSynopsisCount).toBe(1);
    expect(getMissingTitleEpisodes).toHaveBeenCalledTimes(1);
    expect(getMissingSynopsisEpisodes).toHaveBeenCalledTimes(1);
  });

  it("does not query services without a project id", () => {
    const { result } = renderHook(() => useScriptMissingEpisodeCounts({
      importStatus: "ready",
      projectId: "",
      episodeRawScripts: [],
    }));

    expect(result.current.missingTitleCount).toBe(0);
    expect(result.current.missingSynopsisCount).toBe(0);
    expect(getMissingTitleEpisodes).not.toHaveBeenCalled();
    expect(getMissingSynopsisEpisodes).not.toHaveBeenCalled();
  });
});
