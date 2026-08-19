// Design §6: subtitles are burned in by the composition. Each cue is mounted on
// its own frame range via Sequence and rendered as centred text. The component
// receives already-projected cues (text + frame range) and holds no timing math
// beyond delegating placement to Sequence. Styling comes from the subtitle
// font registry (default = 毛笔楷书) so the Player preview and the fixed
// bundle burn identical text.

import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import "@fontsource/noto-sans-sc/900.css";
import "@fontsource/noto-serif-sc/900.css";
import "@fontsource/ma-shan-zheng/400.css";
import "@fontsource/zhi-mang-xing/400.css";
import "@fontsource/long-cang/400.css";
import "@fontsource/liu-jian-mao-cao/400.css";
import "lxgw-wenkai-webfont/lxgwwenkai-regular.css";
import type { CompositionSubtitleCueProps } from "./composition-props";
// 固定 bundle 走 @remotion/bundler(webpack),不解析 vite 的 @/ 别名——
// 共享注册表必须相对导入。
import { resolveSubtitleFontStyle, subtitleTextShadow } from "../../../../../lib/studio/remotion/subtitle-fonts";

export function SubtitleTrack(
  props: { cues: readonly CompositionSubtitleCueProps[]; font?: string; typewriter?: boolean },
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
          <SubtitleCue text={cue.text} font={props.font} typewriter={props.typewriter} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function SubtitleCue(props: { text: string; font?: string; typewriter?: boolean }): React.ReactElement {
  const frame = useCurrentFrame();
  // 打字机字幕：逐字显示（视觉小说手法，2026-08-19）
  // 每字约 2 帧（30fps 下约 15 字/秒——中文阅读速度适配）
  const charsPerFrame = 0.5;
  const visibleChars = props.typewriter
    ? Math.min(props.text.length, Math.floor(frame * charsPerFrame + 0.001))
    : props.text.length;
  const visibleText = props.text.slice(0, visibleChars);
  const isComplete = !props.typewriter || visibleChars >= props.text.length;
  return (
    <AbsoluteFill style={CONTAINER_STYLE}>
      <span style={textStyleFor(props.font)}>
        {visibleText}
        {!isComplete ? <TypewriterCursor /> : null}
      </span>
    </AbsoluteFill>
  );
}

/** 打字机光标（| 闪烁，完成后消失）。 */
function TypewriterCursor(): React.ReactElement {
  const frame = useCurrentFrame();
  const visible = Math.floor(frame / 8) % 2 === 0; // ~4Hz 闪烁
  return (
    <span style={{ opacity: visible ? 1 : 0, color: "inherit" }}>|</span>
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
    textShadow: subtitleTextShadow(font.outlinePx),
  };
}

// Anchor cues to the lower third, centred horizontally.
const CONTAINER_STYLE: React.CSSProperties = {
  justifyContent: "flex-end",
  alignItems: "center",
  paddingBottom: "8%",
};

const TEXT_BASE_STYLE: Omit<React.CSSProperties, "fontFamily" | "fontSize" | "fontWeight" | "letterSpacing" | "color" | "textShadow"> = {
  maxWidth: "80%",
  textAlign: "center",
  lineHeight: 1.4,
  whiteSpace: "pre-wrap",
};
