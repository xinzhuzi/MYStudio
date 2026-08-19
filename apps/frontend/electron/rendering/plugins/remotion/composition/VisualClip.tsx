// Design §6: a single visual clip. Images use Img; videos use OffthreadVideo
// with frame-based trim/speed. panZoom is sampled per frame (pan-zoom.ts) and
// folded into the CSS transform (visual-style.ts); fx (shake/glow/grain/chroma)
// layers on top (visual-fx.ts). The component is a thin wrapper over verified
// pure helpers and receives only a capability URL as src.

import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useRemotionEnvironment, useVideoConfig } from "remotion";
import type { CompositionVisualClipProps } from "./composition-props";
import { GLGradeMedia } from "./GLGradeMedia";
import { ambientAtFrame, panZoomAtFrame } from "./pan-zoom";
import { buildVisualStyle } from "./visual-style";
import {
  fxAliasingLayerStyle,
  fxChromaLayerStyle,
  fxFilter,
  fxGodRaysOverlayStyle,
  fxGlowOverlayStyle,
  fxGrainOverlayStyle,
  fxShakeOffset,
  fxSpeedSilhouetteStyle,
} from "./visual-fx";

export function VisualClip(props: CompositionVisualClipProps): React.ReactElement {
  const rawFrame = useCurrentFrame();
  const { isRendering } = useRemotionEnvironment();
  const { fps } = useVideoConfig();
  // 帧步进(On Twos,08-19 第二批):运镜/环境动画按 N 帧一档采样=动画「味道」,
  // 媒体本体不受影响(视频仍逐帧)。
  const step = props.frameStep && props.frameStep > 1 ? props.frameStep : 1;
  const frame = Math.floor(rawFrame / step) * step;
  const panZoom = props.panZoom
    ? panZoomAtFrame(frame, props.durationInFrames, props.panZoom)
    : undefined;
  // 环境动画:sin/cos 周期运动叠加在 panZoom 缓动之上(频率按 composition 实际
  // fps 归一——旧硬编码 30 在非 30fps 渲染下频率失真,Child1 修复)
  const ambient = props.ambient
    ? ambientAtFrame(frame, fps, props.ambient)
    : null;
  const style = buildVisualStyle(props.transform, panZoom);
  if (ambient) {
    const baseLeft = parseFloat(String(style.left)) || 0;
    const baseTop = parseFloat(String(style.top)) || 0;
    style.left = `${baseLeft + ambient.offsetX * 100}%`;
    style.top = `${baseTop + ambient.offsetY * 100}%`;
    if (ambient.deltaScale !== 0 && panZoom) {
      const base = panZoom.scale ?? 1;
      style.transform = `scale(${base + ambient.deltaScale})`;
    }
    if (ambient.deltaRot !== 0) {
      style.transform = `${style.transform || ""} rotate(${ambient.deltaRot}deg)`;
    }
  }
  const shake = props.fx ? fxShakeOffset(frame, props.fx) : undefined;
  const mediaStyle = props.fit === "contain" ? CONTAIN_STYLE : COVER_STYLE;
  const filter = props.fx ? fxFilter(props.fx) : undefined;
  // grade（成片调色）：渲染期由 GLGradeMedia 替代媒体位（LUT WebGL pass），
  // 外层 CSS 运镜/抖动照常作用；Player 预览回退原媒体（LUT 预览不可见）。
  const useGradeMedia = Boolean(props.grade?.lutSrc) && isRendering;
  // 色彩渐变动画(08-19 第二批):调色强度随情绪推进正弦脉动,clamp 0..1。
  const gradeBlend = props.grade
    ? Math.min(1, Math.max(0, props.grade.blend
        + (props.grade.blendPulse
          ? props.grade.blendPulse.amp * Math.sin(frame / fps * props.grade.blendPulse.freq * Math.PI * 2 + (props.grade.blendPulse.phase ?? 0))
          : 0)))
    : undefined;

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
          blend={gradeBlend ?? props.grade!.blend}
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
      {props.fx?.afterimage
        ? Array.from({ length: props.fx.afterimage.copies }, (_, i) => (
            <AbsoluteFill key={`afterimage-${i}`} style={fxAliasingLayerStyle(props.fx!, i + 1)}>
              {props.kind === "image" ? <Img src={props.src} style={mediaStyle} /> : <OffthreadVideo src={props.src} muted style={mediaStyle} />}
            </AbsoluteFill>
          ))
        : null}
      {props.fx?.speedSilhouette ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <div style={fxSpeedSilhouetteStyle(rawFrame, fps, props.fx)} />
        </AbsoluteFill>
      ) : null}
      {props.fx?.godRays ? <AbsoluteFill style={fxGodRaysOverlayStyle(rawFrame, props.fx)} /> : null}
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
