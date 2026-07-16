// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const extractLastFrameFromVideo = vi.hoisted(() => vi.fn());
const persistSceneImage = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/ai/video-generator", () => ({ extractLastFrameFromVideo }));
vi.mock("@/lib/utils/image-persist", () => ({ persistSceneImage }));
vi.mock("sonner", () => ({ toast }));

import { useStoryboardVideoLastFrame } from "./use-storyboard-video-last-frame";

const scenes = [
  { id: 2, videoUrl: "file:///scene-2.mp4", width: 1280, height: 720 },
  { id: 5, videoUrl: null, width: 1920, height: 1080 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useStoryboardVideoLastFrame", () => {
  it("rejects missing videos and final scenes before entering the busy state", async () => {
    const setIsExtractingFrame = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentScenes }) => useStoryboardVideoLastFrame({
        scenes: currentScenes,
        setIsExtractingFrame,
        updateSplitSceneImage: vi.fn(),
      }),
      { initialProps: { currentScenes: scenes } },
    );

    await act(async () => result.current.extractVideoLastFrame(99));
    expect(toast.error).toHaveBeenLastCalledWith("请先生成视频");

    rerender({ currentScenes: [{ ...scenes[0] }] });
    await act(async () => result.current.extractVideoLastFrame(2));
    expect(toast.error).toHaveBeenLastCalledWith("这是最后一个分镜，无法插入到下一个分镜");
    expect(setIsExtractingFrame).not.toHaveBeenCalled();
  });

  it("persists the extracted frame into the next scene and clears busy state", async () => {
    extractLastFrameFromVideo.mockResolvedValue("data:image/png;base64,last-frame");
    persistSceneImage.mockResolvedValue({
      localPath: "/images/scene-5-first.png",
      httpUrl: "https://images.test/scene-5-first.png",
    });
    const setIsExtractingFrame = vi.fn();
    const updateSplitSceneImage = vi.fn();
    const { result } = renderHook(() => useStoryboardVideoLastFrame({
      scenes,
      setIsExtractingFrame,
      updateSplitSceneImage,
    }));

    await act(async () => result.current.extractVideoLastFrame(2));

    expect(extractLastFrameFromVideo).toHaveBeenCalledWith("file:///scene-2.mp4", 0.1);
    expect(persistSceneImage).toHaveBeenCalledWith("data:image/png;base64,last-frame", 5, "first");
    expect(updateSplitSceneImage).toHaveBeenCalledWith(
      5,
      "/images/scene-5-first.png",
      1920,
      1080,
      "https://images.test/scene-5-first.png",
    );
    expect(setIsExtractingFrame.mock.calls).toEqual([[true], [false]]);
    expect(toast.success).toHaveBeenCalledWith("分镜 3 尾帧已插入到分镜 6 首帧");
  });

  it("reports empty extraction results and exceptions while always clearing busy state", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setIsExtractingFrame = vi.fn();
    const { result } = renderHook(() => useStoryboardVideoLastFrame({
      scenes,
      setIsExtractingFrame,
      updateSplitSceneImage: vi.fn(),
    }));

    extractLastFrameFromVideo.mockResolvedValueOnce(null);
    await act(async () => result.current.extractVideoLastFrame(2));
    expect(toast.error).toHaveBeenLastCalledWith("提取帧失败");
    expect(setIsExtractingFrame.mock.calls).toEqual([[true], [false]]);

    setIsExtractingFrame.mockClear();
    extractLastFrameFromVideo.mockRejectedValueOnce(new Error("decode failed"));
    await act(async () => result.current.extractVideoLastFrame(2));
    expect(toast.error).toHaveBeenLastCalledWith("提取帧失败");
    expect(setIsExtractingFrame.mock.calls).toEqual([[true], [false]]);
    expect(consoleError).toHaveBeenCalledWith(
      "[SplitScenes] Extract last frame error:",
      expect.any(Error),
    );
  });
});
