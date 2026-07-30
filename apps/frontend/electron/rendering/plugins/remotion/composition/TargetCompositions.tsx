import type {
  ChapterVideoCompositionProps,
  StoryboardShotCompositionProps,
} from "./composition-props";
import { RemotionComposition } from "./RemotionComposition";

/** Parameterized shot target; rendering stays on the shared composition primitives. */
export function StoryboardShotComposition(
  props: StoryboardShotCompositionProps,
): React.ReactElement {
  return <RemotionComposition {...props} />;
}

/** Parameterized chapter target; current shot MP4s and chapter audio share the same frame grid. */
export function ChapterVideoComposition(
  props: ChapterVideoCompositionProps,
): React.ReactElement {
  return <RemotionComposition {...props} />;
}
