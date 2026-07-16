// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SplitScene } from "@/stores/director-store";
import { useProjectStore } from "@/stores/project-store";
import { useSClassStore } from "@/stores/sclass-store";
import { useSClassGroupingController } from "./use-sclass-grouping-controller";
import { runBatchCalibration, runCalibration } from "./sclass-calibrator";

const mocks = vi.hoisted(() => ({
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock("./sclass-calibrator", () => ({
  runCalibration: vi.fn(),
  runBatchCalibration: vi.fn(),
}));

const scenes = [
  { id: 1, duration: 5, sceneName: "山门", characterIds: ["char-1"] },
  { id: 2, duration: 5, sceneName: "山门", characterIds: ["char-1"] },
] as SplitScene[];
const initialProjectState = useProjectStore.getState();

function renderController(
  initialScenes = scenes,
  generateGroupVideo = vi.fn().mockResolvedValue({ success: true }),
  setIsGenerating = vi.fn(),
) {
  return {
    ...renderHook(
      ({ splitScenes }) => useSClassGroupingController({
        splitScenes,
        allCharacters: [],
        sceneLibrary: [],
        generateGroupVideo,
        setIsGenerating,
      }),
      { initialProps: { splitScenes: initialScenes } },
    ),
    generateGroupVideo,
    setIsGenerating,
  };
}

describe("useSClassGroupingController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ activeProjectId: "project-1" });
    useSClassStore.getState().reset();
    useSClassStore.getState().setActiveProjectId("project-1");
  });

  afterEach(() => {
    cleanup();
    useSClassStore.getState().reset();
    useProjectStore.setState(initialProjectState, true);
  });

  it("auto-groups once and appends only newly added scenes", async () => {
    const hook = renderController();

    await waitFor(() => expect(hook.result.current.shotGroups).toHaveLength(1));
    expect(hook.result.current.shotGroups[0].sceneIds).toEqual([1, 2]);
    expect(useSClassStore.getState().getProjectData("project-1").hasAutoGrouped).toBe(true);

    hook.rerender({
      splitScenes: [
        ...scenes,
        { ...scenes[0], id: 3, sceneName: "大殿", characterIds: [] },
      ],
    });

    await waitFor(() => expect(hook.result.current.shotGroups).toHaveLength(2));
    expect(hook.result.current.shotGroups.map((group) => group.sceneIds)).toEqual([[1, 2], [3]]);
  });

  it("delegates batch and per-group calibration with the resolved group scenes", async () => {
    vi.mocked(runBatchCalibration).mockResolvedValue({ success: 1, total: 1 });
    vi.mocked(runCalibration).mockResolvedValue(true);
    const hook = renderController();
    await waitFor(() => expect(hook.result.current.shotGroups).toHaveLength(1));
    const groupId = hook.result.current.shotGroups[0].id;

    await act(async () => {
      await hook.result.current.batchCalibrate();
      await hook.result.current.calibrateGroup(groupId);
    });

    expect(runBatchCalibration).toHaveBeenCalledWith(scenes, [], []);
    expect(runCalibration).toHaveBeenCalledWith(groupId, scenes, [], []);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("批量校准完成：1/1 组成功");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("AI 校准完成");
  });

  it("owns group generation and extend-edit dialog transitions", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const hook = renderController();
    await waitFor(() => expect(hook.result.current.shotGroups).toHaveLength(1));
    const group = hook.result.current.shotGroups[0];

    await act(async () => {
      await hook.result.current.generateGroup(group.id);
    });

    expect(hook.setIsGenerating.mock.calls).toEqual([[true], [false]]);
    expect(hook.generateGroupVideo).toHaveBeenCalledWith(
      group,
      expect.objectContaining({ confirmBeforeGenerate: expect.any(Function) }),
    );

    act(() => hook.result.current.openExtendEdit(group.id, "edit"));
    expect(hook.result.current.extendEditOpen).toBe(true);
    expect(hook.result.current.extendEditMode).toBe("edit");
    expect(hook.result.current.extendEditSourceGroup).toEqual(group);
  });
});
