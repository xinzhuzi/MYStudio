import type { VideoUseBoundaryIntentV1 } from "@rendering/contracts/video-workflow";
import { parseDirectorPlanBoundaryIntents } from "@/lib/studio/director-plan";
import {
  clampTransitionDurationUs,
  isTransitionSemanticBucketId,
  semanticBucketTransition,
  styleWordTransition,
} from "@/lib/studio/editing/transition-policy";

export interface BoundaryIntentStoryboardInput {
  id: string;
  index: number;
  trackKey?: string;
  shotSemantics?: {
    transitionToNext?: { styleWord: string; moodWord?: string };
  };
  /**
   * AI 转场决策层（08-19）：source=ai 时 transitionOut 优先于分镜语义；
   * source=heuristic 时仅作链尾兜底（不让关键词抢分镜表/导演计划的明确裁定）。
   * "cut"=AI 显式硬切，抑制全部低优先级来源。
   */
  shotFx?: {
    transitionOut?: unknown;
    source?: unknown;
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
 *   1. AI transition decision from the FROM-shot's `shotFx.transitionOut`
 *      with source=ai (08-19 转场决策层 — full-chapter context, richest
 *      vocabulary; an explicit "cut" suppresses every lower source)
 *   2. shot-level intent from the FROM-shot's `shotSemantics.transitionToNext`
 *      (storyboard stage owns shot boundaries — this is the authoritative
 *      per-boundary decision, "同场景硬切" included as a first-class choice)
 *   3. scene-level intent from the director plan ⑥ structured lines, matched
 *      against the real adjacent scene pair on the timeline
 *   4. heuristic rule fallback from `shotFx.transitionOut` with
 *      source=heuristic (动作爆点→impact-frame、情绪断裂→blackout)
 *   5. no intent — the boundary renders as a hard cut
 *
 * Every emitted intent is duration-clamped against both neighbours and
 * mapped through the single-source bucket/style-word tables.
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

    // Priority 1: AI transition decision (shotFx.transitionOut, source=ai).
    if (from.shotFx?.source === "ai" && typeof from.shotFx.transitionOut === "string") {
      if (from.shotFx.transitionOut === "cut") continue; // AI 显式硬切：抑制全部低优先级来源
      if (isTransitionSemanticBucketId(from.shotFx.transitionOut)) {
        const bucket = semanticBucketTransition(from.shotFx.transitionOut);
        if (bucket) {
          intents.push({
            fromShotId: from.id,
            toShotId: to.id,
            effectId: bucket.effectId,
            durationUs: clampTransitionDurationUs(bucket.durationUs, durationUs),
            styleWord: bucket.styleWord,
          });
          continue;
        }
      }
      warnings.push(`镜 ${from.index} shotFx.transitionOut 未命中转场桶(${from.shotFx.transitionOut})，回落既有优先级链`);
    }

    // Priority 2: shot-level intent from the storyboard semantics.
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

    // Priority 3: plan-level intents. Canonical automation plans may carry
    // shot-level lines (3b, matched by storyboard index); LLM plans only carry
    // scene-level lines (3a, matched against the real adjacent scene pair).
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
    if (fromScene === undefined || toScene === undefined || fromScene === toScene) {
      // Priority 4: heuristic rule fallback（链尾：不抢分镜表/导演计划的明确裁定）。
      const heuristic = heuristicTransitionFor(from, warnings);
      if (heuristic) {
        intents.push({
          fromShotId: from.id,
          toShotId: to.id,
          effectId: heuristic.effectId,
          durationUs: clampTransitionDurationUs(heuristic.durationUs, durationUs),
          styleWord: heuristic.styleWord,
        });
      }
      continue;
    }
    const sceneIntent = sceneIntents.find(
      (candidate) => candidate.fromScene === fromScene && candidate.toScene === toScene,
    );
    if (!sceneIntent) {
      const heuristic = heuristicTransitionFor(from, warnings);
      if (heuristic) {
        intents.push({
          fromShotId: from.id,
          toShotId: to.id,
          effectId: heuristic.effectId,
          durationUs: clampTransitionDurationUs(heuristic.durationUs, durationUs),
          styleWord: heuristic.styleWord,
        });
      }
      continue;
    }
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

/** 链尾启发式兜底：source=heuristic 的 transitionOut（blackout/impact-frame 两档）。 */
function heuristicTransitionFor(
  from: BoundaryIntentStoryboardInput,
  warnings: string[],
): { effectId: VideoUseBoundaryIntentV1["effectId"]; durationUs: number; styleWord: string } | null {
  if (from.shotFx?.source !== "heuristic" || typeof from.shotFx.transitionOut !== "string") {
    return null;
  }
  if (!isTransitionSemanticBucketId(from.shotFx.transitionOut)) {
    warnings.push(`镜 ${from.index} shotFx.transitionOut 未命中转场桶(${from.shotFx.transitionOut})，边界保持硬切`);
    return null;
  }
  const bucket = semanticBucketTransition(from.shotFx.transitionOut);
  return bucket ? { effectId: bucket.effectId, durationUs: bucket.durationUs, styleWord: bucket.styleWord } : null;
}

function clampForPair(
  fromShotId: string,
  toShotId: string,
  durations: ReadonlyMap<string, number>,
): number[] {
  return [durations.get(fromShotId) ?? 0, durations.get(toShotId) ?? 0];
}
