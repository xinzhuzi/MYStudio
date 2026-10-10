// vsc:slow-push-in —— 慢推压迫(card: references/shots/camera/
// tension-camera-moves.md 式 C @ 5ddbf521,参考实现 demos/camera/
// tension-camera-moves/SlowPushIn.tsx)。
// 4s(120f@30fps)匀加速推近 1.00→1.14,Easing.in(quad)——前 2 秒几乎
// 不可察是设计意图不是缺陷,后段明显可感(加速曲线是本体:匀速推读作普通
// zoom,幅度 >1.2 变成普通推镜头);四角径向暗角 opacity 0→0.5 同曲线渐深,
// 构成压迫感的第二来源。
//
// 与上游 demo 的差异(改造说明全文见 ../ATTRIBUTION-vsc.md):
// - 媒体=分镜静图 media bridge capability URL(上游的「10x FASTER THAN
//   BASELINE」假文案层剥离,单图 cover 满幅;暗景底色沿用上游 G.side)。
// - 顶点零过渡硬切语义留给转场链:上游 demo 帧 120 硬切到亮景 B
//   (FakeDashboard 真静止 30f),本组件只做景 A 的推近+暗角,到达
//   durationFrames 后钳制持住终点——切的一拍由转场域(批B)接棒,本组件
//   不自造景 B。
// - 无 motion-blur(卡片未要求;blur 只在 crash-zoom-punch / drone-dive)。
// - 参数烧死卡片默认值(D4:AI 只选 id 不调参;首批 motionParams 不接)。

import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame } from "remotion";
import { slowPushAtFrame } from "./vsc-helpers";

/** 全链命名锚(design §1.4:vsc: 前缀+卡名 kebab-case,注册表/AI 指南/校验器同一名字)。 */
export const VSC_SLOW_PUSH_IN_ID = "vsc:slow-push-in";

export interface SlowPushInProps {
  /** 分镜静图 media bridge capability URL(渲染与 Player 同源同图)。 */
  src: string;
  /**
   * 媒体形态(10-10 批B):image=分镜静图(缺省,批A 原语义);video=current
   * shot MP4(章节装配路径)——推近+暗角作用于整段镜头视频,音轨透传同 VisualClip。
   */
  kind?: "image" | "video";
  /** video 专用:裁剪/倍速/静音(缺省不裁/1 倍/静音)。 */
  trimStartFrames?: number;
  playbackRate?: number;
  muted?: boolean;
  volume?: number;
  /** 推近时长(帧)。缺省 120(4s@30fps;顶点硬切由转场链接棒)。 */
  durationFrames?: number;
  /** 起点/终点 scale。缺省 1.00 → 1.14(卡片:>1.2 读作普通推镜头)。 */
  fromScale?: number;
  toScale?: number;
  /** 暗角最深处 opacity。缺省 0.5。 */
  vignetteMax?: number;
}

/**
 * 纯采样:某帧的媒体层样式(scale=Easing.in(quad) 匀加速推近)。
 * 不依赖 React 上下文——帧级确定性测试直接吃这个函数。
 */
export function slowPushInStyleAtFrame(
  frame: number,
  props: SlowPushInProps,
): React.CSSProperties {
  const sample = slowPushAtFrame(frame, props);
  return {
    transform: `scale(${trimFloat(sample.scale)})`,
    transformOrigin: "50% 50%",
  };
}

/**
 * 纯采样:某帧的暗角层样式(四角径向渐变,opacity 与推近同曲线渐深——
 * 压迫感的第二来源;渐变形状=上游逐字节同串)。
 */
export function slowPushVignetteStyleAtFrame(
  frame: number,
  props: SlowPushInProps,
): React.CSSProperties {
  const sample = slowPushAtFrame(frame, props);
  return {
    opacity: trimFloat(sample.vignetteOpacity),
    background: VIGNETTE_GRADIENT,
    pointerEvents: "none",
  };
}

function SlowPushScene(props: SlowPushInProps): React.ReactElement {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={OVERFLOW_FRAME}>
      <AbsoluteFill style={slowPushInStyleAtFrame(frame, props)}>
        {/* 被推近的内容层:整体 scale,cover 满幅。 */}
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
      {/* 暗角层:随推近同步加深(上游同款四角径向渐变)。 */}
      <AbsoluteFill style={slowPushVignetteStyleAtFrame(frame, props)} />
    </AbsoluteFill>
  );
}

export function SlowPushIn(props: SlowPushInProps): React.ReactElement {
  return <SlowPushScene {...props} />;
}

// Fill the composition frame while preserving the source aspect ratio
// (与 VisualClip 的 COVER_STYLE 同义;配方文件自持,不跨文件借常量)。
const COVER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

// 暗景底色(上游 G.side;scale≥1 时恒不可见,防自定义参数露底)。
const OVERFLOW_FRAME: React.CSSProperties = {
  background: "#3a3a3a",
  overflow: "hidden",
};

// 暗角渐变(上游 SlowPushIn.tsx 逐字节同串:ellipse 62% 55%,45% 起黑,0.95 收边)。
const VIGNETTE_GRADIENT =
  "radial-gradient(ellipse 62% 55% at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.95) 100%)";

// Trim float noise so identical math yields byte-identical style strings
// (crash-zoom-punch.tsx trimFloat 同纪律)。
function trimFloat(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
