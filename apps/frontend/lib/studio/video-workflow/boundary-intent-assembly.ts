import type { VideoUseBoundaryIntentV1 } from "@rendering/contracts/video-workflow";
import { parseDirectorPlanBoundaryIntents } from "@/lib/studio/director-plan";
import {
  clampTransitionDurationUs,
  styleWordTransition,
} from "@/lib/studio/editing/transition-policy";

export interface BoundaryIntentStoryboardInput {
  id: string;
  index: number;
  trackKey?: string;
  shotSemantics?: {
    transitionToNext?: { styleWord: string; moodWord?: string };
  };
}

export interface AssembleBoundaryIntentsInput {
  /** Chapter storyboards; boundaries are adjacent pairs sorted by index. */
  storyboards: readonly BoundaryIntentStoryboardInput[];
  /** Director-plan ⑥ section text (scene-level fallback intents). */
  scriptPlanTransitions?: string;
  /** Shot duration in µs by storyboard id, used for transition clamping. */
  shotDurationUsById: ReadonlyMap<string, number>;
}

export interface AssembleBoundaryIntentsResult {
  intents: VideoUseBoundaryIntentV1[];
  warnings: string[];
}

/**
 * Assemble video-use boundary intents with a strict priority chain:
 *
 *   1. shot-level intent from the FROM-shot's `shotSemantics.transitionToNext`
 *      (storyboard stage owns shot boundaries — this is the authoritative
 *      per-boundary decision, "同场景硬切" included as a first-class choice)
 *   2. scene-level intent from the director plan ⑥ structured lines, matched
 *      against the real adjacent scene pair on the timeline
 *   3. no intent — the boundary renders as a hard cut
 *
 * Every emitted intent is duration-clamped against both neighbours and
 * mapped through the single-source style-word table.
 */
export function assembleBoundaryIntents(
  input: AssembleBoundaryIntentsInput,
): AssembleBoundaryIntentsResult {
  const warnings: string[] = [];
  const storyboards = [...input.storyboards].sort((left, right) => left.index - right.index);
  const sceneByShotId = new Map<string, number>();
  for (const storyboard of storyboards) {
    const match = typeof storyboard.trackKey === "string" ? /scene-(\d+)$/.exec(storyboard.trackKey) : null;
    if (match) sceneByShotId.set(storyboard.id, Number(match[1]));
  }
  const sceneIntents = parseDirectorPlanBoundaryIntents(input.scriptPlanTransitions);
  const intents: VideoUseBoundaryIntentV1[] = [];

  for (let position = 0; position < storyboards.length - 1; position += 1) {
    const from = storyboards[position]!;
    const to = storyboards[position + 1]!;
    const durationUs = clampForPair(from.id, to.id, input.shotDurationUsById);

    // Priority 1: shot-level intent from the storyboard semantics.
    const shotIntent = from.shotSemantics?.transitionToNext;
    if (shotIntent?.styleWord?.trim()) {
      const transition = styleWordTransition(shotIntent.styleWord);
      if (transition) {
        intents.push({
          fromShotId: from.id,
          toShotId: to.id,
          effectId: transition.effectId,
          durationUs: clampTransitionDurationUs(transition.durationUs, durationUs),
          styleWord: transition.styleWord,
          ...(shotIntent.moodWord?.trim() ? { moodWord: shotIntent.moodWord.trim() } : {}),
        });
      } else if (shotIntent.styleWord.trim() !== "同场景硬切") {
        warnings.push(`镜 ${from.index} transitionToNext.styleWord 未命中词表(${shotIntent.styleWord})，边界保持硬切`);
      }
      continue;
    }

    // Priority 2: plan-level intents. Canonical automation plans may carry
    // shot-level lines (2b, matched by storyboard index); LLM plans only carry
    // scene-level lines (2a, matched against the real adjacent scene pair).
    const planShotIntent = sceneIntents.find(
      (candidate) => candidate.fromShotIndex === from.index && candidate.toShotIndex === to.index,
    );
    if (planShotIntent) {
      const transition = styleWordTransition(planShotIntent.styleWord);
      if (transition) {
        intents.push({
          fromShotId: from.id,
          toShotId: to.id,
          effectId: transition.effectId,
          durationUs: clampTransitionDurationUs(transition.durationUs, durationUs),
          styleWord: transition.styleWord,
          ...(planShotIntent.moodWord ? { moodWord: planShotIntent.moodWord } : {}),
        });
      }
      continue;
    }
    const fromScene = sceneByShotId.get(from.id);
    const toScene = sceneByShotId.get(to.id);
    if (fromScene === undefined || toScene === undefined || fromScene === toScene) continue;
    const sceneIntent = sceneIntents.find(
      (candidate) => candidate.fromScene === fromScene && candidate.toScene === toScene,
    );
    if (!sceneIntent) continue;
    const transition = styleWordTransition(sceneIntent.styleWord);
    if (!transition) continue;
    intents.push({
      fromShotId: from.id,
      toShotId: to.id,
      effectId: transition.effectId,
      durationUs: clampTransitionDurationUs(transition.durationUs, durationUs),
      styleWord: transition.styleWord,
      ...(sceneIntent.moodWord ? { moodWord: sceneIntent.moodWord } : {}),
    });
  }
  return { intents, warnings };
}

function clampForPair(
  fromShotId: string,
  toShotId: string,
  durations: ReadonlyMap<string, number>,
): number[] {
  return [durations.get(fromShotId) ?? 0, durations.get(toShotId) ?? 0];
}
