// Design §6: subtitles are burned in by the composition. Each cue is mounted on
// its own frame range via Sequence and rendered as centred text. The component
// receives already-projected cues (text + frame range) and holds no timing math
// beyond delegating placement to Sequence. Styling stays deliberately plain so
// the Player preview and the fixed bundle burn identical text.

import { AbsoluteFill, Sequence } from "remotion";
import "@fontsource/noto-sans-sc/900.css";
import "@fontsource/ma-shan-zheng/400.css";
import type { CompositionSubtitleCueProps } from "./composition-props";

export function SubtitleTrack(
  props: { cues: readonly CompositionSubtitleCueProps[] },
): React.ReactElement {
  return (
    <AbsoluteFill>
      {props.cues.map((cue) => (
        <Sequence
          key={cue.cueId}
          from={cue.from}
          durationInFrames={cue.durationInFrames}
          layout="none"
        >
          <SubtitleCue text={cue.text} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function SubtitleCue(props: { text: string }): React.ReactElement {
  return (
    <AbsoluteFill style={CONTAINER_STYLE}>
      <span style={TEXT_STYLE}>{props.text}</span>
    </AbsoluteFill>
  );
}

// Anchor cues to the lower third, centred horizontally.
const CONTAINER_STYLE: React.CSSProperties = {
  justifyContent: "flex-end",
  alignItems: "center",
  paddingBottom: "8%",
};

// 马善政毛笔楷书（fontsource unicode-range 子集，离线打进 bundle，按需加载子集）
// ——仙侠武侠片的"题字"质感；楷体→思源黑体逐级兜底（Ma Shan Zheng 仅常用简体
// 集，生僻字落到系统楷体仍保书法观感）。八方向硬描边比 -webkit-text-stroke 稳
// （描边不侵蚀笔画内侧），叠一道底部投影保证任何底色上的对比度——电影级题字。
// 毛笔字体只有 400 单字重：禁用合成加粗（伪粗会糊掉笔锋），粗细交给笔画本身。
const OUTLINE_PX = 3;
const OUTLINE_SHADOW = [
  ...[-1, 0, 1].flatMap((y) => [-1, 0, 1].map((x) => (x === 0 && y === 0 ? null : `${x * OUTLINE_PX}px ${y * OUTLINE_PX}px 0 rgba(0, 0, 0, 0.95)`))),
  "0 6px 14px rgba(0, 0, 0, 0.7)",
].filter(Boolean).join(", ");

const TEXT_STYLE: React.CSSProperties = {
  maxWidth: "80%",
  textAlign: "center",
  color: "#fdfaf2",
  fontFamily: "'Ma Shan Zheng', 'Kaiti SC', 'STKaiti', 'Noto Sans SC', 'PingFang SC', sans-serif",
  fontSize: 58,
  lineHeight: 1.4,
  fontWeight: 400,
  letterSpacing: "0.08em",
  textShadow: OUTLINE_SHADOW,
  whiteSpace: "pre-wrap",
};
