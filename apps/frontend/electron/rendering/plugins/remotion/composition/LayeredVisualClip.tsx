// 图层分离分层渲染（08-19 图层分离探索→multilayer-composition Child1）：
// - layerStack（N 层,08-19 Child1）：有序层各自渲染——图片层按 damp 折减运镜
//   （围绕 1.0 收敛）+ 本层 ambient + drift 漂移；atmosphere 层由程序化模板
//   实例化（atmosphere-layers.tsx）；grade 修复=每层各自 GLGradeMedia（逐像素
//   LUT,分层套≈合成后套）；frameStep 与单层 VisualClip 同式帧量化。
// - layers（旧二元组,兼容保留）：背景/主体双层视差（背景运镜折减+主体 ambient）。
// 两路均为静帧图片层；单层（无 layers/layerStack）路径在 VisualClip,不在此。

import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useRemotionEnvironment, useVideoConfig } from "remotion";
import { GLGradeMedia } from "./GLGradeMedia";
import { AtmosphereTemplateLayer, layerPanZoomDamp } from "./atmosphere-layers";
import { ambientAtFrame, panZoomAtFrame } from "./pan-zoom";
import {
  fxChromaLayerStyle,
  fxFilter,
  fxGodRaysOverlayStyle,
  fxGlowOverlayStyle,
  fxGrainOverlayStyle,
  fxShakeOffset,
  fxSpeedSilhouetteStyle,
  fxAliasingLayerStyle,
} from "./visual-fx";
import type { CompositionVisualFx } from "./visual-fx";
import type { CompositionLayerSpec, CompositionPanZoom, CompositionVisualClipProps } from "./composition-props";
import type { CompositionAmbient } from "./pan-zoom";

export interface LayeredVisualClipProps {
  /** 旧二元组路径（深度拆层 standalone/proof 脚本注入）。 */
  backgroundSrc?: string;
  subjectSrc?: string;
  parallax?: number;
  /** N 层路径（08-19 multilayer-composition Child1）。 */
  layerStack?: CompositionLayerSpec[];
  durationInFrames: number;
  panZoom?: CompositionPanZoom;
  ambient?: CompositionAmbient;
  /** 镜头级 2D 特效（08-21 补——此前 layerStack 分支不透传,8 个氛围镜的
   * shake/glow/grain/godRays/残影全被静默丢弃,运镜同丢）。 */
  fx?: CompositionVisualFx;
  /** 层分支此前丢弃 grade/frameStep（RemotionComposition 不透传），Child1 修复。 */
  grade?: CompositionVisualClipProps["grade"];
  frameStep?: number;
  /** 垫底媒体（氛围-only 栈用）：栈内无 background/subject 图片层时渲染原媒体
   * （视频镜=OffthreadVideo、静帧=Img），grade/裁剪同单层语义——否则视频镜
   * 只有氛围层会把本体丢成黑底（08-20 一键成片真跑暴露）。 */
  baseSrc?: string;
  baseKind?: "image" | "video";
  trimStartFrames?: number;
  playbackRate?: number;
  muted?: boolean;
}

export function LayeredVisualClip(props: LayeredVisualClipProps): React.ReactElement {
  if (props.layerStack?.length) {
    return <StackedLayersClip {...props} layerStack={props.layerStack} />;
  }
  // 旧二元组（双层视差）:保留 08-19 图层分离探索的既有行为。
  if (!props.backgroundSrc || !props.subjectSrc) {
    throw new Error("LayeredVisualClip 需要 layerStack 或 backgroundSrc+subjectSrc");
  }
  return (
    <LegacyTwoLayerClip
      backgroundSrc={props.backgroundSrc}
      subjectSrc={props.subjectSrc}
      parallax={props.parallax}
      durationInFrames={props.durationInFrames}
      panZoom={props.panZoom}
      ambient={props.ambient}
      grade={props.grade}
      frameStep={props.frameStep}
    />
  );
}

// ---------------------------------------------------------------------------
// N 层渲染
// ---------------------------------------------------------------------------

function StackedLayersClip(props: Required<Pick<LayeredVisualClipProps, "layerStack">> & LayeredVisualClipProps): React.ReactElement {
  const rawFrame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { isRendering } = useRemotionEnvironment();
  const step = props.frameStep && props.frameStep > 1 ? props.frameStep : 1;
  const frame = Math.floor(rawFrame / step) * step;
  const t = rawFrame / fps;
  const gradeBlend = props.grade
    ? Math.min(1, Math.max(0, props.grade.blend
        + (props.grade.blendPulse
          ? props.grade.blendPulse.amp * Math.sin(frame / fps * props.grade.blendPulse.freq * Math.PI * 2 + (props.grade.blendPulse.phase ?? 0))
          : 0)))
    : undefined;
  // 栈内含图片层(background/subject 带 src)=分层合成接管媒体位;
  // 氛围-only 栈(视频镜典型)=原媒体垫底,氛围层叠加其上。
  const hasImageLayers = props.layerStack.some((layer) => Boolean(layer.src));
  const baseSrc = !hasImageLayers ? props.baseSrc : undefined;
  // 垫底媒体的 clip 级运动(08-21 补——氛围-only 栈此前不接 panZoom/ambient,
  // 8 个氛围镜运镜与环境动画全丢):满运镜(damp=1)+ambient 周期偏移,
  // 与 VisualClip 单层路径同构。
  const basePan = baseSrc && props.panZoom
    ? panZoomAtFrame(frame, props.durationInFrames, props.panZoom, fps)
    : undefined;
  const baseAmbient = baseSrc && props.ambient
    ? ambientAtFrame(frame, fps, props.ambient)
    : null;
  const baseMediaStyle: React.CSSProperties = {
    transform: basePan || baseAmbient
      ? `scale(${((basePan?.scale ?? 1) * (baseAmbient && baseAmbient.deltaScale !== 0 ? 1 + baseAmbient.deltaScale : 1)).toFixed(5)})${baseAmbient && baseAmbient.deltaRot !== 0 ? ` rotate(${baseAmbient.deltaRot.toFixed(3)}deg)` : ""}`
      : undefined,
    transformOrigin: basePan ? `${basePan.originX * 100}% ${basePan.originY * 100}%` : undefined,
    left: `${((baseAmbient?.offsetX ?? 0) * 100).toFixed(3)}%`,
    top: `${((baseAmbient?.offsetY ?? 0) * 100).toFixed(3)}%`,
  };
  // 镜头级 fx(08-21 补):shake 作用于整个容器(所有层一起抖,与 VisualClip 同);
  // glow 的 brightness/saturate 提亮作用于容器;叠层在全部层之上。
  const shake = props.fx ? fxShakeOffset(frame, props.fx) : undefined;
  const containerFilter = props.fx ? fxFilter(props.fx) : undefined;
  return (
    <AbsoluteFill
      style={{
        ...(baseSrc ? baseMediaStyle : {}),
        ...(shake ? { left: shake.x, top: shake.y } : {}),
        ...(containerFilter ? { filter: containerFilter } : {}),
      }}
    >
      {baseSrc ? (
        props.grade?.lutSrc && isRendering ? (
          <>
            <GLGradeMedia
              src={baseSrc}
              kind={props.baseKind ?? "image"}
              trimStartFrames={props.trimStartFrames}
              playbackRate={props.playbackRate}
              durationInFrames={props.durationInFrames}
              lutSrc={props.grade.lutSrc}
              blend={gradeBlend ?? props.grade.blend}
            />
            {props.baseKind === "video" ? (
              <OffthreadVideo
                src={baseSrc}
                trimBefore={props.trimStartFrames}
                playbackRate={props.playbackRate ?? 1}
                muted={props.muted ?? true}
                style={HIDDEN_AUDIO_STYLE}
              />
            ) : null}
          </>
        ) : props.baseKind === "video" ? (
          <OffthreadVideo
            src={baseSrc}
            trimBefore={props.trimStartFrames}
            playbackRate={props.playbackRate ?? 1}
            muted={props.muted ?? true}
            style={COVER_STYLE}
          />
        ) : (
          <Img src={baseSrc} style={COVER_STYLE} />
        )
      ) : null}
      {props.layerStack.map((layer, index) => {
        const damp = layerPanZoomDamp(layer);
        // 折减围绕 1.0 收敛（from=1 时该层不动）——与旧二元组公式一致。
        const pan = props.panZoom
          ? panZoomAtFrame(frame, props.durationInFrames, {
              ...props.panZoom,
              fromScale: 1 + (props.panZoom.fromScale - 1) * damp,
              toScale: 1 + (props.panZoom.toScale - 1) * damp,
            }, fps)
          : undefined;
        // clip 级 ambient 由 subject 层继承（旧二元组语义：主体独享环境动画）；
        // 层自带 ambient 优先,不双重施加。
        const ambientSource = layer.ambient ?? (layer.role === "subject" ? props.ambient : undefined);
        const ambient = ambientSource ? ambientAtFrame(frame, fps, ambientSource) : null;
        const driftX = layer.drift?.speedX ? (t * layer.drift.speedX) : 0;
        const driftY = layer.drift?.speedY ? (t * layer.drift.speedY) : 0;
        const useGradeMedia = Boolean(props.grade?.lutSrc) && isRendering && layer.src;
        const ambientScale = ambient && ambient.deltaScale !== 0 ? 1 + ambient.deltaScale : 1;
        const ambientRot = ambient && ambient.deltaRot !== 0 ? ambient.deltaRot : 0;
        return (
          <AbsoluteFill
            key={index}
            style={{
              transform: pan || ambientScale !== 1 || ambientRot !== 0
                ? `scale(${((pan?.scale ?? 1) * ambientScale).toFixed(5)})${ambientRot !== 0 ? ` rotate(${ambientRot.toFixed(3)}deg)` : ""}`
                : undefined,
              transformOrigin: pan ? `${pan.originX * 100}% ${pan.originY * 100}%` : undefined,
              left: `${((ambient?.offsetX ?? 0) + driftX).toFixed(3)}%`,
              top: `${((ambient?.offsetY ?? 0) + driftY).toFixed(3)}%`,
              ...(layer.blendMode && layer.blendMode !== "normal" ? { mixBlendMode: layer.blendMode } : {}),
              ...(layer.opacity !== undefined ? { opacity: layer.opacity } : {}),
            }}
          >
            {layer.src ? (
              useGradeMedia ? (
                <GLGradeMedia
                  src={layer.src}
                  kind="image"
                  durationInFrames={props.durationInFrames}
                  lutSrc={props.grade!.lutSrc!}
                  blend={gradeBlend ?? props.grade!.blend}
                />
              ) : (
                <Img src={layer.src} style={COVER_STYLE} />
              )
            ) : layer.template ? (
              <AtmosphereTemplateLayer template={layer.template} />
            ) : null}
          </AbsoluteFill>
        );
      })}
      {props.fx?.chroma && baseSrc ? (
        <>
          <AbsoluteFill style={fxChromaLayerStyle(props.fx, "red")}>
            {props.baseKind === "image" ? <Img src={baseSrc} style={COVER_STYLE} /> : <OffthreadVideo src={baseSrc} muted style={COVER_STYLE} />}
          </AbsoluteFill>
          <AbsoluteFill style={fxChromaLayerStyle(props.fx, "cyan")}>
            {props.baseKind === "image" ? <Img src={baseSrc} style={COVER_STYLE} /> : <OffthreadVideo src={baseSrc} muted style={COVER_STYLE} />}
          </AbsoluteFill>
        </>
      ) : null}
      {props.fx?.glow ? <AbsoluteFill style={fxGlowOverlayStyle(props.fx)} /> : null}
      {props.fx?.grain ? <AbsoluteFill style={fxGrainOverlayStyle(props.fx)} /> : null}
      {props.fx?.afterimage && baseSrc
        ? Array.from({ length: props.fx.afterimage.copies }, (_, i) => (
            <AbsoluteFill key={`afterimage-${i}`} style={fxAliasingLayerStyle(props.fx!, i + 1)}>
              {props.baseKind === "image" ? <Img src={baseSrc} style={COVER_STYLE} /> : <OffthreadVideo src={baseSrc} muted style={COVER_STYLE} />}
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

// ---------------------------------------------------------------------------
// 旧二元组（双层视差,08-19 图层分离探索原行为）
// ---------------------------------------------------------------------------

function LegacyTwoLayerClip(props: {
  backgroundSrc: string;
  subjectSrc: string;
  parallax?: number;
  durationInFrames: number;
  panZoom?: CompositionPanZoom;
  ambient?: CompositionAmbient;
  grade?: LayeredVisualClipProps["grade"];
  frameStep?: number;
}): React.ReactElement {
  const rawFrame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const step = props.frameStep && props.frameStep > 1 ? props.frameStep : 1;
  const frame = Math.floor(rawFrame / step) * step;
  const parallax = Math.min(1, Math.max(0, props.parallax ?? 0.5));
  // 背景运镜折减系数：视差越大背景越「懒」
  const bgDamp = 1 - 0.4 * parallax;

  const subjectPan = props.panZoom
    ? panZoomAtFrame(frame, props.durationInFrames, props.panZoom, fps)
    : undefined;
  const backgroundPan = props.panZoom
    ? panZoomAtFrame(frame, props.durationInFrames, {
        ...props.panZoom,
        // 折减围绕 1.0 收敛，保持首帧两层对齐（from=1 时背景不动）
        fromScale: 1 + (props.panZoom.fromScale - 1) * bgDamp,
        toScale: 1 + (props.panZoom.toScale - 1) * bgDamp,
      }, fps)
    : undefined;

  const ambient = props.ambient
    ? ambientAtFrame(frame, fps, props.ambient)
    : null;

  return (
    <AbsoluteFill>
      <AbsoluteFill style={layerStyle(backgroundPan, 0, 0)}>
        <Img src={props.backgroundSrc} style={COVER_STYLE} />
      </AbsoluteFill>
      <AbsoluteFill
        style={layerStyle(
          subjectPan,
          ambient?.offsetX ?? 0,
          ambient?.offsetY ?? 0,
        )}
      >
        <Img
          src={props.subjectSrc}
          style={{
            ...COVER_STYLE,
            transform:
              ambient && (ambient.deltaScale !== 0 || ambient.deltaRot !== 0)
                ? `scale(${1 + (ambient.deltaScale ?? 0)}) rotate(${ambient.deltaRot ?? 0}deg)`
                : undefined,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function layerStyle(
  pan: { scale: number; originX: number; originY: number } | undefined,
  offsetX: number,
  offsetY: number,
): React.CSSProperties {
  return {
    transform: pan ? `scale(${pan.scale})` : undefined,
    transformOrigin: pan
      ? `${pan.originX * 100}% ${pan.originY * 100}%`
      : undefined,
    left: `${offsetX * 100}%`,
    top: `${offsetY * 100}%`,
  };
}

// 音轨载体专用:视觉由 GLGradeMedia 承担,此元素只携带音频(不可见)。
const HIDDEN_AUDIO_STYLE: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: "none",
};

const COVER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};
