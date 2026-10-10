import { Sequence } from "remotion";
import type {
  ChapterVideoCompositionProps,
  StoryboardShotCompositionProps,
} from "./composition-props";
import { RemotionComposition } from "./RemotionComposition";
import {
  ChapterOpeningRecipe,
  ChapterOutroRecipe,
  chapterRecipeDurationFrames,
} from "./recipes/chapter-vsc-recipes";

/** Parameterized shot target; rendering stays on the shared composition primitives. */
export function StoryboardShotComposition(
  props: StoryboardShotCompositionProps,
): React.ReactElement {
  return <RemotionComposition {...props} />;
}

/**
 * Parameterized chapter target; current shot MP4s and chapter audio share the same frame grid.
 *
 * 章级配方段(10-10 批D,design §5「ChapterVideo 前后段」路线):开篇段在前、
 * 章尾段在后,正片整体后移 openingFrames——同一次 renderMedia 出一条 MP4
 * (不拆独立 Composition,避免渲染后 concat——spec §3 concat 禁令)。
 * props.durationInFrames 仍是正片内容帧网格(校验边界不变);composition 总
 * 时长在 entry.tsx calculateChapterVideoMetadata 按 chapterRecipeDurationFrames
 * 扩展(帧数单一真源)。Sequence 平移对视觉/音频/字幕统一生效。
 */
export function ChapterVideoComposition(
  props: ChapterVideoCompositionProps,
): React.ReactElement {
  const openingFrames = props.chapterOpening
    ? chapterRecipeDurationFrames(props.chapterOpening.recipeId)
    : 0;
  const outroFrames = props.chapterOutro
    ? chapterRecipeDurationFrames(props.chapterOutro.recipeId)
    : 0;
  return (
    <>
      {props.chapterOpening ? (
        <Sequence from={0} durationInFrames={openingFrames} layout="none">
          <ChapterOpeningRecipe {...props.chapterOpening} />
        </Sequence>
      ) : null}
      <Sequence from={openingFrames} durationInFrames={props.durationInFrames} layout="none">
        <RemotionComposition {...props} />
      </Sequence>
      {props.chapterOutro ? (
        <Sequence
          from={openingFrames + props.durationInFrames}
          durationInFrames={outroFrames}
          layout="none"
        >
          <ChapterOutroRecipe {...props.chapterOutro} />
        </Sequence>
      ) : null}
    </>
  );
}
