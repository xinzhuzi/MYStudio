export const STORYBOARD_SHOT_COMPOSITION_ID = "StoryboardShot";
export const CHAPTER_VIDEO_COMPOSITION_ID = "ChapterVideo";
// Wire/persistence compatibility key: historical stored jobs and evidence
// reference this composition id, so the registered value must never change.
// Identifier is generic; only the string value is legacy.
export const LEGACY_TIMELINE_COMPATIBILITY_COMPOSITION_ID = "DaojieTimeline";

export const PRIMARY_REMOTION_COMPOSITION_IDS = [
  STORYBOARD_SHOT_COMPOSITION_ID,
  CHAPTER_VIDEO_COMPOSITION_ID,
] as const;

export const BUNDLED_REMOTION_COMPOSITION_IDS = [
  ...PRIMARY_REMOTION_COMPOSITION_IDS,
  LEGACY_TIMELINE_COMPATIBILITY_COMPOSITION_ID,
] as const;
