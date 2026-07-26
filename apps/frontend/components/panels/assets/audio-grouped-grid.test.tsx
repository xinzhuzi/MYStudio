// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioAssetSummary } from "@/types/studio-assets";
import { AudioGroupedGrid, raceWithTimeout } from "./audio-grouped-grid";

const bridgeMocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  request: vi.fn(),
}));

vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: () => ({
    get: bridgeMocks.get,
    update: bridgeMocks.update,
  }),
}));

vi.mock("@/lib/bridge/tts-runtime", () => ({
  getTtsRuntimeBridge: () => ({ request: bridgeMocks.request }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const voiceAsset: StudioAssetSummary = {
  id: "voice-1",
  source: "toonflow-runtime",
  type: "audio",
  name: "清朗少年",
  filePath: "/voices/clear-young.wav",
};

const localAsset: StudioAssetSummary = {
  id: "local-1",
  source: "manying-local",
  type: "audio",
  name: "scene-12-voice-narrator.wav",
  filePath: "/project/audio/scene-12-voice-narrator.wav",
};

const baseProps = {
  type: "audio",
  items: [voiceAsset, localAsset],
  isLoading: false,
  Icon: () => null,
  error: "",
  emptyText: "还没有音频素材",
  selectedIds: new Set<string>(),
  selectMode: false,
  onToggleSelect: vi.fn(),
  onOpen: vi.fn(),
  canLoadMore: false,
  isLoadingMore: false,
  onLoadMore: vi.fn(),
  onRefresh: vi.fn(),
};

describe("AudioGroupedGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears the timeout after the request settles", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await expect(raceWithTimeout(Promise.resolve("done"), 90_000)).resolves.toBe("done");

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps imported voices separate from collapsed local-made audio", () => {
    render(<AudioGroupedGrid {...baseProps} />);

    expect(screen.getAllByText("清朗少年").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("scene-12-voice-narrator")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /本地制作/ }));

    expect(screen.getAllByText("scene-12-voice-narrator").length).toBeGreaterThan(0);
  });

  it("batch-transcribes only selected voice assets and refreshes after success", async () => {
    bridgeMocks.get.mockImplementation(async (id: string) => ({
      id,
      description: "",
      sourcePath: id === voiceAsset.id ? voiceAsset.filePath : localAsset.filePath,
    }));
    bridgeMocks.request.mockResolvedValue({ text: "  你终于回来了。  " });
    bridgeMocks.update.mockResolvedValue({ id: voiceAsset.id });
    const onRefresh = vi.fn();

    render(
      <AudioGroupedGrid
        {...baseProps}
        selectMode
        selectedIds={new Set([voiceAsset.id, localAsset.id])}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /批量生成说话内容/ }));

    await waitFor(() => {
      expect(bridgeMocks.update).toHaveBeenCalledWith({
        id: voiceAsset.id,
        updates: { description: "你终于回来了。" },
      });
    });
    expect(bridgeMocks.get).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.get).toHaveBeenCalledWith(voiceAsset.id);
    expect(bridgeMocks.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/transcribe",
      body: { audio_path: voiceAsset.filePath },
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
