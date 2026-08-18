// Design §6: subtitles are burned in by the composition. Each cue is mounted on
// its own frame range via Sequence and rendered as centred text. The component
// receives already-projected cues (text + frame range) and holds no timing math
// beyond delegating placement to Sequence. Styling comes from the subtitle
// font registry (default = 毛笔楷书) so the Player preview and the fixed
// bundle burn identical text.

import { AbsoluteFill, Sequence } from "remotion";
import "@fontsource/noto-sans-sc/900.css";
import "@fontsource/noto-serif-sc/900.css";
import "@fontsource/ma-shan-zheng/400.css";
import type { CompositionSubtitleCueProps } from "./composition-props";
import { resolveSubtitleFontStyle } from "@/lib/studio/remotion/subtitle-fonts";

export function SubtitleTrack(
  props: { cues: readonly CompositionSubtitleCueProps[]; font?: string },
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
          <SubtitleCue text={cue.text} font={props.font} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function SubtitleCue(props: { text: string; font?: string }): React.ReactElement {
  return (
    <AbsoluteFill style={CONTAINER_STYLE}>
      <span style={textStyleFor(props.font)}>{props.text}</span>
    </AbsoluteFill>
  );
}

function textStyleFor(fontId: string | undefined): React.CSSProperties {
  const font = resolveSubtitleFontStyle(fontId);
  return {
    ...TEXT_BASE_STYLE,
    fontFamily: font.fontFamily,
    fontSize: font.fontSize,
    fontWeight: font.fontWeight,
    letterSpacing: font.letterSpacing,
    color: font.color,
  };
}

// Anchor cues to the lower third, centred horizontally.
const CONTAINER_STYLE: React.CSSProperties = {
  justifyContent: "flex-end",
  alignItems: "center",
  paddingBottom: "8%",
};

// 八方向硬描边比 -webkit-text-stroke 稳（描边不侵蚀笔画内侧），叠一道底部
// 投影保证任何底色上的对比度——电影级白字黑边。描边随注册表字号走。
// 八方向硬描边比 -webkit-text-stroke 稳（描边不侵蚀笔画内侧），叠一道底部
// 投影保证任何底色上的对比度——电影级白字黑边。描边随注册表字号走。
const OUTLINE_PX = 3;
const OUTLINE_SHADOW = [
  ...[-1, 0, 1].flatMap((y) => [-1, 0, 1].map((x) => (x === 0 && y === 0 ? null : `${x * OUTLINE_PX}px ${y * OUTLINE_PX}px 0 rgba(0, 0, 0, 0.95)`))),
  "0 6px 14px rgba(0, 0, 0, 0.7)",
].filter(Boolean).join(", ");

const TEXT_BASE_STYLE: Omit<React.CSSProperties, "fontFamily" | "fontSize" | "fontWeight" | "letterSpacing" | "color"> = {
  maxWidth: "80%",
  textAlign: "center",
  lineHeight: 1.4,
  textShadow: OUTLINE_SHADOW,
  whiteSpace: "pre-wrap",
};
