// 图层分离分层渲染（08-19 图层分离探索）：把单张图拆成的背景层+主体层
// 分别渲染，各自独立运镜——背景 panZoom 按 parallax 折减、主体吃满运镜
// 并可叠加 ambient 周期运动，形成手绘动画摄影台式的视差（背景缓慢、
// 主体灵动）。两层均为图片（layer_separation 只处理静帧），不涉及视频。
//
// 输入 src 为 media-bridge capability URL；分层产物由 build 侧注入。

import { AbsoluteFill, Img, useCurrentFrame } from "remotion";
import { ambientAtFrame, panZoomAtFrame } from "./pan-zoom";
import type { CompositionPanZoom } from "./composition-props";
import type { CompositionAmbient } from "./pan-zoom";

export interface LayeredVisualClipProps {
  /** 背景层（被遮挡区域已模糊填充）URL。 */
  backgroundSrc: string;
  /** 主体层（带 alpha）URL。 */
  subjectSrc: string;
  durationInFrames: number;
  panZoom?: CompositionPanZoom;
  /** 环境动画只作用于主体层（背景恒稳，视差更可读）。 */
  ambient?: CompositionAmbient;
  /**
   * 视差强度 0..1：背景运镜幅度 = 主体 × (1 - 0.4 × parallax)。
   * 0 = 两层同步（无视差），0.5 为推荐值。
   */
  parallax?: number;
}

export function LayeredVisualClip(props: LayeredVisualClipProps): React.ReactElement {
  const frame = useCurrentFrame();
  const parallax = Math.min(1, Math.max(0, props.parallax ?? 0.5));
  // 背景运镜折减系数：视差越大背景越「懒」
  const bgDamp = 1 - 0.4 * parallax;

  const subjectPan = props.panZoom
    ? panZoomAtFrame(frame, props.durationInFrames, props.panZoom)
    : undefined;
  const backgroundPan = props.panZoom
    ? panZoomAtFrame(frame, props.durationInFrames, {
        ...props.panZoom,
        // 折减围绕 1.0 收敛，保持首帧两层对齐（from=1 时背景不动）
        fromScale: 1 + (props.panZoom.fromScale - 1) * bgDamp,
        toScale: 1 + (props.panZoom.toScale - 1) * bgDamp,
      })
    : undefined;

  const ambient = props.ambient
    ? ambientAtFrame(frame, 30, props.ambient)
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

const COVER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};
