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
  /** 提取输出里名字与别名列都对不上剧本自报清单的角色(疑似多提;1013 装机「丫头」复发补) */
  extraCharacters: string[];
  /** 同上,场景(防幻觉地点/泛化场景顶替);清单为空(非场次格式)时恒空 */
  extraScenes: string[];
  /** 1013 钉板两盲区的机械防线(软告警,不自动删):
   *  借名夹带=name 对不上清单、但别名归一后精确等于清单某名(神秘少女[赵四]形态);
   *  互含变体=name 与清单某名互含但不相等、别名也无精确命中(清单「晏燎」 vs 输出「晏燎甲」)。 */
  suspectBorrowedNames: string[];
  suspectVariantNames: string[];
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

/** 机械清单与实际提取输出的落差(漏了必可见,1013 负向补:多提也可见);hints 双空数组时结果恒四空。 */
export function diffScriptEntityHints(
  hints: ScriptEntityHints,
  extracted: ExtractedEntity[],
): ScriptEntityHintDiff {
  const namesOf = (kind: EntityKind): string[] =>
    extracted
      .filter((entity) => entity.kind === kind)
      .flatMap((entity) => [entity.name, ...entity.aliases]);
  // 负向:实体名与别名全对不上自报清单=疑似多提(叙述性泛指路人/幻觉地点)。
  // 对应清单为空(小说体/空文本)时按 kind 独立跳过——没有机械基准就不判多,防全量误报。
  // 已知盲区(拷问官 1013 钉板,机械清单边界):①互含变体静默——清单有名「丫头」时模型撰
  // 「丫头甲」因互含≥2字判覆盖;②借名夹带双盲——name 杂物+别名塞清单名(如 神秘少女[赵四])
  // 在 missing/extra 两向皆静默,需 prompt/dedupe 层下轮处置。
  const extraOf = (kind: EntityKind): string[] => {
    const declared = kind === "character" ? hints.characters : hints.scenes;
    if (!declared.length) return [];
    const extras = extracted
      .filter((entity) => entity.kind === kind)
      .filter((entity) => ![entity.name, ...entity.aliases].some((value) => hintCoveredBy(declared, value)))
      .map((entity) => entity.name);
    return uniqueByNormalizedName(extras);
  };
  // 1013 钉板两盲区的机械防线(角色域;场景清单名常为泛称互含面太大,不设变体判定):
  // ①借名夹带:name 不命中清单(连互含都不算)但别名归一后「精确等于」清单某名——
  //   合法归并的 name 本身命中清单,不会进入此分支;精确等(非互含)防「沈青岚[沈·青岚]」类
  //   假别名误伤。
  // ②互含变体:name 与清单某名互含但归一不等,且别名无精确=清单名——「晏燎甲」亮灯人裁;
  //   合法归并(赵四/监工赵四)双向精确或别名精确命中,不受影响。
  const suspectBorrowedOf = (): string[] => {
    if (!hints.characters.length) return [];
    const declaredKeys = new Set(hints.characters.map(normalizeName).filter(Boolean));
    return uniqueByNormalizedName(
      extracted
        .filter((entity) => entity.kind === "character")
        .filter((entity) => {
          const nameKey = normalizeName(entity.name);
          return Boolean(nameKey) && !declaredKeys.has(nameKey) &&
            !hints.characters.some((hint) => hintCoveredBy([hint], entity.name));
        })
        .filter((entity) => (entity.aliases ?? []).some((alias) => declaredKeys.has(normalizeName(alias))))
        .map((entity) => entity.name),
    );
  };
  const suspectVariantOf = (): string[] => {
    if (!hints.characters.length) return [];
    const declaredKeys = new Set(hints.characters.map(normalizeName).filter(Boolean));
    return uniqueByNormalizedName(
      extracted
        .filter((entity) => entity.kind === "character")
        .filter((entity) => {
          const nameKey = normalizeName(entity.name);
          if (!nameKey || declaredKeys.has(nameKey)) return false;
          if ((entity.aliases ?? []).some((alias) => declaredKeys.has(normalizeName(alias)))) return false;
          return hints.characters.some((hint) => {
            const hintKey = normalizeName(hint);
            return hintKey.length >= 2 && nameKey !== hintKey &&
              (nameKey.includes(hintKey) || hintKey.includes(nameKey));
          });
        })
        .map((entity) => entity.name),
    );
  };
  return {
    missingCharacters: hints.characters.filter((hint) => !hintCoveredBy(namesOf("character"), hint)),
    missingScenes: hints.scenes.filter((hint) => !hintCoveredBy(namesOf("scene"), hint)),
    extraCharacters: extraOf("character"),
    extraScenes: extraOf("scene"),
    suspectBorrowedNames: suspectBorrowedOf(),
    suspectVariantNames: suspectVariantOf(),
  };
}

/** 告警文案名单截断:按类各留 4 项,超出收口为「等共N项」(恰好 4 项全显)。 */
export function formatHintGapList(names: string[], keep = 4): string {
  const shown = names.slice(0, keep).join("、");
  return names.length > keep ? `${shown}等共${names.length}项` : shown;
}
