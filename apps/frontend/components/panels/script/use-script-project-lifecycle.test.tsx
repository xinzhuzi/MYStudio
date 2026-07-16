// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScriptStore } from "@/stores/script-store";
import { useScriptProjectLifecycle } from "./use-script-project-lifecycle";

vi.mock("@/stores/script-store", () => ({
  useScriptStore: { getState: vi.fn() },
}));

describe("useScriptProjectLifecycle", () => {
  const setActiveProjectId = vi.fn();
  const ensureProject = vi.fn();
  const setCalibrationState = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useScriptStore.getState).mockReturnValue({ projects: {} } as never);
  });

  it("initializes the active project and resets interrupted work", () => {
    vi.mocked(useScriptStore.getState).mockReturnValue({
      projects: { p1: { calibrationState: { importStatus: "importing", synopsisStatus: "generating" } } },
    } as never);
    const { result } = renderHook(() => useScriptProjectLifecycle({
      activeProjectId: "p1", setActiveProjectId, ensureProject, setCalibrationState,
    }));

    expect(result.current.projectId).toBe("p1");
    expect(setActiveProjectId).toHaveBeenCalledWith("p1");
    expect(ensureProject).toHaveBeenCalledWith("p1");
    expect(setCalibrationState).toHaveBeenCalledWith("p1", {
      importStatus: "idle", synopsisStatus: "idle",
    });
  });

  it("keeps the last active project while the external selection is temporarily empty", () => {
    const options = { setActiveProjectId, ensureProject, setCalibrationState };
    const { result, rerender } = renderHook(
      ({ activeProjectId }: { activeProjectId: string | null }) => useScriptProjectLifecycle({ activeProjectId, ...options }),
      { initialProps: { activeProjectId: "p1" as string | null } },
    );
    rerender({ activeProjectId: null });
    expect(result.current.projectId).toBe("p1");

    act(() => result.current.setCharacterCalibrationStatus("calibrating"));
    expect(setCalibrationState).toHaveBeenLastCalledWith("p1", { characterCalibrationStatus: "calibrating" });
  });

  it("maps each status setter to its established calibration field", () => {
    const { result } = renderHook(() => useScriptProjectLifecycle({
      activeProjectId: null, setActiveProjectId, ensureProject, setCalibrationState,
    }));
    expect(result.current.projectId).toBe("default-project");
    act(() => {
      result.current.setProjectSynopsisStatus("generating");
      result.current.setImportStatus("ready");
      result.current.setCalibrationStatus("calibrating");
      result.current.setSceneCalibrationStatus("calibrating");
      result.current.setViewpointAnalysisStatus("analyzing");
    });
    expect(setCalibrationState.mock.calls).toEqual([
      ["default-project", { synopsisStatus: "generating" }],
      ["default-project", { importStatus: "ready" }],
      ["default-project", { titleCalibrationStatus: "calibrating" }],
      ["default-project", { sceneCalibrationStatus: "calibrating" }],
      ["default-project", { viewpointAnalysisStatus: "analyzing" }],
    ]);
  });
});
