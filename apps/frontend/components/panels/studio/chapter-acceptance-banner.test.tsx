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
  it("全绿(资产/衍生零失败+分镜全视频就绪+零 stale)→横幅消失", () => {
    useStudioStore.setState({
      mediaTasks: [
        { id: "a", kind: "scriptAsset", status: "success", targetId: "character:x", episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1 },
        { id: "b", kind: "derivedAssetImage", status: "success", targetId: "derived:x:y", episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1 },
      ] as never,
      storyboards: [
        {
          id: "sb-1", episodeId: CHAPTER_ID, index: 1, trackKey: "k", trackId: "", duration: 5,
          prompt: "p", videoDesc: "", assetIds: [], associateAssetsNames: [],
          mediaRef: { kind: "video", path: "local-image://videos/s1.mp4" }, keyframes: [], state: "idle",
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
    expect(screen.getByText(/分镜视频 0\/1（缺视频 1）/)).toBeTruthy();
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

describe("ChapterAcceptanceBanner·source-stale(D-5 消费方呈现)", () => {
  function allGreenCardFixture() {
    useStudioStore.setState({
      mediaTasks: [
        { id: "a", kind: "scriptAsset", status: "success", targetId: "character:x", episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1 },
        { id: "b", kind: "derivedAssetImage", status: "success", targetId: "derived:x:y", episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1 },
      ] as never,
      storyboards: [
        {
          id: "sb-1", episodeId: CHAPTER_ID, index: 1, trackKey: "k", trackId: "", duration: 5,
          prompt: "p", videoDesc: "", assetIds: [], associateAssetsNames: [],
          mediaRef: { kind: "video", path: "local-image://videos/s1.mp4" }, keyframes: [], state: "idle",
        },
      ] as never,
    });
    return buildChapterAcceptanceCard(CHAPTER_ID);
  }

  it("无卡、stale=0、源过期 2 → source-stale 软横幅+同位分镜表再生成按钮(非章流水线,修复回路闭合)", () => {
    const onRunPipeline = vi.fn();
    const onRegenerateStoryboardTable = vi.fn();
    const { container } = render(
      <ChapterAcceptanceBanner
        run={undefined}
        staleCount={0}
        staleSourceScriptCount={2}
        onRunPipeline={onRunPipeline}
        onRegenerateStoryboardTable={onRegenerateStoryboardTable}
      />,
    );
    expect(container.querySelector("[data-chapter-acceptance-banner='source-stale']")).not.toBeNull();
    expect(screen.getByText(/2 镜基于旧剧本/)).toBeTruthy();
    // 修复回路锁:sourceScript 只在分镜表生成流盖章,章流水线三步零 sourceScript
    // 写点——本态动作必须指向分镜表再生成,不得再发章流水线(清不了此计数)。
    const regen = container.querySelector("[data-acceptance-regenerate-storyboard-table]");
    expect(regen).not.toBeNull();
    fireEvent.click(regen!);
    expect(onRegenerateStoryboardTable).toHaveBeenCalledTimes(1);
    expect(onRunPipeline).not.toHaveBeenCalled();
    expect(container.querySelector("[data-acceptance-run-pipeline]")).toBeNull();
  });

  it("有卡全绿+源过期 → 全绿消失被阻止,banner 保持 actionable+摘要行+再生成动作", () => {
    const card = allGreenCardFixture();
    const onRegenerateStoryboardTable = vi.fn();
    const { container } = render(
      <ChapterAcceptanceBanner
        run={runView({ card })}
        staleCount={0}
        staleSourceScriptCount={2}
        onRunPipeline={() => undefined}
        onRegenerateStoryboardTable={onRegenerateStoryboardTable}
      />,
    );
    const banner = container.querySelector("[data-chapter-acceptance-banner='actionable']");
    expect(banner).not.toBeNull();
    expect(screen.getByText(/分镜源过期 2 镜/)).toBeTruthy();
    // 旧文案承诺「可重跑章流水线刷新」清不了此计数,禁止回归
    expect(screen.queryByText(/可重跑章流水线刷新/)).toBeNull();
    const regen = container.querySelector("[data-acceptance-regenerate-storyboard-table]");
    expect(regen).not.toBeNull();
    fireEvent.click(regen!);
    expect(onRegenerateStoryboardTable).toHaveBeenCalledTimes(1);
  });

  it("缺省零漂移:全绿卡不传新 prop → 横幅照旧消失(新闸不误吞)", () => {
    const card = allGreenCardFixture();
    const { container } = render(
      <ChapterAcceptanceBanner run={runView({ card })} onRunPipeline={() => undefined} />,
    );
    expect(container.querySelector("[data-chapter-acceptance-banner]")).toBeNull();
  });
});

describe("ChapterAcceptanceBanner·1120 件二视频主判定(双用降级验收口径)", () => {
  it("图全绑但零视频→横幅常驻:主计数=分镜视频 0/N(缺视频 N),分镜画面降中间态辅助行仍显示不删除", () => {
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
    expect(card.storyboard.videoReady).toBe(0); // 无视频态=主计数缺省,不硬造
    expect(card.storyboard.ready).toBe(1); // 首帧/参考物料仍在(静态图照常产出)
    const { container } = render(
      <ChapterAcceptanceBanner run={runView({ card })} onRunPipeline={() => undefined} />,
    );
    expect(container.querySelector("[data-chapter-acceptance-banner='actionable']")).not.toBeNull();
    expect(screen.getByText(/分镜视频 0\/1（缺视频 1）/)).toBeTruthy();
    // 既有图计数行保留(降级为中间态辅助,仍显示不删除)
    expect(screen.getByText(/分镜画面 1\/1/)).toBeTruthy();
  });

  it("全镜视频就绪(零例外/零失败/零 stale)→横幅消失(主口径转视频后的全绿)", () => {
    useStudioStore.setState({
      mediaTasks: [
        { id: "a", kind: "scriptAsset", status: "success", targetId: "character:x", episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1 },
      ] as never,
      storyboards: [
        {
          id: "sb-1", episodeId: CHAPTER_ID, index: 1, trackKey: "k", trackId: "", duration: 5,
          prompt: "p", videoDesc: "", assetIds: [], associateAssetsNames: [],
          mediaRef: { kind: "video", path: "local-image://videos/s1.mp4" }, keyframes: [], state: "idle",
        },
      ] as never,
    });
    const card = buildChapterAcceptanceCard(CHAPTER_ID);
    expect(card.storyboard.videoReady).toBe(1);
    const { container } = render(
      <ChapterAcceptanceBanner run={runView({ card })} onRunPipeline={() => undefined} />,
    );
    expect(container.querySelector("[data-chapter-acceptance-banner]")).toBeNull();
  });
});
