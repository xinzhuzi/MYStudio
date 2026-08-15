import { describe, expect, it, vi } from "vitest";
import type {
  ChapterVideoCompositionProps,
  CompositionProps,
  StoryboardShotCompositionProps,
} from "./composition-props";

const remotionMocks = vi.hoisted(() => ({ registerRoot: vi.fn() }));

vi.mock("remotion", () => ({
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
    const children = entry.RemotionRoot().props.children as Array<{ props: { id: string } }>;
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
