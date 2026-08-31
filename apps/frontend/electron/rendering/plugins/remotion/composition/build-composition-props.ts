



export { buildCompositionProps, layerStackForClip, layerStackFromLegacyTuple } from "./composition-shot";
export { buildChapterVideoCompositionProps, overlaps, validateSubtitleAuthorityForTimeline } from "./composition-chapter-video";
export type { ChapterVideoCompositionInput, ChapterVideoCompositionResult, ChapterVideoSourceInput, ChapterVoiceInterval, ChapterVoiceIntervalResult } from "./composition-chapter-video";
export { TEXT_HYPERFRAMES_TEMPLATES, buildDuckingEnvelope, inspectChapterVideoSource, mapEditedVoiceIntervals, projectEnvelopeForDuration, projectHyperFramesOverlay, readableSubtitleCues, validateTransitionVoiceSafety } from "./composition-audio-subtitle";
export { SFX_SFX_DURATION_FRAMES, VISUAL_FX_EFFECT_IDS, ambientForClip, audioKind, clampRange, compareTimelineClips, defaultTransform, deriveSubtitleSfxClips, deriveTransitionSfxClips, envelopeForClip, fadeForClip, gradeForClip, numberParam, panZoomForClip, requireCapabilityUrl, sfxAssetForTransition, visualFxForClip } from "./composition-clip-effects";
export { layoutChapterVisualClipTimings } from "./composition-clip-effects";
