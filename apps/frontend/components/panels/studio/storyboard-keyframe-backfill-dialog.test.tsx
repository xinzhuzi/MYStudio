// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryboardKeyframeBackfillDialog } from "./StoryboardKeyframeBackfillDialog";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";

afterEach(() => {
  cleanup();
  useStudioStore.getState().resetStudioWorkflow();
});

function shot(partial: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: partial.id ?? "sb-1",
    episodeId: "chapter-001",
    index: partial.index ?? 1,
    trackKey: "001-1",
    duration: 12,
    durationTarget: 12,
    prompt: "画面",
    videoDesc: "画面",
    assetIds: [],
    state: "idle",
    ...partial,
  } as StoryboardItem;
}

const MAPPING = {
  summary: { framesReused: 2, highConfidenceRatio: 1 },
  mapping: [
    {
      shotId: "sb-1",
      index: 1,
      durationUs: 12_000_000,
      candidateCount: 2,
      frames: [
        { frameId: "sb-1-kf-1", legacyIndex: 1, path: "project-file://p/old-1.png", inUs: 0, confidence: "high" },
        { frameId: "sb-1-kf-2", legacyIndex: 2, path: "project-file://p/old-2.png", inUs: 6_000_000, confidence: "high" },
      ],
    },
    { shotId: "sb-gone", index: 9, durationUs: 12_000_000, candidateCount: 0, frames: [] },
  ],
};

function pickMappingFile(): File {
  return new File([JSON.stringify(MAPPING)], "mapping.json", { type: "application/json" });
}

describe("StoryboardKeyframeBackfillDialog(回接旧镜图)", () => {
  it("导入 mapping → 预览可写镜 → 确认写入 keyframes(origin=legacy)", async () => {
    useStudioStore.getState().replaceStoryboardsForEpisode("chapter-001", [shot()]);
    render(<StoryboardKeyframeBackfillDialog open onClose={() => undefined} />);

    const input = document.querySelector('[data-backfill-file-input]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pickMappingFile()] });
    fireEvent.change(input);

    await waitFor(() => expect(screen.getByText(/本次可写入/).textContent).toContain("1"));
    // 不在当前章节的镜可见但不计入
    expect(screen.getByText("不在当前章节")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /确认写入 1 镜/ }));
    await waitFor(() => expect(screen.getByText(/已写入 1 镜/)).toBeTruthy());

    const updated = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")!;
    expect(updated.keyframes).toHaveLength(2);
    expect(updated.keyframes?.[1].origin).toEqual({ kind: "legacy-shot", legacyIndex: 2 });
    expect(updated.mediaRef?.path).toBe("project-file://p/old-1.png");
  });

  it("已有帧序列的镜跳过(幂等)", async () => {
    useStudioStore.getState().replaceStoryboardsForEpisode("chapter-001", [
      shot({
        keyframes: [
          { frameId: "sb-1-kf-1", mediaRef: { kind: "image", path: "project-file://p/a.png" }, inUs: 0 },
        ],
      }),
    ]);
    render(<StoryboardKeyframeBackfillDialog open onClose={() => undefined} />);
    const input = document.querySelector('[data-backfill-file-input]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pickMappingFile()] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText("已有帧序列,跳过")).toBeTruthy());
    expect((screen.getByRole("button", { name: /确认写入/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
