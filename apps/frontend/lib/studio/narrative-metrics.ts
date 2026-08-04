import type { StoryboardItem } from "@/types/studio";

export type NarrativeConflictScore = 0 | 1 | 2 | 3;
export type NarrativeDensityScore = 1 | 2 | 3;

export interface NarrativeBeatInput {
  mainlineRelation: string;
  informationDensity: string;
  emotionTags: readonly string[];
}

export interface NarrativeBeatScores {
  conflictScore: NarrativeConflictScore;
  densityScore: NarrativeDensityScore;
}

export type NarrativeShotInput = Pick<
  StoryboardItem,
  "duration" | "durationTarget" | "speakerId" | "emotion" | "shotSemantics"
>;

export interface NarrativeChapterMetricsInput {
  beat: NarrativeBeatInput;
  targetDurationSec: number;
  shots: readonly NarrativeShotInput[];
}

export interface NarrativeChapterMetrics extends NarrativeBeatScores {
  targetDurationSec: number;
  storyboardDurationSec: number;
  durationDeltaSec: number;
  durationDeltaPct: number;
  dialogueShots: number;
  narratorShots: number;
  dialogueRatio: number;
  narratorRatio: number;
  emotionTransitions: number;
  executableShots: number;
  totalShots: number;
  executableRatio: number;
}

const CONFLICT_EMOTIONS = new Set(["冲突", "高潮", "恐怖", "情感崩溃"]);

/**
 * Convert the existing event labels into comparable audit scores.
 * This is an explicit rubric, not a semantic-model judgement.
 */
export function scoreNarrativeBeat(input: NarrativeBeatInput): NarrativeBeatScores {
  const relation = input.mainlineRelation.trim();
  const relationBase: NarrativeConflictScore = relation.startsWith("强")
    ? 2
    : relation.startsWith("中")
      ? 1
      : 0;
  const hasConflictEmotion = input.emotionTags.some((tag) => CONFLICT_EMOTIONS.has(tag.trim()));
  const conflictScore = Math.min(3, relationBase + (hasConflictEmotion ? 1 : 0)) as NarrativeConflictScore;

  const density = input.informationDensity.trim();
  const densityScore: NarrativeDensityScore = density.includes("高")
    ? 3
    : density.includes("低")
      ? 1
      : 2;

  return { conflictScore, densityScore };
}

export function measureNarrativeChapter(input: NarrativeChapterMetricsInput): NarrativeChapterMetrics {
  const scores = scoreNarrativeBeat(input.beat);
  const totalShots = input.shots.length;
  const storyboardDurationSec = input.shots.reduce(
    (total, shot) => total + (shot.durationTarget ?? shot.duration),
    0,
  );
  const durationDeltaSec = storyboardDurationSec - input.targetDurationSec;
  const dialogueShots = input.shots.filter((shot) => shot.speakerId?.startsWith("character:")).length;
  const narratorShots = input.shots.filter((shot) => shot.speakerId === "narrator").length;
  const emotionTransitions = input.shots.slice(1).reduce((count, shot, index) => {
    const previous = input.shots[index]?.emotion?.trim();
    const current = shot.emotion?.trim();
    return previous && current && previous !== current ? count + 1 : count;
  }, 0);
  const executableShots = input.shots.filter((shot) => isExecutableShot(shot)).length;

  return {
    ...scores,
    targetDurationSec: input.targetDurationSec,
    storyboardDurationSec,
    durationDeltaSec,
    durationDeltaPct: input.targetDurationSec > 0 ? durationDeltaSec / input.targetDurationSec : 0,
    dialogueShots,
    narratorShots,
    dialogueRatio: totalShots > 0 ? dialogueShots / totalShots : 0,
    narratorRatio: totalShots > 0 ? narratorShots / totalShots : 0,
    emotionTransitions,
    executableShots,
    totalShots,
    executableRatio: totalShots > 0 ? executableShots / totalShots : 0,
  };
}

function isExecutableShot(shot: NarrativeShotInput): boolean {
  const semantics = shot.shotSemantics;
  if (!semantics || !semantics.sceneViewpointId || !semantics.actionIn || !semantics.actionOut) {
    return false;
  }
  return semantics.personFree || semantics.visibleCharacters.length > 0;
}
