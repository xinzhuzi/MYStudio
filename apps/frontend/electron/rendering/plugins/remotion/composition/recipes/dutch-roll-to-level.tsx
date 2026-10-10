// vsc:dutch-roll-to-level —— 斜角滚正(card: references/shots/camera/
// tension-camera-moves.md 式 B @ 5ddbf521,参考实现 demos/camera/
// tension-camera-moves/DutchRollToLevel.tsx)。
// 痛点段整帧 -10° 斜角悬着(叠 ±0.8° 正弦漂移 + 2px 纵漂——漂移是「悬着
// 难受」的活感,纯静止斜角读作构图错误),rollFrame 起一拍滚正:14f
// ease-out(cubic) 冲过 0 到 +1.2°,再 10f ease-in-out(quad) 收回 0
// (单次过冲不振荡——过冲即「扶正的手劲」);scale 1.15 防露边 → 滚正
// 同步收到 1.08。曲线全在 vsc-helpers.ts(纯函数,帧级确定性);本组件是
// 薄包装——与 VisualClip 同纪律:只采样曲线并投影成 CSS transform。
//
// 与上游 demo 的差异(改造说明全文见 ../ATTRIBUTION-vsc.md):
// - 媒体=分镜静图 media bridge capability URL(上游的 FakeDashboard 假
//   素材 + 痛点警示条/解决方案卡两层 UI 覆盖物全剥离——那两层是 demo 的
//   叙事道具,「世界被扶正」的语义由滚正曲线本身承载;单图 cover 满幅)。
// - 无 motion-blur(卡片未要求;blur 只在 crash-zoom-punch / drone-dive)。
// - 参数烧死卡片默认值(D4:AI 只选 id 不调参;首批 motionParams 不接)。

import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame } from "remotion";
import { dutchRollAtFrame } from "./vsc-helpers";

/** 全链命名锚(design §1.4:vsc: 前缀+卡名 kebab-case,注册表/AI 指南/校验器同一名字)。 */
export const VSC_DUTCH_ROLL_TO_LEVEL_ID = "vsc:dutch-roll-to-level";

export interface DutchRollToLevelProps {
  /** 分镜静图 media bridge capability URL(渲染与 Player 同源同图)。 */
  src: string;
  /**
   * 媒体形态(10-10 批B):image=分镜静图(缺省,批A 原语义);video=current
   * shot MP4(章节装配路径)——斜置/滚正作用于整段镜头视频,音轨透传同 VisualClip。
   */
  kind?: "image" | "video";
  /** video 专用:裁剪/倍速/静音(缺省不裁/1 倍/静音)。 */
  trimStartFrames?: number;
  playbackRate?: number;
  muted?: boolean;
  volume?: number;
  /** 滚正起拍帧。缺省 70(此前为斜置悬停期,卡片:斜角只压「痛点」段)。 */
  rollFrame?: number;
  /** 滚正冲程/收回帧数。缺省 14 / 10(卡片:14f 冲过 0,+1.2° 过冲 → 10f 收 0)。 */
  pushFrames?: number;
  settleFrames?: number;
  /** 斜置角/过冲角(deg)。缺省 -10 / +1.2。 */
  tiltDeg?: number;
  overshootDeg?: number;
  /** 斜置期漂移幅(deg / px)。缺省 ±0.8° / 2px(卡片 B 式斜置档)。 */
  driftAmpDeg?: number;
  driftAmpPx?: number;
  /** 防露边起点 scale / 滚正终点 scale。缺省 1.15 / 1.08。 */
  fromScale?: number;
  toScale?: number;
}

/**
 * 纯采样:某帧的媒体层样式(rotate=斜置+漂移+滚正;translateY=纵漂;
 * scale=防露边→收幅)。不依赖 React 上下文——帧级确定性测试直接吃这个函数。
 */
export function dutchRollToLevelStyleAtFrame(
  frame: number,
  props: DutchRollToLevelProps,
): React.CSSProperties {
  const sample = dutchRollAtFrame(frame, props);
  return {
    transform:
      `translateY(${trimFloat(sample.translateYPx)}px) ` +
      `rotate(${trimFloat(sample.rotateDeg)}deg) ` +
      `scale(${trimFloat(sample.scale)})`,
    transformOrigin: "50% 50%",
  };
}

function DutchRollScene(props: DutchRollToLevelProps): React.ReactElement {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={OVERFLOW_FRAME}>
      <AbsoluteFill style={dutchRollToLevelStyleAtFrame(frame, props)}>
        {/* 整帧斜置:cover 满幅,scale 1.15 保证 ±10.8° 旋转不露边(上游同款防露边)。 */}
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
  );
}

export function DutchRollToLevel(props: DutchRollToLevelProps): React.ReactElement {
  return <DutchRollScene {...props} />;
}

// Fill the composition frame while preserving the source aspect ratio
// (与 VisualClip 的 COVER_STYLE 同义;配方文件自持,不跨文件借常量)。
const COVER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

// 斜置旋转的出帧保护 + 兜底背景(上游 G.bg 灰;scale≥1.08 时恒不可见)。
const OVERFLOW_FRAME: React.CSSProperties = {
  background: "#ececea",
  overflow: "hidden",
};

// Trim float noise so identical math yields byte-identical style strings
// (crash-zoom-punch.tsx trimFloat 同纪律)。
function trimFloat(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
