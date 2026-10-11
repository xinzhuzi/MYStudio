// @vitest-environment jsdom
/**
 * 章验收卡·分镜面板横幅测试(批5 G10 双落位之二):
 * 有未绑/stale/失败→常驻+动作可达(重跑流水线/直达资产页);全绿消失;
 * 运行中=进度条幅;无卡但有实况 stale 也常驻(批6 禁漏报)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChapterAcceptanceBanner } from "./ChapterAcceptanceBanner";
import { buildChapterAcceptanceCard, useChapterPipelineStore, type ChapterPipelineRunView } from "./chapter-pipeline";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useScriptAssetBatchStore } from "./script-asset-batch";
import { useDerivedChainStore } from "./derived-asset-chain";
import { useStoryboardBindingStore } from "./storyboard-asset-binding";
import { useChapterUpstreamStore } from "./chapter-pipeline-stale";

const CHAPTER_ID = "chapter-001";

function runView(patch: Partial<ChapterPipelineRunView> = {}): ChapterPipelineRunView {
  return {
    chapterId: CHAPTER_ID,
    status: "done",
    steps: [
      { key: "assets", label: "资产生成", status: "done" },
      { key: "derived", label: "衍生闭环", status: "done" },
      { key: "storyboardBinding", label: "分镜绑定", status: "done" },
    ],
    ...patch,
  };
}

afterEach(() => {
  cleanup();
  useStudioStore.getState().resetStudioWorkflow();
  useChapterPipelineStore.setState({ runsByChapter: {}, zombieReconciled: false });
  useChapterUpstreamStore.setState({ byChapter: {} });
  useScriptAssetBatchStore.setState({ runsByChapter: {} });
  useDerivedChainStore.setState({ runsByChapter: {} });
  useStoryboardBindingStore.setState({ runsByChapter: {} });
});

describe("ChapterAcceptanceBanner(分镜面板顶部横幅)", () => {
  it("全绿(资产/衍生零失败+分镜全绑+零 stale)→横幅消失", () => {
    useStudioStore.setState({
      mediaTasks: [
        { id: "a", kind: "scriptAsset", status: "success", targetId: "character:x", episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1 },
        { id: "b", kind: "derivedAssetImage", status: "success", targetId: "derived:x:y", episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1 },
      ] as never,
      storyboards: [
        {
          id: "sb-1", episodeId: CHAPTER_ID, index: 1, trackKey: "k", trackId: "", duration: 5,
          prompt: "p", videoDesc: "", assetIds: [], associateAssetsNames: [],
          mediaRef: { kind: "image", path: "local-image://s1.png" }, keyframes: [], state: "idle",
        },
      ] as never,
    });
    const card = buildChapterAcceptanceCard(CHAPTER_ID);
    expect(card.staleCount).toBe(0);
    const { container } = render(
      <ChapterAcceptanceBanner run={runView({ card })} onRunPipeline={() => undefined} />,
    );
    expect(container.querySelector("[data-chapter-acceptance-banner]")).toBeNull();
  });

  it("有未绑+资产失败→常驻横幅:未绑计数可见,失败直达资产页/重跑动作可达", () => {
    const onRunPipeline = vi.fn();
    const onGoToAssets = vi.fn();
    useStudioStore.setState({
      mediaTasks: [
        { id: "a", kind: "scriptAsset", status: "failed", targetId: "prop:青盐鞭", episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1, errorReason: "boom" },
      ] as never,
      storyboards: [
        {
          id: "sb-1", episodeId: CHAPTER_ID, index: 1, trackKey: "k", trackId: "", duration: 5,
          prompt: "p", videoDesc: "", assetIds: [], associateAssetsNames: [],
          mediaRef: undefined, keyframes: [], state: "idle",
        },
      ] as never,
    });
    const card = buildChapterAcceptanceCard(CHAPTER_ID);
    const { container } = render(
      <ChapterAcceptanceBanner
        run={runView({ card })}
        onRunPipeline={onRunPipeline}
        onGoToAssets={onGoToAssets}
      />,
    );
    expect(container.querySelector("[data-chapter-acceptance-banner='actionable']")).not.toBeNull();
    expect(screen.getByText(/未绑 1/)).toBeTruthy();
    expect(screen.getByText(/失 1/)).toBeTruthy();

    fireEvent.click(container.querySelector("[data-acceptance-go-assets]")!);
    expect(onGoToAssets).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector("[data-acceptance-run-pipeline]")!);
    expect(onRunPipeline).toHaveBeenCalledTimes(1);
  });

  it("stale(剧本变更)→常驻横幅+禁静默沿用提示;staleCount 取实况与快照较大者", () => {
    useStudioStore.setState({
      mediaTasks: [
        { id: "a", kind: "scriptAsset", status: "success", targetId: "character:x", episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1 },
      ] as never,
    });
    const card = buildChapterAcceptanceCard(CHAPTER_ID); // 卡快照 staleCount=0(无台账)
    const { container } = render(
      <ChapterAcceptanceBanner
        run={runView({ card })}
        staleCount={1} // 实况派生(横幅禁用旧快照漏报)
        onRunPipeline={() => undefined}
      />,
    );
    const banner = container.querySelector("[data-chapter-acceptance-banner='actionable']");
    expect(banner).not.toBeNull();
    expect(screen.getByText(/过期 1（剧本已变更）/)).toBeTruthy();
    expect(screen.getByText(/禁静默沿用/)).toBeTruthy();
  });

  it("无卡但有实况 stale→stale-only 横幅(动作可达)", () => {
    const { container } = render(
      <ChapterAcceptanceBanner run={undefined} staleCount={3} onRunPipeline={() => undefined} />,
    );
    expect(container.querySelector("[data-chapter-acceptance-banner='stale-only']")).not.toBeNull();
    expect(screen.getByText(/3 项下游产物已过期/)).toBeTruthy();
  });

  it("运行中→进度条幅(步 X/3+当前步骤),不出动作按钮", () => {
    const { container } = render(
      <ChapterAcceptanceBanner
        run={runView({
          status: "running",
          steps: [
            { key: "assets", label: "资产生成", status: "done" },
            { key: "derived", label: "衍生闭环", status: "running" },
            { key: "storyboardBinding", label: "分镜绑定", status: "pending" },
          ],
        })}
        onRunPipeline={() => undefined}
      />,
    );
    expect(container.querySelector("[data-chapter-acceptance-banner='running']")).not.toBeNull();
    expect(screen.getByText(/章流水线进行中（1\/3）/)).toBeTruthy();
    expect(screen.getByText(/当前步骤：衍生闭环/)).toBeTruthy();
    expect(container.querySelector("[data-acceptance-run-pipeline]")).toBeNull();
  });
});
