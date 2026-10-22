import { getAgentSkillPreset } from "@/lib/studio/manuals";
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
    // 实体名不是媒体路径；仅保留名称列原有的分隔及大小写/空白去重语义。
    const seenNames = new Set<string>();
    const names = splitList(fields[1]!, /[;；,，]/).filter((value) => {
      const key = value.replace(/\s+/g, "").toLocaleLowerCase("zh-Hans-CN");
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
    const [name, ...secondaryNames] = names;
    if (!isEntityKind(kind) || !name) {
      errors.push(line);
      continue;
    }

    const episodeIds = splitList(fields[3]!, /[,，]+/);
    entities.push({
      kind,
      name,
      aliases: uniqueList([...secondaryNames, ...splitList(fields[2]!)]),
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

/**
 * 批内身份匹配(10-20 修):只认「主名↔主名」「主名↔单一别名」「单一别名↔主名」,
 * 禁止别名↔别名。旧实现任一名/别名交叉命中即并,导致同一泛用别名(符音/妇人/OS)
 * 把不同实体并成一条、后续实体主名消失;1438 章「绯樱/晏燎同挂符音」实杀。
 * 歧义守卫:被多行共用的别名不参与匹配(反向形态「红儿→小红」仍由唯一别名命中)。
 */
export function dedupeEntities(
  extracted: ExtractedEntity[],
  known: KnownEntity[] = [],
): DedupeEntitiesResult {
  const merged: DedupedEntity[] = [];
  const batchLookup = buildBatchLookup(extracted);
  const knownLookup = buildKnownLookup(known);

  for (const item of extracted) {
    const existing = findBatchMatch(merged, item, batchLookup);
    if (existing) {
      existing.aliases = uniqueList([...existing.aliases, item.name, ...item.aliases]).filter(
        (alias) => normalizeName(alias) !== normalizeName(existing.name),
      );
      existing.episodeIds = uniqueList([...existing.episodeIds, ...item.episodeIds]);
      if (!existing.note && item.note) existing.note = item.note;
      continue;
    }

    const knownMatch = findKnownMatch(item, knownLookup);
    // 1013 修:已知别名并进输出实体(跨轮匹配面),仅滤与库规范名同归一的冗余 token。
    // 不按模型主名滤——模型名≠库名(赵四/监工赵四 主场景)时滤主名会断掉第二轮
    // 闭合→重复建库;主名保留在别名列是跨轮匹配的必要信息(实跑验证闭合保持)。
    // 10-20 加守门:被多个已知实体共用/本身是他人规范名的别名不回灌(苏无忌吞独孤类污染)。
    const knownAliases = knownMatch ? safeKnownAliases(knownMatch, knownLookup) : [];
    merged.push({
      id: knownMatch?.id ?? null,
      isNew: !knownMatch,
      kind: item.kind,
      name: item.name,
      aliases: uniqueList([...item.aliases, ...knownAliases]).filter(
        (alias) => !(knownMatch && normalizeName(alias) === normalizeName(knownMatch.name)),
      ),
      episodeIds: item.episodeIds,
      ...(item.note ? { note: item.note } : {}),
    });
  }

  return { entities: merged };
}

interface BatchLookup {
  /** `kind:normAlias` → 声明该别名的行主键集合(行主键=`kind:normName`)。 */
  aliasOwners: Map<string, Set<string>>;
}

function rowKey(item: ExtractedEntity): string {
  return `${item.kind}:${normalizeName(item.name)}`;
}

function buildBatchLookup(extracted: ExtractedEntity[]): BatchLookup {
  const aliasOwners = new Map<string, Set<string>>();
  for (const item of extracted) {
    const owner = rowKey(item);
    for (const alias of item.aliases) {
      const token = normalizeName(alias);
      if (!token) continue;
      const key = `${item.kind}:${token}`;
      const owners = aliasOwners.get(key) ?? new Set<string>();
      owners.add(owner);
      aliasOwners.set(key, owners);
    }
  }
  return { aliasOwners };
}

/** 主名命中别名时:除本行外只有候选条目声明该别名(=唯一归属,可并)。 */
function isUnambiguousAlias(
  item: ExtractedEntity,
  token: string,
  lookup: BatchLookup,
): boolean {
  const owners = lookup.aliasOwners.get(`${item.kind}:${token}`);
  if (!owners) return false;
  const self = rowKey(item);
  let foreign = 0;
  for (const owner of owners) if (owner !== self) foreign += 1;
  return foreign === 1;
}

/** 入别名命中主名时:除本行外无其他行把该 token 当别名(=未被抢占,可并)。 */
function isUnclaimedAlias(
  item: ExtractedEntity,
  token: string,
  lookup: BatchLookup,
): boolean {
  const owners = lookup.aliasOwners.get(`${item.kind}:${token}`);
  if (!owners) return true;
  const self = rowKey(item);
  for (const owner of owners) if (owner !== self) return false;
  return true;
}

function findBatchMatch(
  merged: DedupedEntity[],
  item: ExtractedEntity,
  lookup: BatchLookup,
): DedupedEntity | undefined {
  const nameToken = normalizeName(item.name);
  if (!nameToken) return undefined;

  const sameKind = merged.filter((candidate) => candidate.kind === item.kind);
  const nameMatch = sameKind.find((candidate) => normalizeName(candidate.name) === nameToken);
  if (nameMatch) return nameMatch;

  if (isUnambiguousAlias(item, nameToken, lookup)) {
    const aliasMatches = sameKind.filter((candidate) =>
      candidate.aliases.some((alias) => normalizeName(alias) === nameToken),
    );
    if (aliasMatches.length === 1) return aliasMatches[0];
  }

  const aliasTokens = new Set(item.aliases.map(normalizeName).filter(Boolean));
  if (!aliasTokens.size) return undefined;
  const primaryMatches = sameKind.filter(
    (candidate) =>
      aliasTokens.has(normalizeName(candidate.name)) &&
      isUnclaimedAlias(item, normalizeName(candidate.name), lookup),
  );
  return primaryMatches.length === 1 ? primaryMatches[0] : undefined;
}

interface KnownLookup {
  byKey: Map<string, KnownEntity>;
  /** `kind:normName` → 同规范名的已知条目(库重复条目可能多条)。 */
  canonical: Map<string, KnownEntity[]>;
  /** `kind:normAlias` → 声明该别名的已知条目键集合。 */
  aliasOwners: Map<string, Set<string>>;
}

function knownEntityKey(entity: KnownEntity): string {
  return entity.id ? `id:${entity.id}` : `${entity.kind}:${normalizeName(entity.name)}`;
}

function buildKnownLookup(known: KnownEntity[]): KnownLookup {
  const byKey = new Map<string, KnownEntity>();
  const canonical = new Map<string, KnownEntity[]>();
  const aliasOwners = new Map<string, Set<string>>();

  for (const entity of known) {
    const nameToken = normalizeName(entity.name);
    if (!nameToken) continue;
    const key = knownEntityKey(entity);
    if (!byKey.has(key)) byKey.set(key, entity);

    const nameKey = `${entity.kind}:${nameToken}`;
    const sameName = canonical.get(nameKey) ?? [];
    sameName.push(entity);
    canonical.set(nameKey, sameName);

    for (const alias of entity.aliases) {
      const aliasToken = normalizeName(alias);
      if (!aliasToken) continue;
      const aliasKey = `${entity.kind}:${aliasToken}`;
      const owners = aliasOwners.get(aliasKey) ?? new Set<string>();
      owners.add(key);
      aliasOwners.set(aliasKey, owners);
    }
  }

  return { byKey, canonical, aliasOwners };
}

/**
 * 已知匹配(10-20):先库条目(有 id)后索引条目,同层按
 * 主名=规范名 → 主名=唯一别名 → 唯一别名=规范名 的顺序;
 * 别名↔别名不参与。库条目优先避免索引先命中同人导致重复建库。
 */
function findKnownMatch(item: ExtractedEntity, lookup: KnownLookup): KnownEntity | undefined {
  return findKnownMatchPass(item, lookup, true) ?? findKnownMatchPass(item, lookup, false);
}

function findKnownMatchPass(
  item: ExtractedEntity,
  lookup: KnownLookup,
  requireId: boolean,
): KnownEntity | undefined {
  const nameToken = normalizeName(item.name);
  if (!nameToken) return undefined;
  const hasId = (entity: KnownEntity) => Boolean(entity.id) === requireId;
  const tokenKey = `${item.kind}:${nameToken}`;

  const canonicalMatches = (lookup.canonical.get(tokenKey) ?? []).filter(hasId);
  if (canonicalMatches.length) return canonicalMatches[0];

  const owners = lookup.aliasOwners.get(tokenKey);
  if (owners) {
    const aliasMatches = [...owners]
      .map((key) => lookup.byKey.get(key))
      .filter((entity): entity is KnownEntity => !!entity && hasId(entity));
    if (aliasMatches.length === 1) return aliasMatches[0];
  }

  const aliasCanonical = new Map<string, KnownEntity>();
  for (const alias of item.aliases) {
    const token = normalizeName(alias);
    if (!token) continue;
    const matches = (lookup.canonical.get(`${item.kind}:${token}`) ?? []).filter(hasId);
    if (matches.length !== 1) continue;
    aliasCanonical.set(knownEntityKey(matches[0]!), matches[0]!);
  }
  return aliasCanonical.size === 1 ? [...aliasCanonical.values()][0] : undefined;
}

/** 已知别名回灌守门:丢弃本身是他人规范名、或被多个已知条目共用的别名。 */
function safeKnownAliases(match: KnownEntity, lookup: KnownLookup): string[] {
  const selfKey = knownEntityKey(match);
  const selfName = normalizeName(match.name);
  return match.aliases.filter((alias) => {
    const token = normalizeName(alias);
    if (!token || token === selfName) return false;
    if (lookup.canonical.has(`${match.kind}:${token}`)) return false;
    const owners = lookup.aliasOwners.get(`${match.kind}:${token}`);
    return !!owners && owners.size === 1 && owners.has(selfKey);
  });
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
