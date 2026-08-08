import {
  Composition,
  registerRoot,
  type CalculateMetadataFunction,
} from "remotion";
import { RemotionComposition } from "./RemotionComposition";
import { ChapterVideoComposition, StoryboardShotComposition } from "./TargetCompositions";
import type {
  ChapterVideoCompositionProps,
  CompositionProps,
  StoryboardShotCompositionProps,
} from "./composition-props";
import {
  validateChapterVideoCompositionProps,
  validateCompositionProps,
  validateStoryboardShotCompositionProps,
  type CompositionValidationResult,
} from "./composition-props-validation";
import {
  CHAPTER_VIDEO_COMPOSITION_ID,
  DAOJIE_TIMELINE_COMPATIBILITY_COMPOSITION_ID,
  REMOTION_COMPOSITION_ID,
  STORYBOARD_SHOT_COMPOSITION_ID,
} from "./composition-id";

export {
  CHAPTER_VIDEO_COMPOSITION_ID,
  DAOJIE_TIMELINE_COMPATIBILITY_COMPOSITION_ID,
  REMOTION_COMPOSITION_ID,
  STORYBOARD_SHOT_COMPOSITION_ID,
} from "./composition-id";
export const defaultCompositionProps: CompositionProps = {
  width: 1920, height: 1080, fps: 30, durationInFrames: 1,
  visualClips: [], transitions: [], audioClips: [], subtitles: [],
};

const placeholderSource = `http://127.0.0.1:1/${"0".repeat(64)}/placeholder`;
const placeholderVisual = {
  clipId: "placeholder",
  kind: "video" as const,
  src: placeholderSource,
  from: 0,
  durationInFrames: 1,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
};

export const defaultStoryboardShotProps: StoryboardShotCompositionProps = {
  ...defaultCompositionProps,
  target: "shot",
  projectId: "placeholder-project",
  chapterId: "placeholder-chapter",
  shotId: "placeholder-shot",
  shotRevision: 1,
  visualClips: [{ ...placeholderVisual, kind: "image" }],
  audioClips: [],
};

export const defaultChapterVideoProps: ChapterVideoCompositionProps = {
  ...defaultCompositionProps,
  target: "chapter",
  projectId: "placeholder-project",
  chapterId: "placeholder-chapter",
  editingProjectId: "placeholder-editing",
  editingRevision: 1,
  visualClips: [placeholderVisual],
  audioClips: [],
};

export const calculateCompositionMetadata: CalculateMetadataFunction<CompositionProps> = ({ props }) => {
  const validated = assertValid(validateCompositionProps(props));
  return {
    durationInFrames: validated.durationInFrames,
    fps: validated.fps,
    width: validated.width,
    height: validated.height,
    props: validated,
  };
};

export const calculateStoryboardShotMetadata: CalculateMetadataFunction<StoryboardShotCompositionProps>
  = ({ props }) => targetMetadata(assertValid(validateStoryboardShotCompositionProps(props)));

export const calculateChapterVideoMetadata: CalculateMetadataFunction<ChapterVideoCompositionProps>
  = ({ props }) => targetMetadata(assertValid(validateChapterVideoCompositionProps(props)));

export function RemotionRoot(): React.ReactElement {
  return (
    <>
      <Composition
        id={STORYBOARD_SHOT_COMPOSITION_ID}
        component={StoryboardShotComposition}
        durationInFrames={defaultStoryboardShotProps.durationInFrames}
        fps={defaultStoryboardShotProps.fps}
        width={defaultStoryboardShotProps.width}
        height={defaultStoryboardShotProps.height}
        defaultProps={defaultStoryboardShotProps}
        calculateMetadata={calculateStoryboardShotMetadata}
      />
      <Composition
        id={CHAPTER_VIDEO_COMPOSITION_ID}
        component={ChapterVideoComposition}
        durationInFrames={defaultChapterVideoProps.durationInFrames}
        fps={defaultChapterVideoProps.fps}
        width={defaultChapterVideoProps.width}
        height={defaultChapterVideoProps.height}
        defaultProps={defaultChapterVideoProps}
        calculateMetadata={calculateChapterVideoMetadata}
      />
      <Composition
        id={DAOJIE_TIMELINE_COMPATIBILITY_COMPOSITION_ID}
        component={RemotionComposition}
        durationInFrames={defaultCompositionProps.durationInFrames}
        fps={defaultCompositionProps.fps}
        width={defaultCompositionProps.width}
        height={defaultCompositionProps.height}
        defaultProps={defaultCompositionProps}
        calculateMetadata={calculateCompositionMetadata}
      />
    </>
  );
}

function assertValid<T>(result: CompositionValidationResult<T>): T {
  if (!result.success) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return result.value;
}

function targetMetadata<T extends CompositionProps>(props: T) {
  return {
    durationInFrames: props.durationInFrames,
    fps: props.fps,
    width: props.width,
    height: props.height,
    props,
  };
}

registerRoot(RemotionRoot);

export default RemotionRoot;
