import { describe, expect, it, vi } from "vitest";
import type {
  ChapterVideoCompositionProps,
  CompositionProps,
  StoryboardShotCompositionProps,
} from "./composition-props";

const remotionMocks = vi.hoisted(() => ({ registerRoot: vi.fn() }));

vi.mock("remotion", async (importOriginal) => ({
  // vsc 配方组件进了 entry import 图(10-10 批B):vsc-helpers 模块级吃真
  // Easing——保留实际实现,只覆盖 React 侧边界(同 RemotionComposition.test 式)。
  ...(await importOriginal<typeof import("remotion")>()),
  registerRoot: remotionMocks.registerRoot,
  Composition: () => null,
  AbsoluteFill: () => null,
  Sequence: () => null,
  Img: () => null,
  OffthreadVideo: () => null,
  useCurrentFrame: () => 0,
}));

vi.mock("@remotion/media", () => ({ Audio: () => null }));

const entry = await import("./entry");

const props: CompositionProps = {
  width: 720,
  height: 1280,
  fps: 24,
  durationInFrames: 240,
  visualClips: [],
  transitions: [],
  audioClips: [],
  subtitles: [],
};

const shotProps: StoryboardShotCompositionProps = {
  ...props,
  target: "shot",
  projectId: "project-a",
  chapterId: "chapter-1",
  shotId: "shot-1",
  shotRevision: 2,
  visualClips: [{
    clipId: "shot-1",
    kind: "image",
    src: `http://127.0.0.1:4100/${"a".repeat(64)}/shot-1`,
    from: 0,
    durationInFrames: 240,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  }],
  audioClips: [{
    clipId: "voice-1",
    kind: "voice",
    renderScope: "shot",
    src: `http://127.0.0.1:4100/${"b".repeat(64)}/voice-1`,
    from: 0,
    durationInFrames: 240,
    volume: 1,
  }],
};

const chapterProps: ChapterVideoCompositionProps = {
  ...props,
  target: "chapter",
  projectId: "project-a",
  chapterId: "chapter-1",
  editingProjectId: "editing-1",
  editingRevision: 3,
  visualClips: [{
    clipId: "shot-output-1",
    kind: "video",
    src: `http://127.0.0.1:4100/${"c".repeat(64)}/shot-output-1`,
    from: 0,
    durationInFrames: 240,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  }],
  audioClips: [{
    clipId: "chapter-bgm-1",
    kind: "bgm",
    renderScope: "chapter",
    src: `http://127.0.0.1:4100/${"d".repeat(64)}/chapter-bgm-1`,
    from: 0,
    durationInFrames: 240,
    volume: 0.25,
  }],
};

function metadataArgs<T extends CompositionProps>(
  value: T,
  compositionId = entry.LEGACY_TIMELINE_COMPATIBILITY_COMPOSITION_ID,
) {
  return {
    defaultProps: value,
    props: value,
    abortSignal: new AbortController().signal,
    compositionId,
    isRendering: true,
  };
}

describe("fixed composition entry", () => {
  it("registers exactly one stable Remotion root", () => {
    expect(remotionMocks.registerRoot).toHaveBeenCalledOnce();
    expect(remotionMocks.registerRoot).toHaveBeenCalledWith(entry.RemotionRoot);
  });

  it("derives render metadata from validated input props", async () => {
    expect(await entry.calculateCompositionMetadata(metadataArgs(props))).toEqual({
      durationInFrames: 240,
      fps: 24,
      width: 720,
      height: 1280,
      props,
    });
  });

  it("registers the two parameterized production compositions before the compatibility alias", () => {
    // React 19:组件返回类型放宽为 ReactNode,取 props 前先显式锚回 ReactElement(1003 B3)
    const root = entry.RemotionRoot() as React.ReactElement<{ children: Array<{ props: { id: string } }> }>;
    const children = root.props.children;
    expect(children.map((child) => child.props.id)).toEqual([
      entry.STORYBOARD_SHOT_COMPOSITION_ID,
      entry.CHAPTER_VIDEO_COMPOSITION_ID,
      entry.LEGACY_TIMELINE_COMPATIBILITY_COMPOSITION_ID,
    ]);
  });

  it("derives target-specific metadata from the same frame grid", async () => {
    expect(await entry.calculateStoryboardShotMetadata(metadataArgs(
      shotProps,
      entry.STORYBOARD_SHOT_COMPOSITION_ID,
    ))).toEqual({
      durationInFrames: 240,
      fps: 24,
      width: 720,
      height: 1280,
      props: shotProps,
    });
    expect(await entry.calculateChapterVideoMetadata(metadataArgs(
      chapterProps,
      entry.CHAPTER_VIDEO_COMPOSITION_ID,
    ))).toEqual({
      durationInFrames: 240,
      fps: 24,
      width: 720,
      height: 1280,
      props: chapterProps,
    });
  });

  it("10-10 批D:章级配方段扩展 composition 总时长(开篇 104f+正片+章尾 60f),props 网格不变", async () => {
    const withSegments = await entry.calculateChapterVideoMetadata(metadataArgs({
      ...chapterProps,
      chapterOpening: { recipeId: "vsc:brand-ink-open", wordmark: "道劫" },
      chapterOutro: { recipeId: "vsc:grain-dissolve", tagline: "{ 道劫 · 本章完 }", shortMark: "道劫" },
    } as ChapterVideoCompositionProps, entry.CHAPTER_VIDEO_COMPOSITION_ID));
    // 104 + 240 + 60 = 404;props.durationInFrames 仍是正片 240(校验网格不变)。
    expect(withSegments.durationInFrames).toBe(404);
    expect(withSegments.props?.durationInFrames).toBe(240);

    const openingOnly = await entry.calculateChapterVideoMetadata(metadataArgs({
      ...chapterProps,
      chapterOpening: { recipeId: "vsc:brand-ink-open", wordmark: "道劫" },
    } as ChapterVideoCompositionProps, entry.CHAPTER_VIDEO_COMPOSITION_ID));
    expect(openingOnly.durationInFrames).toBe(344);

    // 缺省(默认关):总时长=正片,无章段。
    expect((await entry.calculateChapterVideoMetadata(metadataArgs(
      chapterProps,
      entry.CHAPTER_VIDEO_COMPOSITION_ID,
    ))).durationInFrames).toBe(240);
  });

  it("10-10 批D:未知章级配方 id 在 metadata 边界 fail-closed(渲染前拒)", () => {
    expect(() => entry.calculateChapterVideoMetadata(metadataArgs({
      ...chapterProps,
      chapterOpening: { recipeId: "vsc:bogus-open", wordmark: "道劫" },
    } as unknown as ChapterVideoCompositionProps, entry.CHAPTER_VIDEO_COMPOSITION_ID))).toThrow("开篇配方不在闭集");
    expect(() => entry.calculateChapterVideoMetadata(metadataArgs({
      ...chapterProps,
      chapterOutro: { recipeId: "vsc:bogus-outro", tagline: "x", shortMark: "y" },
    } as unknown as ChapterVideoCompositionProps, entry.CHAPTER_VIDEO_COMPOSITION_ID))).toThrow("章尾配方不在闭集");
    expect(() => entry.calculateChapterVideoMetadata(metadataArgs({
      ...chapterProps,
      chapterOpening: { recipeId: "vsc:brand-ink-open", wordmark: "" },
    } as unknown as ChapterVideoCompositionProps, entry.CHAPTER_VIDEO_COMPOSITION_ID))).toThrow("wordmark");
  });

  it("rejects cross-scope audio and non-video chapter sources", () => {
    expect(() => entry.calculateStoryboardShotMetadata(metadataArgs({
      ...shotProps,
      audioClips: [{ ...shotProps.audioClips[0], renderScope: "chapter" }],
    } as unknown as StoryboardShotCompositionProps))).toThrow("renderScope");
    expect(() => entry.calculateChapterVideoMetadata(metadataArgs({
      ...chapterProps,
      visualClips: [{ ...chapterProps.visualClips[0], kind: "image" }],
    } as ChapterVideoCompositionProps))).toThrow("current shot MP4");
  });

  it("rejects invalid bundle input before rendering", () => {
    expect(() => entry.calculateCompositionMetadata(
      metadataArgs({ ...props, durationInFrames: 0 }),
    )).toThrow("durationInFrames");
  });
});
