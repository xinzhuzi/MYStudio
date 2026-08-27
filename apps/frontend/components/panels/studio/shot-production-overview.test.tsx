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
    // 默认选中 S01:视频已生成 + 旁白配音音频行;镜号横滑条默认收起,镜号按钮在头部
    expect(screen.getAllByText("S01").length).toBeGreaterThan(0);
    expect(screen.getByText("单镜视频已生成")).toBeTruthy();
    expect(document.querySelector("video")?.getAttribute("src")).toContain("project-file://");
    // 声音三卡(配音/音效/BGM)默认收起:试听器不进 DOM;点「试听」才逐条可听
    expect(document.querySelector("audio")).toBeNull();
    expect(document.querySelector('[data-shot-sound-card="voice"]')!.textContent).toContain("1 条");
    expect(document.querySelector('[data-shot-sound-card="sfx"]')!.textContent).toContain("本镜无");
    expect(document.querySelector('[data-shot-sound-card="bgm"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-shot-audio-toggle="voice"]')!);
    expect(document.querySelector("audio")).toBeTruthy();
    expect(screen.getAllByText("旁白配音").length).toBeGreaterThan(1);
    // 键盘可达:试听按钮同为裸 button,必须自带焦点环
    expect(document.querySelector('[data-shot-audio-toggle="voice"]')!.getAttribute("class")).toContain("focus-visible:ring");
    expect(document.querySelector("[data-shot-chip-strip]")).toBeNull();
    const toggle = document.querySelector("[data-shot-strip-toggle]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("shot-strip");
    expect(toggle.getAttribute("aria-label")).toContain("展开镜号横滑条");

    fireEvent.click(screen.getByRole("button", { name: /返回节点图/ }));
    expect(onBackToCanvas).toHaveBeenCalledOnce();
  });

  it("expands the horizontal shot strip from the shot-number toggle and collapses on pick", () => {
    render(
      <ShotProductionOverview
        projectId="project-a"
        storyboards={[shot({ id: "shot-001", index: 1 }), shot({ id: "shot-002", index: 2, videoDesc: "赵四俯身指向老苦力。" })]}
        jobs={[]}
        currentShotSlots={[]}
      />,
    );

    expect(document.querySelector("[data-shot-chip-strip]")).toBeNull();
    const toggle = document.querySelector("[data-shot-strip-toggle]")!;
    fireEvent.click(toggle);
    const strip = document.querySelector("[data-shot-chip-strip]")!;
    expect(strip.getAttribute("class")).toContain("overflow-x-auto");
    // 键盘可达:裸 chip 必须自带焦点环(仓内无全局 focus-visible 样式)
    expect(document.querySelector('[data-shot-chip="shot-001"]')!.getAttribute("class")).toContain("focus-visible:ring");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toContain("收起镜号横滑条");
    expect(document.querySelector('[data-shot-chip="shot-001"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-shot-chip="shot-002"]')).toBeTruthy();

    // 点选其他镜:详情切换 + 横滑条收起
    fireEvent.click(document.querySelector('[data-shot-chip="shot-002"]')!);
    expect(screen.getByText("赵四俯身指向老苦力。")).toBeTruthy();
    expect(document.querySelector("[data-shot-chip-strip]")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    // 再次点击镜号按钮可重新展开,且新选中镜处于按下态
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[data-shot-chip="shot-002"]')!.getAttribute("aria-pressed")).toBe("true");

    // 点选当前镜同样收起横滑条
    fireEvent.click(document.querySelector('[data-shot-chip="shot-002"]')!);
    expect(document.querySelector("[data-shot-chip-strip]")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses the audio panel again when switching to another shot", () => {
    render(
      <ShotProductionOverview
        projectId="project-a"
        storyboards={[
          shot({ id: "shot-001", index: 1, shotAudioBindings: [voiceBinding("shot-001") as never] }),
          shot({ id: "shot-002", index: 2, shotAudioBindings: [voiceBinding("shot-002") as never] }),
        ]}
        jobs={[]}
        currentShotSlots={[]}
      />,
    );

    fireEvent.click(document.querySelector('[data-shot-audio-toggle="voice"]')!);
    expect(document.querySelectorAll("audio").length).toBe(1);

    // 经横滑条切到 S02:试听卡自动收起,条数跟着新镜走
    fireEvent.click(document.querySelector("[data-shot-strip-toggle]")!);
    fireEvent.click(document.querySelector('[data-shot-chip="shot-002"]')!);
    expect(document.querySelector("audio")).toBeNull();
    expect(document.querySelector('[data-shot-sound-card="voice"]')!.textContent).toContain("1 条");
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
    expect(document.querySelector("[data-shot-strip-toggle]")).toBeNull();
  });
});
