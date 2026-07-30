// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditingProjectV1 } from "@/types/editing";
import { useRemotionPlayerPreview } from "./useRemotionPlayerPreview";

afterEach(() => {
  cleanup();
  delete window.remotionPreview;
});

describe("useRemotionPlayerPreview", () => {
  it("creates and releases a Player capability session without browser runtime calls", async () => {
    const create = vi.fn(async () => ({
      sessionId: "preview-1",
      composition: {
        width: 1080,
        height: 1920,
        fps: 30,
        durationInFrames: 30,
        visualClips: [],
        transitions: [],
        audioClips: [],
        subtitles: [],
      },
    }));
    const release = vi.fn(async (sessionId: string) => ({ sessionId, released: true as const }));
    window.remotionPreview = { create, release };
    window.remotionRuntime = {
      status: vi.fn(),
      download: vi.fn(),
      onDownloadProgress: vi.fn(() => () => undefined),
    };

    const source = project();
    const { result, unmount } = renderHook(() =>
      useRemotionPlayerPreview(source, "remotion"),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(create).toHaveBeenCalledOnce();
    expect(window.remotionRuntime.status).not.toHaveBeenCalled();
    expect(window.remotionRuntime.download).not.toHaveBeenCalled();

    unmount();
    await waitFor(() => expect(release).toHaveBeenCalledWith("preview-1"));
  });

  it("keeps FFmpeg preview local and routes unsupported Remotion effects before creating a session", async () => {
    const create = vi.fn();
    window.remotionPreview = {
      create,
      release: vi.fn(),
    } as unknown as NonNullable<Window["remotionPreview"]>;
    const source = project();
    source.effects = [{
      id: "blur-1",
      effectId: "blur",
      targetClipId: "visual-1",
      startUs: 0,
      durationUs: 1_000_000,
      params: { radius: 4 },
      enabled: true,
    }];

    const ffmpeg = renderHook(() => useRemotionPlayerPreview(source, "ffmpeg"));
    expect(ffmpeg.result.current.status).toBe("idle");
    const remotion = renderHook(() => useRemotionPlayerPreview(source, "remotion"));
    await waitFor(() => expect(remotion.result.current.status).toBe("error"));
    expect(remotion.result.current.error).toContain("Remotion 暂不支持效果：blur");
    expect(create).not.toHaveBeenCalled();
  });
});

function project(): EditingProjectV1 {
  return {
    schemaVersion: 1,
    id: "editing-1",
    projectId: "project-1",
    episodeId: "episode-1",
    name: "预览",
    revision: 1,
    sourceSnapshotHash: "snapshot-1",
    createdBy: "manual",
    manuallyEdited: true,
    stale: false,
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264",
      subtitleMode: "burn-in",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    },
    tracks: [{
      id: "visual",
      kind: "video",
      name: "画面",
      order: 0,
      clipIds: ["visual-1"],
      muted: false,
      locked: false,
    }],
    clips: [{
      id: "visual-1",
      trackId: "visual",
      name: "镜头",
      source: { kind: "storyboardImage", path: "/tmp/shot.png", evidence: {} },
      startUs: 0,
      durationUs: 1_000_000,
      trimStartUs: 0,
      speed: 1,
      volume: 0,
      muted: true,
    }],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
