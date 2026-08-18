// Design §6: a single visual clip. Images use Img; videos use OffthreadVideo
// with frame-based trim/speed. panZoom is sampled per frame (pan-zoom.ts) and
// folded into the CSS transform (visual-style.ts); fx (shake/glow/grain/chroma)
// layers on top (visual-fx.ts). The component is a thin wrapper over verified
// pure helpers and receives only a capability URL as src.

import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useRemotionEnvironment } from "remotion";
import type { CompositionVisualClipProps } from "./composition-props";
import { GLGradeMedia } from "./GLGradeMedia";
import { panZoomAtFrame } from "./pan-zoom";
import { buildVisualStyle } from "./visual-style";
import {
  fxChromaLayerStyle,
  fxFilter,
  fxGlowOverlayStyle,
  fxGrainOverlayStyle,
  fxShakeOffset,
} from "./visual-fx";

export function VisualClip(props: CompositionVisualClipProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { isRendering } = useRemotionEnvironment();
  const panZoom = props.panZoom
    ? panZoomAtFrame(frame, props.durationInFrames, props.panZoom)
    : undefined;
  const style = buildVisualStyle(props.transform, panZoom);
  const shake = props.fx ? fxShakeOffset(frame, props.fx) : undefined;
  const mediaStyle = props.fit === "contain" ? CONTAIN_STYLE : COVER_STYLE;
  const filter = props.fx ? fxFilter(props.fx) : undefined;
  // grade（成片调色）：渲染期由 GLGradeMedia 替代媒体位（LUT WebGL pass），
  // 外层 CSS 运镜/抖动照常作用；Player 预览回退原媒体（LUT 预览不可见）。
  const useGradeMedia = Boolean(props.grade?.lutSrc) && isRendering;

  return (
    <AbsoluteFill style={{ ...style, ...(shake ? { left: shake.x, top: shake.y } : {}), ...(filter ? { filter } : {}) }}>
      {useGradeMedia ? (
        <GLGradeMedia
          src={props.src}
          kind={props.kind}
          trimStartFrames={props.trimStartFrames}
          playbackRate={props.playbackRate}
          durationInFrames={props.durationInFrames}
          lutSrc={props.grade!.lutSrc!}
          blend={props.grade!.blend}
        />
      ) : props.kind === "image" ? (
        <Img src={props.src} style={mediaStyle} />
      ) : (
        <OffthreadVideo
          src={props.src}
          trimBefore={props.trimStartFrames}
          playbackRate={props.playbackRate ?? 1}
          muted={props.muted ?? true}
          style={mediaStyle}
        />
      )}
      {props.fx?.chroma ? (
        <>
          <AbsoluteFill style={fxChromaLayerStyle(props.fx, "red")}>
            {props.kind === "image" ? <Img src={props.src} style={mediaStyle} /> : <OffthreadVideo src={props.src} muted style={mediaStyle} />}
          </AbsoluteFill>
          <AbsoluteFill style={fxChromaLayerStyle(props.fx, "cyan")}>
            {props.kind === "image" ? <Img src={props.src} style={mediaStyle} /> : <OffthreadVideo src={props.src} muted style={mediaStyle} />}
          </AbsoluteFill>
        </>
      ) : null}
      {props.fx?.glow ? <AbsoluteFill style={fxGlowOverlayStyle(props.fx)} /> : null}
      {props.fx?.grain ? <AbsoluteFill style={fxGrainOverlayStyle(props.fx)} /> : null}
    </AbsoluteFill>
  );
}

// Fill the composition frame while preserving the source aspect ratio.
const COVER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const CONTAIN_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
};
