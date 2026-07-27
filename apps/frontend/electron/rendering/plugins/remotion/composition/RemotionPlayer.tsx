import { Player } from "@remotion/player";
import { useEffect } from "react";
import type { CompositionProps } from "./composition-props";
import { validateCompositionProps } from "./composition-props-validation";
import { RemotionComposition } from "./RemotionComposition";

export interface PreviewMediaSession {
  mount(): void;
  unmount(): void;
}

export interface RemotionPlayerProps {
  composition: CompositionProps;
  session?: PreviewMediaSession;
  className?: string;
}

export function RemotionPlayer({ composition, session, className }: RemotionPlayerProps): React.ReactElement | null {
  const validated = validateCompositionProps(composition);
  useEffect(() => {
    if (!validated.success || !session) return undefined;
    session.mount();
    return () => session.unmount();
  }, [session, validated.success]);
  if (!validated.success) return null;
  return (
    <Player
      className={className}
      component={RemotionComposition}
      inputProps={validated.value}
      durationInFrames={validated.value.durationInFrames}
      fps={validated.value.fps}
      compositionWidth={validated.value.width}
      compositionHeight={validated.value.height}
      controls
    />
  );
}
