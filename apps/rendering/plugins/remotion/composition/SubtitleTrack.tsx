// Design §6: subtitles are burned in by the composition. Each cue is mounted on
// its own frame range via Sequence and rendered as centred text. The component
// receives already-projected cues (text + frame range) and holds no timing math
// beyond delegating placement to Sequence. Styling stays deliberately plain so
// the Player preview and the fixed bundle burn identical text.

import { AbsoluteFill, Sequence } from "remotion";
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

const TEXT_STYLE: React.CSSProperties = {
  maxWidth: "80%",
  textAlign: "center",
  color: "#ffffff",
  fontSize: 48,
  lineHeight: 1.3,
  fontWeight: 600,
  textShadow: "0 2px 6px rgba(0, 0, 0, 0.85)",
  whiteSpace: "pre-wrap",
};
