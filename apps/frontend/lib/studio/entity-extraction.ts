import { getAgentSkillPreset } from "@/lib/studio/manuals";
import { parseAssetNames } from "@/lib/studio/asset-names";
import type { ScriptEntityHints } from "@/lib/studio/script-entity-hints";

export type EntityKind = "character" | "scene" | "prop";

export interface ExtractedEntity {
  kind: EntityKind;
  name: string;
  aliases: string[];
  episodeIds: string[];
  note?: string;
}

export interface KnownEntity {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
}

export interface DedupedEntity {
  id: string | null;
  isNew: boolean;
  kind: EntityKind;
  name: string;
  aliases: string[];
  episodeIds: string[];
  note?: string;
}

export interface ParseEntityExtractionResult {
  entities: ExtractedEntity[];
  errors: string[];
}

export interface DedupeEntitiesResult {
  entities: DedupedEntity[];
}

export interface BuildEntityExtractionInput {
  episodeId: string;
  scriptText: string;
  knownEntities?: KnownEntity[];
  /** 原著圣经注入块（formatSourceBibleContext 产出）；空圣经时省略，零影响。 */
  bibleContext?: string;
  /** 剧本自报实体清单（extractScriptEntityHints 产出）；缺省或双空数组时注入块省略（向后兼容）。 */
  scriptHints?: ScriptEntityHints;
}

export interface EntityExtractionMessages {
  system: string;
  user: string;
}

const KIND_VALUES: EntityKind[] = ["character", "scene", "prop"];

const outputSpec = `
## 输出约束（最高优先级）

逐实体一行，竖线表，恰好 5 列，第一字符为 \`|\`、最后字符为 \`|\`：

| KIND | 名称 | 别名 | 集ID | 备注 |

- KIND 取值仅限：character | scene | prop（角色/场景/道具）
- 名称：实体最常用规范称呼；如有自然副名，可写成「主名字;副名字1;副名字2」
- 别名：顿号分隔，无则留空；若名称列已包含副名，别名列可留空
- 集ID：逗号分隔，无则留空（默认归当前集）
- 备注：必填。角色写外貌特征/身份/性格（一句话），场景写环境特征，道具写外观/用途
- 覆盖要求：剧本中出现的所有实体逐行输出，已知实体（含上列清单）出场也必须输出，由系统按名去重复用；宁多勿漏
- 角色以每场「人物：」行、场景以每个场次标题为核对基准
- 不输出表头行、分隔线、解释、代码块围栏；只输出数据行
`.trim();

export function buildEntityExtractionMessages(input: BuildEntityExtractionInput): EntityExtractionMessages {
  const skill = getAgentSkillPreset("entity_extractor")?.content ?? "";
  // 1013 修 RC-1:删「 → 复用ID ${id}」尾串——五列表无 ID 列,该指令是「已知→略过」误读的
  // 触发词(revision-3 实证模型只能把 ID 塞进备注,造成 note 前缀回声)
  const knownBlock = (input.knownEntities ?? [])
    .map((item) => `- [${item.kind}] ${item.name}${item.aliases.length ? `（别名：${item.aliases.join("、")}）` : ""}`)
    .join("\n");

  // 剧本自报实体清单(确定性兜底):缺省或双空数组时整块省略(向后兼容)
  const hintLines = input.scriptHints
    ? [
        ...(input.scriptHints.scenes.length
          ? [`- 场景：${input.scriptHints.scenes.join("、")}`]
          : []),
        ...(input.scriptHints.characters.length
          ? [`- 人物：${input.scriptHints.characters.join("、")}`]
          : []),
      ]
    : [];
  const hintBlock = hintLines.length
    ? [
        "【剧本自报实体清单】（系统从场次标题与人物行机械抽取，可能有噪声）：",
        ...hintLines,
        "请逐项判定：清单内的实体出场即必须输出一行（「若干」式群演可跳过）；清单外的实体照常提取。",
      ].join("\n")
    : null;

  return {
    system: [skill, outputSpec].filter(Boolean).join("\n\n"),
    user: [
      `当前集ID：${input.episodeId}`,
      ...(input.bibleContext
        ? [input.bibleContext, ""]
        : []),
      // 1013 修 RC-1:旧标题「命中请复用其ID…勿重复新建」教模型略过已知实体,是 revision-3
      // 漏提主因;新手册 §一 反转为全量输出(已知实体出场同样输出一行,ID 由系统按名去重)
      "已知实体（归并参考：剧本中出场的实体无论是否在下列清单中都必须输出一行，主名优先用清单中的名称、其余称呼入别名，系统会自动按名称/别名去重复用ID，无需你处理ID）：",
      knownBlock || "无",
      "",
      ...(hintBlock ? [hintBlock, ""] : []),
      "剧本正文：",
      input.scriptText,
    ].join("\n"),
  };
}

export function parseEntityExtraction(output: string, defaultEpisodeId: string): ParseEntityExtractionResult {
  const entities: ExtractedEntity[] = [];
  const errors: string[] = [];

  for (const raw of stripFences(output).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (isSeparatorRow(line) || isHeaderRow(line)) continue;

    const fields = line.slice(1, -1).split("|").map((item) => item.trim());
    if (fields.length !== 5) {
      errors.push(line);
      continue;
    }

    const kind = fields[0]!.toLowerCase();
    const parsedName = parseAssetNames(fields[1]!, "");
    const name = parsedName.primaryName;
    if (!isEntityKind(kind) || !name) {
      errors.push(line);
      continue;
    }

    const episodeIds = splitList(fields[3]!, /[,，]+/);
    entities.push({
      kind,
      name,
      aliases: uniqueList([...parsedName.secondaryNames, ...splitList(fields[2]!)]),
      episodeIds: episodeIds.length ? episodeIds : [defaultEpisodeId],
      ...(fields[4] ? { note: fields[4] } : {}),
    });
  }

  return { entities, errors };
}

/**
 * 库源 notes 的别名守门解析(1013 修):仅认首行「别名：」前缀(描述性备注不拆假别名),
 * 分隔符含顿号,token 剥尾部标点——打通「监工赵四↔赵四」类跨轮匹配。
 * 不照抄事件分析路径的 parseAssetNames 写法:该写法 split(/[;；,，]/) 拆不开顿号
 * (实跑「监工、监工老爷、赵四」返回整串 1 名),且对描述性 notes 不守门会拆出假别名。
 */
export function parseAliasesFromNotes(notes?: string): string[] {
  const firstLine = (notes ?? "").trim().split(/\r?\n/)[0] ?? "";
  if (!/^别名[：:]/.test(firstLine)) return [];
  return uniqueList(
    firstLine
      .replace(/^别名[：:]/, "")
      .split(/[、,，;；]/)
      .map((token) => token.replace(/[。.!！?？;；,，、\s]+$/, "").trim())
      .filter(Boolean),
  );
}

export function dedupeEntities(
  extracted: ExtractedEntity[],
  known: KnownEntity[] = [],
): DedupeEntitiesResult {
  const merged: DedupedEntity[] = [];

  for (const item of extracted) {
    const keys = entityKeys(item.kind, item.name, item.aliases);

    const existing = merged.find(
      (candidate) => candidate.kind === item.kind && shareKey(candidate, keys),
    );
    if (existing) {
      existing.aliases = uniqueList([...existing.aliases, ...item.aliases]);
      existing.episodeIds = uniqueList([...existing.episodeIds, ...item.episodeIds]);
      if (!existing.note && item.note) existing.note = item.note;
      continue;
    }

    const knownMatch = known.find(
      (candidate) =>
        candidate.kind === item.kind &&
        [candidate.name, ...candidate.aliases].some((value) => keys.has(normalizeName(value))),
    );

    merged.push({
      id: knownMatch?.id ?? null,
      isNew: !knownMatch,
      kind: item.kind,
      name: item.name,
      // 1013 修:已知别名并进输出实体(跨轮匹配面),仅滤与库规范名同归一的冗余 token。
      // 不按模型主名滤——模型名≠库名(赵四/监工赵四 主场景)时滤主名会断掉第二轮
      // 闭合→重复建库;主名保留在别名列是跨轮匹配的必要信息(实跑验证闭合保持)
      aliases: uniqueList([...item.aliases, ...(knownMatch?.aliases ?? [])]).filter(
        (alias) => !(knownMatch && normalizeName(alias) === normalizeName(knownMatch.name)),
      ),
      episodeIds: item.episodeIds,
      ...(item.note ? { note: item.note } : {}),
    });
  }

  return { entities: merged };
}

function entityKeys(_kind: EntityKind, name: string, aliases: string[]): Set<string> {
  return new Set([name, ...aliases].map(normalizeName).filter(Boolean));
}

function shareKey(entity: DedupedEntity, keys: Set<string>): boolean {
  for (const key of [entity.name, ...entity.aliases].map(normalizeName)) {
    if (keys.has(key)) return true;
  }
  return false;
}

export function normalizeName(value: string): string {
  return toHalfWidth(value).toLowerCase().replace(/\s+/g, "").trim();
}

function toHalfWidth(value: string): string {
  return value.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function isEntityKind(value: string): value is EntityKind {
  return KIND_VALUES.includes(value as EntityKind);
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line);
}

function isHeaderRow(line: string): boolean {
  const first = line.slice(1).split("|")[0]?.trim().toLowerCase() ?? "";
  return first === "类型" || first === "kind";
}

function stripFences(output: string): string {
  return output.replace(/```[a-zA-Z]*\n?|```/g, "");
}

function splitList(value: string, pattern: RegExp = /[、,，/]+/): string[] {
  return value
    .split(pattern)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueList(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
