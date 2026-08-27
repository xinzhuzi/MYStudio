// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShotProductionOverview } from "./ShotProductionOverview";
import { makeCurrentSlot } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import type { StoryboardItem } from "@/types/studio";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";

afterEach(cleanup);

function shot(partial: Partial<StoryboardItem>): StoryboardItem {
  return {
    id: partial.id ?? "shot-001",
    episodeId: "chapter-001",
    index: partial.index ?? 1,
    trackKey: "001-1",
    trackId: "",
    duration: 6,
    prompt: partial.prompt ?? "船桩压住前景。",
    videoDesc: partial.videoDesc,
    lines: partial.lines,
    shotAudioBindings: partial.shotAudioBindings,
    mediaRef: partial.mediaRef,
    ...partial,
  } as StoryboardItem;
}

function slotFor(shotId: string): RemotionCurrentSlotV1 {
  const base = makeCurrentSlot();
  const target = { kind: "shot" as const, chapterId: "chapter-001", shotId, shotRevision: 1 };
  return { ...base, target, job: { ...base.job, target } };
}

function voiceBinding(shotId: string) {
  return {
    schemaVersion: 2 as const,
    bindingId: `bind-${shotId}`,
    bindingFingerprint: "f".repeat(16),
    projectId: "project-a",
    chapterId: "chapter-001",
    source: {
      kind: "project-file" as const,
      projectId: "project-a",
      relativePath: "remotion/tts-ledger/voice.mp3",
      contentSha256: "a".repeat(64),
      provenance: { origin: "tts" } as never,
    },
    sourceFingerprint: "s".repeat(16),
    sourceDurationUs: 5_000_000,
    sourceStartUs: 0,
    durationUs: 4_800_000,
    volume: 0.9,
    fadeInUs: 0,
    fadeOutUs: 0,
    renderScope: "shot" as const,
    shotId,
    shotRevision: 1,
    role: "voice" as const,
    shotStartUs: 0,
  };
}

describe("ShotProductionOverview(单镜生产总览)", () => {
  it("renders counts, back button and selects the first shot by default", () => {
    const onBackToCanvas = vi.fn();
    render(
      <ShotProductionOverview
        projectId="project-a"
        storyboards={[
          shot({ id: "shot-002", index: 2 }),
          shot({ id: "shot-001", index: 1, shotAudioBindings: [voiceBinding("shot-001") as never] }),
        ]}
        jobs={[]}
        currentShotSlots={[slotFor("shot-001")]}
        onBackToCanvas={onBackToCanvas}
      />,
    );

    expect(screen.getByText("2 个分镜 · 1 个视频 · 0 个画面 · 1 个旁白配音")).toBeTruthy();
    expect(screen.getByRole("button", { name: /返回节点图/ })).toBeTruthy();
    // 默认选中 S01:视频已生成 + 旁白配音音频行
    expect(screen.getByText("S01")).toBeTruthy();
    expect(screen.getByText("单镜视频已生成")).toBeTruthy();
    expect(screen.getByText("旁白配音")).toBeTruthy();
    expect(document.querySelector("video")?.getAttribute("src")).toContain("project-file://");
    expect(document.querySelector("audio")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /返回节点图/ }));
    expect(onBackToCanvas).toHaveBeenCalledOnce();
  });

  it("switches the detail panel when a shot chip is clicked", () => {
    render(
      <ShotProductionOverview
        projectId="project-a"
        storyboards={[shot({ id: "shot-001", index: 1 }), shot({ id: "shot-002", index: 2, videoDesc: "赵四俯身指向老苦力。" })]}
        jobs={[]}
        currentShotSlots={[]}
      />,
    );

    expect(screen.getByText("单镜视频未生成")).toBeTruthy();
    fireEvent.click(document.querySelector('[data-shot-chip="shot-002"]')!);
    expect(screen.getByText("赵四俯身指向老苦力。")).toBeTruthy();
  });

  it("marks running and failed shots on the chip strip via job status", () => {
    const runningSlot = {
      ...slotFor("shot-001"),
      outputPath: undefined,
      job: { ...slotFor("shot-001").job, status: "running" as const, progress: 0.4 },
    };
    render(
      <ShotProductionOverview
        projectId="project-a"
        storyboards={[shot({ id: "shot-001", index: 1 })]}
        jobs={[runningSlot.job]}
        currentShotSlots={[]}
      />,
    );
    expect(screen.getAllByText(/渲染中 40%/).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-shot-video-status="running"]')).toBeTruthy();
  });

  it("falls back to the latest succeeded job as a clearly-labeled stale video", () => {
    const base = makeCurrentSlot();
    const staleJob = { ...base.job, target: { ...base.job.target, shotRevision: 1 } };
    render(
      <ShotProductionOverview
        projectId="project-a"
        storyboards={[shot({ id: "shot-001", index: 1, outputVersion: 3 })]}
        jobs={[staleJob]}
        currentShotSlots={[]}
      />,
    );
    expect(screen.getByText(/旧版单镜视频\(第 1 版产物\)/)).toBeTruthy();
    expect(document.querySelector("video")?.getAttribute("src")).toContain("project-file://");
    expect(screen.getByText("1 个分镜 · 0 个视频 · 1 个旧版可看 · 0 个画面 · 0 个旁白配音")).toBeTruthy();
    expect(document.querySelector('[data-shot-video-status="stale"]')).toBeTruthy();
  });

  it("renders the empty state without chips", () => {
    render(<ShotProductionOverview projectId="project-a" storyboards={[]} jobs={[]} currentShotSlots={[]} />);
    expect(screen.getByText("尚无分镜,请先生成分镜表")).toBeTruthy();
    expect(document.querySelector("[data-shot-chip-strip]")).toBeNull();
  });
});
