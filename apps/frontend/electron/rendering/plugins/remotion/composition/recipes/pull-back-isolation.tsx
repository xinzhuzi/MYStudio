// vsc:pull-back-isolation —— 拉远孤立收束,单镜版(card: references/
// shots/camera/tension-camera-moves.md 式 D @ 5ddbf521,参考实现 demos/
// camera/tension-camera-moves/PullBackIsolation.tsx)。
// 开场怼在主体特写上(scale 2.2,前 20f 主体仍占满画面,无需另加 hold),
// 缓缓后拉至大远景孤悬(scale 0.62 / 110f Easing.out(cubic));拉远中
// 「世界向外塌暗」——背景 60–110f 由 #ececea 沉入 #141414,主体白光晕
// 60–100f 淡入(光晕是「只剩它」的视觉证词,与沉黑同步才成立);尾段
// 真静止:暗场中央孤悬一张发光小卡,全片只为这一个主体。
//
// 与上游 demo 的差异(改造说明全文见 ../ATTRIBUTION-vsc.md):
// - 单镜版:上游是 1 主卡 + 8 兄弟卡按 hypot 距离错峰熄灭(帧 30 起每
//   8f 一张,16f 内 opacity→0 + brightness→0.3)的多卡布局;本版主体=
//   整张分镜静图(media bridge capability URL,单图 cover),无兄弟层,
//   熄灭通道剥离——「背景沉黑」由画面外背景色沉黑 + 主体留光光晕承接
//   (主体全亮无压暗,卡片 D 式语义「主体留光背景沉黑」的原位翻译)。
//   章尾多实体版归批D(任务决议:章级能力另批)。
// - origin 锁主体锚点(上游 transformOrigin 钉主卡中心 960,540=50% 50%,
//   单镜版默认中心,props 可指到静图里的主体)。
// - 无 motion-blur(卡片未要求;blur 只在 crash-zoom-punch / drone-dive)。
// - 参数烧死卡片默认值(D4:AI 只选 id 不调参;首批 motionParams 不接)。

import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame } from "remotion";
import { pullBackAtFrame } from "./vsc-helpers";

/** 全链命名锚(design §1.4:vsc: 前缀+卡名 kebab-case,注册表/AI 指南/校验器同一名字)。 */
export const VSC_PULL_BACK_ISOLATION_ID = "vsc:pull-back-isolation";

export interface PullBackIsolationProps {
  /** 分镜静图 media bridge capability URL(渲染与 Player 同源同图)。 */
  src: string;
  /**
   * 媒体形态(10-10 批B):image=分镜静图(缺省,批A 原语义);video=current
   * shot MP4(章节装配路径)——后拉/沉黑/光晕作用于整段镜头视频,音轨透传同 VisualClip。
   */
  kind?: "image" | "video";
  /** video 专用:裁剪/倍速/静音(缺省不裁/1 倍/静音)。 */
  trimStartFrames?: number;
  playbackRate?: number;
  muted?: boolean;
  volume?: number;
  /** 后拉时长(帧)。缺省 110(前 20f 主体仍占满画面)。 */
  pullFrames?: number;
  /** 起点/终点 scale。缺省 2.2(怼脸特写)→ 0.62(大远景孤悬)。 */
  fromScale?: number;
  toScale?: number;
  /** 背景沉黑窗(帧)。缺省 60 → 110。 */
  darkStartFrame?: number;
  darkEndFrame?: number;
  /** 主体光晕淡入窗(帧)。缺省 60 → 100(与沉黑同步才成立)。 */
  glowStartFrame?: number;
  glowEndFrame?: number;
  /** 光晕最深处(白 box-shadow alpha 顶)。缺省 0.35。 */
  glowMax?: number;
  /** 沉黑两端灰阶(上游 #ececea→#141414 = 236→20)。 */
  sinkFromGray?: number;
  sinkToGray?: number;
  /** 主体锚点(0..1 画面百分比;后拉 origin 锁在这里,缺省中心)。 */
  originX?: number;
  originY?: number;
}

/**
 * 纯采样:某帧的外框样式(背景沉黑:sinkT 0→1 驱动灰阶 236→20,上游
 * Math.round 语义)。不依赖 React 上下文——帧级确定性测试直接吃这个函数。
 */
export function pullBackIsolationBackdropAtFrame(
  frame: number,
  props: PullBackIsolationProps,
): React.CSSProperties {
  const sample = pullBackAtFrame(frame, props);
  const from = props.sinkFromGray ?? 236;
  const to = props.sinkToGray ?? 20;
  const gray = Math.round(from + (to - from) * sample.sinkT);
  return {
    background: `rgb(${gray},${gray},${gray})`,
    overflow: "hidden",
  };
}

/**
 * 纯采样:某帧的主体层样式(scale=后拉曲线;boxShadow=白光晕双层淡入,
 * 上游同款 80/160px 双层;borderRadius 让静图读作「孤卡」)。
 */
export function pullBackIsolationStyleAtFrame(
  frame: number,
  props: PullBackIsolationProps,
): React.CSSProperties {
  const sample = pullBackAtFrame(frame, props);
  const glow = trimFloat(sample.glow);
  const originX = clampUnit(props.originX ?? 0.5);
  const originY = clampUnit(props.originY ?? 0.5);
  return {
    transform: `scale(${trimFloat(sample.scale)})`,
    transformOrigin: `${trimFloat(originX * 100)}% ${trimFloat(originY * 100)}%`,
    boxShadow:
      `0 0 80px rgba(255,255,255,${glow}), ` +
      `0 0 160px rgba(255,255,255,${trimFloat(glow * 0.6)})`,
    borderRadius: 14,
    overflow: "hidden",
  };
}

function PullBackScene(props: PullBackIsolationProps): React.ReactElement {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={pullBackIsolationBackdropAtFrame(frame, props)}>
      <AbsoluteFill style={pullBackIsolationStyleAtFrame(frame, props)}>
        {/* 主体=整张分镜静图:cover 满幅,后拉中恒留光(无压暗滤镜)。 */}
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

export function PullBackIsolation(props: PullBackIsolationProps): React.ReactElement {
  return <PullBackScene {...props} />;
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
// (crash-zoom-punch.tsx trimFloat 同纪律)。
function trimFloat(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
