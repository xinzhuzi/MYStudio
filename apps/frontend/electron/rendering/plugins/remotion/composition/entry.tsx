import {
  Composition,
  registerRoot,
  type CalculateMetadataFunction,
} from "remotion";
import { RemotionComposition } from "./RemotionComposition";
import type { CompositionProps } from "./composition-props";
import { validateCompositionProps } from "./composition-props-validation";
import { REMOTION_COMPOSITION_ID } from "./composition-id";

export { REMOTION_COMPOSITION_ID } from "./composition-id";
export const defaultCompositionProps: CompositionProps = {
  width: 1080, height: 1920, fps: 30, durationInFrames: 1,
  visualClips: [], transitions: [], audioClips: [], subtitles: [],
};

export const calculateCompositionMetadata: CalculateMetadataFunction<CompositionProps> = ({ props }) => {
  const validated = validateCompositionProps(props);
  if (!validated.success) {
    throw new Error(
      validated.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; "),
    );
  }
  return {
    durationInFrames: validated.value.durationInFrames,
    fps: validated.value.fps,
    width: validated.value.width,
    height: validated.value.height,
    props: validated.value,
  };
};

export function RemotionRoot(): React.ReactElement {
  return (
    <Composition
      id={REMOTION_COMPOSITION_ID}
      component={RemotionComposition}
      durationInFrames={defaultCompositionProps.durationInFrames}
      fps={defaultCompositionProps.fps}
      width={defaultCompositionProps.width}
      height={defaultCompositionProps.height}
      defaultProps={defaultCompositionProps}
      calculateMetadata={calculateCompositionMetadata}
    />
  );
}

registerRoot(RemotionRoot);

export default RemotionRoot;
