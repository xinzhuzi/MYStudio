// vsc:drone-dive-landing —— 无人机俯冲降落(card: references/shots/
// camera/space-camera-moves.md 式 C @ 5ddbf521,参考实现 demos/camera/
// space-camera-moves/DroneDiveLanding.tsx)。
// 上帝视角俯视整帧(近垂直俯角 rotateX 72°、缩小全景 0.42、悬在中央
// 偏上),猛扎下来——一条行程 p 驱动三轴联动(俯角抬平 72°→0、放大
// 0.42→1.35、平移收拢),速度曲线两段拼:主俯冲 25f Easing.in(cubic)
// 吃 82% 行程,气垫 20f Easing.out(poly(5)) 走 18%(切换帧速度骤降 =
// 气垫顶住的体感;82/18 比例比帧数更关键),稳稳停在主体锚点正前方
// 特写。全场包 CameraMotionBlur(220/9)+ 页面下方椭圆软影随落地收干
// (软影卖「悬空高度」,blur 卖速度,缺一维就假)。
//
// 与上游 demo 的差异(改造说明全文见 ../ATTRIBUTION-vsc.md):
// - 媒体=分镜静图 media bridge capability URL(上游 FakeDashboard 假
//   素材剥离;单图 cover,平面=整帧)。
// - 落点锚点单镜推广:上游 transformOrigin 钉 hero 卡中心 (518,335)
//   (demo 网格的特定格),平移终点=锚点对准画面中心;本版 originX/Y
//   百分比给锚点(缺省中心),起手偏移沿用上游 (774,485)−(960,540)=
//   (-186,-55) 的「悬在中央偏上」构图。帧尺寸经 useVideoConfig 取真值
//   (composition 固定 1920×1080,纯函数缺省与之同步)。
// - 参数烧死卡片默认值(D4:AI 只选 id 不调参;首批 motionParams 不接)。

import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { droneDiveAtFrame, type DroneDiveCurveOptions } from "./vsc-helpers";

/** 全链命名锚(design §1.4:vsc: 前缀+卡名 kebab-case,注册表/AI 指南/校验器同一名字)。 */
export const VSC_DRONE_DIVE_LANDING_ID = "vsc:drone-dive-landing";

export interface DroneDiveLandingProps {
  /** 分镜静图 media bridge capability URL(渲染与 Player 同源同图)。 */
  src: string;
  /**
   * 媒体形态(10-10 批B):image=分镜静图(缺省,批A 原语义);video=current
   * shot MP4(章节装配路径)——俯冲三轴联动作用于整段镜头视频,音轨透传同 VisualClip。
   */
  kind?: "image" | "video";
  /** video 专用:裁剪/倍速/静音(缺省不裁/1 倍/静音)。 */
  trimStartFrames?: number;
  playbackRate?: number;
  muted?: boolean;
  volume?: number;
  /** 前置 hold 帧(建立上帝视角)。缺省 20。 */
  diveStartFrame?: number;
  /** 主俯冲段/气垫段帧数。缺省 25 / 20。 */
  diveFrames?: number;
  landFrames?: number;
  /** 俯冲段行程占比。缺省 0.82(82/18 比例比帧数更关键)。 */
  diveShare?: number;
  /** 俯角抬平(deg)。缺省 rotateX 72° → 0°。 */
  fromRotateXDeg?: number;
  toRotateXDeg?: number;
  /** 缩放。缺省 0.42(全景平躺)→ 1.35(主体特写)。 */
  fromScale?: number;
  toScale?: number;
  /** 落点主体锚点(0..1 画面百分比;origin 钉死在这里,缺省中心)。 */
  originX?: number;
  originY?: number;
  /** 起手悬停相对落点终位的像素偏移。缺省 (-186,-55)(上游起手构图)。 */
  startOffsetXPx?: number;
  startOffsetYPx?: number;
  /** 构图帧尺寸(纯函数直调时的缺省;组件内由 useVideoConfig 覆写)。 */
  frameWidthPx?: number;
  frameHeightPx?: number;
}

function droneDiveOptions(
  props: DroneDiveLandingProps,
  width: number,
  height: number,
): DroneDiveCurveOptions {
  return {
    diveStartFrame: props.diveStartFrame,
    diveFrames: props.diveFrames,
    landFrames: props.landFrames,
    diveShare: props.diveShare,
    fromRotateXDeg: props.fromRotateXDeg,
    toRotateXDeg: props.toRotateXDeg,
    fromScale: props.fromScale,
    toScale: props.toScale,
    originX: props.originX,
    originY: props.originY,
    startOffsetXPx: props.startOffsetXPx,
    startOffsetYPx: props.startOffsetYPx,
    frameWidthPx: width,
    frameHeightPx: height,
  };
}

/**
 * 纯采样:某帧的页面平面样式(一条 p 驱动 rotateX+scale+translate 三轴
 * 联动;boxShadow 随俯角压深——页面悬空的重量线索)。
 * 不依赖 React 上下文——帧级确定性测试直接吃这个函数。
 */
export function droneDivePlaneStyleAtFrame(
  frame: number,
  props: DroneDiveLandingProps,
  frameWidth = 1920,
  frameHeight = 1080,
): React.CSSProperties {
  const sample = droneDiveAtFrame(frame, droneDiveOptions(props, frameWidth, frameHeight));
  const originX = clampUnit(props.originX ?? 0.5);
  const originY = clampUnit(props.originY ?? 0.5);
  return {
    width: "100%",
    height: "100%",
    transformOrigin: `${trimFloat(originX * 100)}% ${trimFloat(originY * 100)}%`,
    transform:
      `translate(${trimFloat(sample.translateXPx)}px, ${trimFloat(sample.translateYPx)}px) ` +
      `rotateX(${trimFloat(sample.rotateXDeg)}deg) ` +
      `scale(${trimFloat(sample.scale)})`,
    boxShadow:
      `0 ${trimFloat(6 + (1 - sample.p) * 30)}px ` +
      `${trimFloat(20 + (1 - sample.p) * 60)}px ` +
      `rgba(0,0,0,${trimFloat(0.1 + (1 - sample.p) * 0.14)})`,
    borderRadius: 6,
    overflow: "hidden",
  };
}

/**
 * 纯采样:某帧的地面软影样式(俯视期页面下方一团椭圆软影,落地立正后
 * 收干;宽随 scale 张合,位置钉在帧下半——上游同款高度感线索)。
 */
export function droneDiveShadowStyleAtFrame(
  frame: number,
  props: DroneDiveLandingProps,
  frameWidth = 1920,
  frameHeight = 1080,
): React.CSSProperties {
  const sample = droneDiveAtFrame(frame, droneDiveOptions(props, frameWidth, frameHeight));
  return {
    position: "absolute",
    left: `${trimFloat(frameWidth / 2 - sample.shadowWidthPx / 2)}px`,
    top: `${trimFloat(frameHeight * (620 / 1080))}px`,
    width: `${trimFloat(sample.shadowWidthPx)}px`,
    height: `${trimFloat(frameHeight * (320 / 1080))}px`,
    borderRadius: "50%",
    background: SHADOW_GRADIENT,
    opacity: trimFloat(sample.shadowOpacity),
    filter: "blur(18px)",
  };
}

function DroneDiveScene(props: DroneDiveLandingProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={OVERFLOW_FRAME}>
      {/* 地面软影(高度感线索):俯视时页面悬空,下方拖影;落地后收干。 */}
      <div style={droneDiveShadowStyleAtFrame(frame, props, width, height)} />
      {/* 相机 = perspective 容器;页面平面(AbsoluteFill=满幅定位)绕主体锚点做
          rotateX + scale + translate。 */}
      <AbsoluteFill style={{ perspective: 1400 }}>
        <AbsoluteFill style={droneDivePlaneStyleAtFrame(frame, props, width, height)}>
          {props.kind === "video" ? (
            <OffthreadVideo
              src={props.src}
              trimBefore={props.trimStartFrames}
              playbackRate={props.playbackRate ?? 1}
              muted={props.muted ?? true}
              volume={props.volume ?? 1}
              style={COVER_STYLE}
            />
          ) : (
            <Img src={props.src} style={COVER_STYLE} />
          )}
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/**
 * 全场包 CameraMotionBlur(shutterAngle 220 / samples 9,卡片氛围参数;
 * 上游同款无窗口——俯冲+气垫全程都要速度感)。
 */
export function DroneDiveLanding(props: DroneDiveLandingProps): React.ReactElement {
  return (
    <CameraMotionBlur shutterAngle={220} samples={9}>
      <DroneDiveScene {...props} />
    </CameraMotionBlur>
  );
}

// Fill the composition frame while preserving the source aspect ratio
// (与 VisualClip 的 COVER_STYLE 同义;配方文件自持,不跨文件借常量)。
const COVER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

// 上帝视角底色(上游 G.bg 灰;俯冲缩小期页面四周可见)。
const OVERFLOW_FRAME: React.CSSProperties = {
  background: "#ececea",
  overflow: "hidden",
};

// 地面软影渐变(上游 DroneDiveLanding.tsx 逐字节同串)。
const SHADOW_GRADIENT =
  "radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 68%)";

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Trim float noise so identical math yields byte-identical style strings
// (crash-zoom-punch.tsx trimFloat 同纪律)。
function trimFloat(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
