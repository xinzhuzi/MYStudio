// vsc:crash-zoom-punch —— 急推点名(card: references/shots/camera/crash-zoom-punch.md
// @ 5ddbf521,参考实现 demos/camera/crash-zoom-punch/CrashZoomReal.tsx + CrashImpactReal.tsx)。
// 全景一拍急推到目标特写(6f ease-in 1→2.6),落位二选一:
//   rebound = 过冲回弹 3–6%(2.6→2.45,弹性「看这个」)
//   impact  = 撞停震屏 14px·e^(−t/1.8)(重量「就是它」)
// 曲线全在 vsc-helpers.ts(纯函数,帧级确定性);本组件是薄包装——与 VisualClip
// 同纪律:只采样曲线并投影成 CSS transform。
//
// 与上游 demo 的差异(改造说明全文见 ../ATTRIBUTION-vsc.md):
// - 媒体=分镜静图 media bridge capability URL(上游的 UI 假素材/高清卡贴图全剥离,
//   单图 cover 满幅,推近目标由 originX/originY 百分比给出)。
// - <CameraMotionBlur shutterAngle={200} samples={20}> 只包急推段:impact 款
//   [start−2, hit](震屏段保持清晰抖动),rebound 款 [start−2, hit+2](回弹初速
//   仍高)——两窗口分别对齐上游 CrashImpactReal / CrashZoomReal。
//   motion-blur 为 DOM 采样,Player 与固定 bundle 同路径(无需近似标注)。
// - 参数烧死卡片默认值(D4:AI 只选 id 不调参;首批 motionParams 不接)。

import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame } from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import {
  crashZoomScaleAtFrame,
  impactShakeAtFrame,
  type CrashZoomCurveOptions,
} from "./vsc-helpers";

/** 全链命名锚(design §1.4:vsc: 前缀+卡名 kebab-case,注册表/AI 指南/校验器同一名字)。 */
export const VSC_CRASH_ZOOM_PUNCH_ID = "vsc:crash-zoom-punch";

export interface CrashZoomPunchProps {
  /** 分镜静图 media bridge capability URL(渲染与 Player 同源同图)。 */
  src: string;
  /**
   * 媒体形态(10-10 批B):image=分镜静图(缺省,批A 原语义);video=current
   * shot MP4(章节装配路径)——急推作用于整段镜头视频,音轨透传同 VisualClip。
   */
  kind?: "image" | "video";
  /** video 专用:裁剪/倍速/静音(缺省不裁/1 倍/静音;章节镜语音在位时 muted=false)。 */
  trimStartFrames?: number;
  playbackRate?: number;
  muted?: boolean;
  volume?: number;
  /** 急推起始帧。缺省 30 = 卡片「前 hold ≥30f 建立全景」。 */
  startFrame?: number;
  /** 急推时长(帧)。缺省 6(卡片 4–8f;>10f 冲击感消失)。 */
  zoomFrames?: number;
  /** 起点/终点 zoom。缺省 1 → 2.6(卡片目标 2.4–2.8)。 */
  fromScale?: number;
  toScale?: number;
  /**
   * 落位款式(卡片:两款别混用,一支片急推 ≤2 次):
   * - "rebound"(缺省):过冲回弹,fraction=回收比例(缺省 0.058≈2.6→2.45,卡片 3–6%)
   * - "impact":撞停震屏(14px·e^(−t/1.8)),不回弹
   */
  landing?: "rebound" | "impact";
  /** 回弹参数(仅 rebound 款)。 */
  rebound?: { frames?: number; fraction?: number };
  /** 震屏参数(仅 impact 款)。缺省 14px / τ=1.8f。 */
  shake?: { amplitudePx?: number; tau?: number };
  /** 推近目标点(0..1 画面百分比;缺省中心——「终点吃分镜静图」的构图锚)。 */
  originX?: number;
  originY?: number;
}

/** 曲线参数投影(props 的卡片默认值 → vsc-helpers 曲线入参)。 */
function curveOptions(props: CrashZoomPunchProps): CrashZoomCurveOptions {
  return {
    startFrame: props.startFrame ?? 30,
    zoomFrames: props.zoomFrames,
    fromScale: props.fromScale,
    toScale: props.toScale,
    rebound: props.landing === "impact" ? undefined : {
      frames: props.rebound?.frames,
      fraction: props.rebound?.fraction,
    },
  };
}

/**
 * 纯采样:某帧的媒体层样式(scale=急推曲线;impact 款叠加撞停震屏 px 偏移)。
 * 不依赖 React 上下文——帧级确定性测试直接吃这个函数。
 */
export function crashZoomPunchStyleAtFrame(
  frame: number,
  props: CrashZoomPunchProps,
): React.CSSProperties {
  const opts = curveOptions(props);
  const scale = crashZoomScaleAtFrame(frame, opts);
  const shake = props.landing === "impact"
    ? impactShakeAtFrame(frame, { hitFrame: opts.startFrame + (opts.zoomFrames ?? 6), amplitudePx: props.shake?.amplitudePx, tau: props.shake?.tau })
    : { x: 0, y: 0 };
  const originX = clampUnit(props.originX ?? 0.5);
  const originY = clampUnit(props.originY ?? 0.5);
  return {
    transform: `translate(${shake.x}px, ${shake.y}px) scale(${trimFloat(scale)})`,
    transformOrigin: `${trimFloat(originX * 100)}% ${trimFloat(originY * 100)}%`,
  };
}

/** CameraMotionBlur 只包急推段(卡片已知坑;窗口口径见文件头改造说明)。 */
export function crashZoomBlurWindow(props: CrashZoomPunchProps): { from: number; to: number } {
  const start = props.startFrame ?? 30;
  const hit = start + (props.zoomFrames ?? 6);
  return { from: start - 2, to: props.landing === "impact" ? hit : hit + 2 };
}

function CrashZoomScene(props: CrashZoomPunchProps): React.ReactElement {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={crashZoomPunchStyleAtFrame(frame, props)}>
      {/* 终点吃分镜静图:cover 满幅,急推全程特写同一张图(无上游双贴图槽)。 */}
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
  );
}

export function CrashZoomPunch(props: CrashZoomPunchProps): React.ReactElement {
  const frame = useCurrentFrame();
  const window = crashZoomBlurWindow(props);
  const scene = <CrashZoomScene {...props} />;
  if (frame >= window.from && frame <= window.to) {
    return (
      <CameraMotionBlur shutterAngle={200} samples={20}>
        {scene}
      </CameraMotionBlur>
    );
  }
  return scene;
}

// Fill the composition frame while preserving the source aspect ratio
// (与 VisualClip 的 COVER_STYLE 同义;配方文件自持,不跨文件借常量)。
const COVER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Trim float noise so identical math yields byte-identical style strings
// (visual-style.ts round 同纪律,但配方层样式自 round)。
function trimFloat(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
