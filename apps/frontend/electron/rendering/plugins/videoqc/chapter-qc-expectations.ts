/**
 * 逐镜期望断言(1102 骨干②)——把「分镜声明了什么」变成「成片必须满足什么」。
 *
 * 为什么这件值钱:上游 VBench 得凭空造 946/1230 条 prompt 才知道「这镜该不该动」,
 * 而 MYStudio 的分镜表**天生带这份声明**——`shotFx.motion`(含 `hold`=定格)、
 * `shotSemantics.cameraMove/actionIn→actionOut/personFree/shotSize`、
 * `continuityState.dialogueText`、`ttsSpokenText`、`durationTarget`。
 * 此前 QC 一个字段都没读,所以 `real-motion` 只能拿全片 TI 均值猜水平线
 * (1102 实测:38 支真单镜 27 支恒 0,产线根本不产这病——因为没有「该动」的锚)。
 *
 * 口径纪律:
 * - `expected`=声明了要成立;`forbidden`=声明了不该成立(如 `motion=hold` 的定格镜、
 *   `personFree` 的无人空镜);`unknown`=分镜没这一列。
 * - **unknown 不许折算成 pass**,也不许折算成 fail——它只能变成「去补哪一列」的指名。
 * - 本件只读数据、不跑 ffmpeg/python,所以可以在单测里穷举三态。
 */

import type { ChapterQcExpectationSetV1, ChapterQcExpectationValue, ChapterQcExpectationKey, ChapterQcShotExpectationV1 } from "./chapter-qc-types";

const EXPECTATION_KEYS: readonly ChapterQcExpectationKey[] = [
  "motion",
  "speech",
  "subtitle",
  "cast-visible",
  "face-readable",
  "duration-in-target",
];

/** 定格意图(闭集 `LegacyMotionId` 里的静止值):声明静止,静止就不是伪动态。 */
const STATIC_MOTION_IDS: ReadonlySet<string> = new Set(["hold"]);

/** 近景/特写:脸在画面里占比足以判五官(远景/全景脸小是物理必然,不指望)。 */
const CLOSE_UP_SHOT_SIZES: readonly string[] = ["近景", "特写", "大特写"];

/** 编排器从 store 里 duck-type 出来的最小形状(字段全部可选:旧数据缺省即 unknown)。 */
export interface ChapterQcExpectationShotInput {
  shotId: string;
  ordinal: number;
  durationS: number;
  durationTargetS?: number;
  /** `StoryboardItem.durationTarget` 秒口径(缺失=未规划时长) */
  cameraMove?: string;
  actionIn?: string;
  actionOut?: string;
  personFree?: boolean;
  shotSize?: string;
  visibleCharacterCount?: number;
  /** `shotFx.motion`:legacy 18 + vsc 7 闭集;`hold`=定格 */
  shotFxMotion?: string;
  dialogueText?: string;
  ttsSpokenText?: string;
  /** 本镜是否挂了配音绑定(有音频素材才谈得上语音) */
  hasVoiceBinding?: boolean;
}

function valueOrUnknown(value: ChapterQcExpectationValue | undefined): ChapterQcExpectationValue {
  return value ?? "unknown";
}

/** 动态意图:运镜词/动作差/运镜配方任一声明即 expected;`hold` 优先(显式定格压过隐式移动)。 */
function motionAssertion(shot: ChapterQcExpectationShotInput): { value: ChapterQcExpectationValue; why?: string } {
  if (shot.shotFxMotion && STATIC_MOTION_IDS.has(shot.shotFxMotion)) {
    return { value: "forbidden", why: `shotFx.motion=${shot.shotFxMotion}(显式定格)` };
  }
  if (shot.cameraMove?.trim()) {
    return { value: "expected", why: `shotSemantics.cameraMove=${shot.cameraMove.trim()}` };
  }
  const actionIn = shot.actionIn?.trim() ?? "";
  const actionOut = shot.actionOut?.trim() ?? "";
  if (actionIn && actionOut && actionIn !== actionOut) {
    return { value: "expected", why: `actionIn「${actionIn}」→ actionOut「${actionOut}」` };
  }
  if (shot.shotFxMotion) {
    return { value: "expected", why: `shotFx.motion=${shot.shotFxMotion}` };
  }
  if (shot.personFree === true && !actionIn && !actionOut) {
    return { value: "forbidden", why: "personFree=true 且无动作记载(空镜静止合法)" };
  }
  return { value: "unknown" };
}

function speechAssertion(shot: ChapterQcExpectationShotInput): { value: ChapterQcExpectationValue; why?: string } {
  const text = shot.dialogueText?.trim() || shot.ttsSpokenText?.trim() || "";
  if (text) return { value: "expected", why: `${shot.dialogueText?.trim() ? "continuityState.dialogueText" : "ttsSpokenText"} 非空` };
  if (shot.hasVoiceBinding) return { value: "expected", why: "shotAudioBindings 挂了 voice 素材" };
  return { value: "unknown" };
}

function subtitleAssertion(shot: ChapterQcExpectationShotInput): { value: ChapterQcExpectationValue; why?: string } {
  const speech = speechAssertion(shot);
  // 无台词镜可能有花字/氛围字,所以不作 forbidden 声明——只能 unknown。
  if (speech.value === "expected") return { value: "expected", why: speech.why };
  return { value: "unknown" };
}

function castAssertion(shot: ChapterQcExpectationShotInput): { value: ChapterQcExpectationValue; why?: string } {
  if (shot.personFree === true) return { value: "forbidden", why: "shotSemantics.personFree=true(有意空镜)" };
  const count = shot.visibleCharacterCount ?? 0;
  if (count > 0) return { value: "expected", why: `visibleCharacters ${count} 人` };
  if (shot.personFree === false) return { value: "expected", why: "personFree=false 但未逐条列角色" };
  return { value: "unknown" };
}

function faceReadableAssertion(shot: ChapterQcExpectationShotInput): { value: ChapterQcExpectationValue; why?: string } {
  const cast = castAssertion(shot);
  if (cast.value !== "expected") return { value: "unknown" };
  const size = shot.shotSize?.trim() ?? "";
  if (!size) return { value: "unknown" };
  if (CLOSE_UP_SHOT_SIZES.some((candidate) => size.includes(candidate))) {
    return { value: "expected", why: `shotSize=${size} 且有人出镜` };
  }
  return { value: "unknown", why: `shotSize=${size}(中远景脸小属正常,不作可辨要求)` };
}

function durationAssertion(shot: ChapterQcExpectationShotInput): { value: ChapterQcExpectationValue; why?: string } {
  if (shot.durationTargetS && shot.durationTargetS > 0) {
    return { value: "expected", why: `durationTarget=${shot.durationTargetS.toFixed(2)}s` };
  }
  return { value: "unknown" };
}

export function buildShotExpectations(
  shots: readonly ChapterQcExpectationShotInput[],
): ChapterQcExpectationSetV1 {
  const list: ChapterQcShotExpectationV1[] = [];
  const coverage = new Map<ChapterQcExpectationKey, { expected: number; forbidden: number; unknown: number }>(
    EXPECTATION_KEYS.map((key) => [key, { expected: 0, forbidden: 0, unknown: 0 }]),
  );

  for (const shot of shots) {
    const resolved = {
      motion: motionAssertion(shot),
      speech: speechAssertion(shot),
      subtitle: subtitleAssertion(shot),
      "cast-visible": castAssertion(shot),
      "face-readable": faceReadableAssertion(shot),
      "duration-in-target": durationAssertion(shot),
    } as const;
    const assertions = {} as Record<ChapterQcExpectationKey, ChapterQcExpectationValue>;
    const provenance = {} as ChapterQcShotExpectationV1["provenance"];
    for (const key of EXPECTATION_KEYS) {
      const entry = resolved[key];
      assertions[key] = valueOrUnknown(entry?.value);
      if (entry?.why) provenance[key] = entry.why;
      const bucket = coverage.get(key)!;
      bucket[assertions[key]] += 1;
    }
    list.push({
      shotId: shot.shotId,
      ordinal: shot.ordinal,
      assertions,
      provenance,
      durationS: shot.durationS,
      ...(shot.durationTargetS && shot.durationTargetS > 0 ? { durationTargetS: shot.durationTargetS } : {}),
    });
  }

  return {
    shots: list,
    coverage: EXPECTATION_KEYS.map((key) => ({ key, ...coverage.get(key)! })),
  };
}

/** 某断言键下声明为 expected/forbidden 的镜(缺集=一切只能缺证)。 */
export function shotsWithAssertion(
  set: ChapterQcExpectationSetV1 | undefined,
  key: ChapterQcExpectationKey,
  value: ChapterQcExpectationValue,
): ChapterQcShotExpectationV1[] {
  if (!set) return [];
  return set.shots.filter((shot) => shot.assertions[key] === value);
}

export function assertionCoverage(
  set: ChapterQcExpectationSetV1 | undefined,
  key: ChapterQcExpectationKey,
): { expected: number; forbidden: number; unknown: number } {
  const row = set?.coverage.find((item) => item.key === key);
  return row ?? { expected: 0, forbidden: 0, unknown: 0 };
}

/** 一句话把三态计数说清(UI 与 missing 文案共用)。 */
export function describeAssertionCoverage(set: ChapterQcExpectationSetV1 | undefined, key: ChapterQcExpectationKey): string {
  const { expected, forbidden, unknown } = assertionCoverage(set, key);
  return `声明应成立 ${expected} 镜 / 声明不应成立 ${forbidden} 镜 / 分镜未记 ${unknown} 镜`;
}
