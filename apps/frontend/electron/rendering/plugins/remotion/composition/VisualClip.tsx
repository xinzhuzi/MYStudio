// Design §6: a single visual clip. Images use Img; videos use OffthreadVideo
// with frame-based trim/speed. panZoom is sampled per frame (pan-zoom.ts) and
// folded into the CSS transform (visual-style.ts). The component is a thin
// wrapper over verified pure helpers and receives only a capability URL as src.

import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame } from "remotion";
import type { CompositionVisualClipProps } from "./composition-props";
import { panZoomAtFrame } from "./pan-zoom";
import { buildVisualStyle } from "./visual-style";

export function VisualClip(props: CompositionVisualClipProps): React.ReactElement {
  const frame = useCurrentFrame();
  const panZoom = props.panZoom
    ? panZoomAtFrame(frame, props.durationInFrames, props.panZoom)
    : undefined;
  const style = buildVisualStyle(props.transform, panZoom);

  return (
    <AbsoluteFill style={style}>
      {props.kind === "image" ? (
        <Img src={props.src} style={COVER_STYLE} />
      ) : (
        <OffthreadVideo
          src={props.src}
          trimBefore={props.trimStartFrames}
          playbackRate={props.playbackRate ?? 1}
          muted={props.muted ?? true}
          style={COVER_STYLE}
        />
      )}
    </AbsoluteFill>
  );
}

// Fill the composition frame while preserving the source aspect ratio.
const COVER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};
