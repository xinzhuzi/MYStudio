import { analyzeScriptDraft } from "@/lib/studio/script-draft-metrics";
import { normalizeName } from "@/lib/studio/entity-extraction";
import type { EntityKind, ExtractedEntity } from "@/lib/studio/entity-extraction";

/**
 * 剧本自报实体清单(确定性兜底,1013 修):
 * 从场次标题与「人物：」行机械抽取实体名单,注入提取 prompt 供模型逐项判定;
 * 解析后再与实际输出 diff——保证「漏了必可见」(toast 警告+诊断日志),不自动写库(防误判)。
 * 场次解析复用 G44 官方解析器 analyzeScriptDraft(零依赖纯函数);人物行为新写正则。
 */

export interface ScriptEntityHints {
  /** 各场次标题机械抽取的地点名(时间/内外尾标已剥、同主地点「·」子区已归并) */
  scenes: string[];
  /** 各场「人物：」行具名者(「若干」式集体称谓已滤、尾部括注已剥) */
  characters: string[];
}

export interface ScriptEntityHintDiff {
  missingCharacters: string[];
  missingScenes: string[];
}

/** 场次标题尾部时间/内外锚(「金水河码头 夜/外」的「 夜/外」);无空格变体整吞剥空后回退未剥 title。 */
const SCENE_TIME_SUFFIX_RE = /\s*\S{1,6}\s*[/／]\s*(?:内|外|内外)$/;
/** 「人物：」行(空格分隔的本场出场名单)。 */
const CAST_LINE_RE = /^\s*人物[：:]\s*(.+)$/;
/** 人物 token 尾部全/半角括注:「宗门弟子甲（画外音）」→「宗门弟子甲」。 */
const CAST_PARENTHETICAL_RE = /(?:[（(][^（）()]*[）)])+$/;
/** 「若干」式集体称谓是功能性群演,不入名单。 */
const COLLECTIVE_SUFFIX_RE = /若干$/;

function uniqueByNormalizedName(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalizeName(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function extractScriptEntityHints(scriptText: string): ScriptEntityHints {
  const text = scriptText ?? "";

  // 场次地点:analyzeScriptDraft 的 title 含尾部「时间/内外」,剥净后取「·」前主地点归并
  const scenes: string[] = [];
  for (const scene of analyzeScriptDraft(text).scenes) {
    const stripped = scene.title.replace(SCENE_TIME_SUFFIX_RE, "").trim();
    // 无空格尾标变体(「金水河码头夜/外」)会被正则整吞剥空——回退未剥 title,该场不静默消失
    const candidate = (stripped || scene.title).split("·")[0]?.trim() ?? "";
    if (candidate) scenes.push(candidate);
  }

  // 人物行具名者:逐行扫「人物：」行,token 按空白拆
  const characters: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const castMatch = CAST_LINE_RE.exec(raw);
    if (!castMatch) continue;
    for (const token of castMatch[1]!.split(/\s+/)) {
      const name = token.replace(CAST_PARENTHETICAL_RE, "").trim();
      if (!name || COLLECTIVE_SUFFIX_RE.test(name)) continue;
      characters.push(name);
    }
  }

  return {
    scenes: uniqueByNormalizedName(scenes),
    characters: uniqueByNormalizedName(characters),
  };
}

/** 覆盖判定:normalizeName 后相等,或互为包含且较短一方 ≥2 字(单字别名不得覆盖)。 */
function hintCoveredBy(names: string[], hint: string): boolean {
  const hintKey = normalizeName(hint);
  if (!hintKey) return false;
  for (const name of names) {
    const key = normalizeName(name);
    if (!key) continue;
    if (key === hintKey) return true;
    const shorter = key.length < hintKey.length ? key : hintKey;
    if (shorter.length >= 2 && (key.includes(hintKey) || hintKey.includes(key))) return true;
  }
  return false;
}

/** 机械清单与实际提取输出的落差(漏了必可见);hints 双空数组时结果恒双空。 */
export function diffScriptEntityHints(
  hints: ScriptEntityHints,
  extracted: ExtractedEntity[],
): ScriptEntityHintDiff {
  const namesOf = (kind: EntityKind): string[] =>
    extracted
      .filter((entity) => entity.kind === kind)
      .flatMap((entity) => [entity.name, ...entity.aliases]);
  return {
    missingCharacters: hints.characters.filter((hint) => !hintCoveredBy(namesOf("character"), hint)),
    missingScenes: hints.scenes.filter((hint) => !hintCoveredBy(namesOf("scene"), hint)),
  };
}

/** 告警文案名单截断:按类各留 4 项,超出收口为「等共N项」(恰好 4 项全显)。 */
export function formatHintGapList(names: string[], keep = 4): string {
  const shown = names.slice(0, keep).join("、");
  return names.length > keep ? `${shown}等共${names.length}项` : shown;
}
