/**
 * 实体出场索引(C1 Step 6;design §5 / D10 / D11 / D23 / R5 R6 R7)。
 *
 * 家=`store/extraction/entity-appearances.json`(D18:studio-workflow/ 之外,
 * 不受分片库孤儿清理管辖)。条目键=`${kind}:${normalizeName(name)}`。
 *
 * D23 schema:条目含 aliases(跨章并集,重提幂等合并)与 importance(历次
 * 提取最高档;真源=提取批 characters[].importance,三库 Character 无此字段)。
 * ——dedupeEntities 靠 name+aliases 匹配(entity-extraction.ts:196-200),
 * 索引缺 aliases 则「监工赵四↔赵四」跨章归并断链=必然重复建库(AC13)。
 *
 * 合并语义=并集累积:重提同章幂等(同数据合两次索引不变);首章
 * firstChapterId=章号数字最小者(后续章不覆盖,重提更早章纠正为真实首次)。
 *
 * 已知实体清单(D4):近 30 章出场 ∪ importance=protagonist,按 key 去重,
 * 上限 200(超出按最近出场排序截断);条目携带 aliases 并集供跨轮匹配。
 */

import { normalizeName, type EntityKind } from "@/lib/studio/entity-extraction";

export type EntityImportance = "protagonist" | "supporting" | "npc";

export const APPEARANCE_INDEX_RELATIVE_PATH = "store/extraction/entity-appearances.json";

/** 已知清单默认窗口:近 30 章(N=30 为常量,小样阶段可调,design §3)。 */
export const DEFAULT_KNOWN_LIST_RECENT_CHAPTERS = 30;
/** 已知清单默认上限 200(D4)。 */
export const DEFAULT_KNOWN_LIST_LIMIT = 200;

export interface EntityAppearanceEntry {
  kind: EntityKind;
  /** 首见主名(展示用;键匹配只看 normalizeName)。 */
  name: string;
  /** 跨章并集别名(不含与自身规范名同归一的 token)。 */
  aliases: string[];
  /** 历次提取最高档(protagonist > supporting > npc;未标=undefined)。 */
  importance?: EntityImportance;
  firstChapterId: string;
  /** 出场章集合,按章号数字升序。 */
  chapterIds: string[];
}

export type EntityAppearanceIndex = Record<string, EntityAppearanceEntry>;

export interface AppearanceRecordInput {
  kind: EntityKind;
  name: string;
  aliases: string[];
  importance?: EntityImportance;
}

export interface KnownEntityListItem {
  kind: EntityKind;
  name: string;
  aliases: string[];
}

const IMPORTANCE_RANK: Record<EntityImportance, number> = {
  npc: 1,
  supporting: 2,
  protagonist: 3,
};

/** 索引键 = `kind:normalizeName(name)`(design §5 `kind/normName` 键)。 */
export function appearanceKey(kind: EntityKind, name: string): string {
  return `${kind}:${normalizeName(name)}`;
}

/** chapter-NNN → 数字(999/1000 边界排序用)。 */
export function chapterNumberFromId(chapterId: string): number {
  const n = Number(chapterId.replace(/^chapter-/, ""));
  return Number.isFinite(n) ? n : 0;
}

function byChapterNumber(a: string, b: string): number {
  return chapterNumberFromId(a) - chapterNumberFromId(b);
}

function mergeImportance(
  current: EntityImportance | undefined,
  incoming: EntityImportance | undefined,
): EntityImportance | undefined {
  if (!current) return incoming;
  if (!incoming) return current;
  return IMPORTANCE_RANK[incoming] > IMPORTANCE_RANK[current] ? incoming : current;
}

/** 与既有条目做 name/别名 归一交叉匹配(同 kind;dedupeEntities 同款匹配面)。 */
function findMatchingEntry(
  index: EntityAppearanceIndex,
  record: AppearanceRecordInput,
): string | null {
  const recordKeys = new Set(
    [record.name, ...record.aliases].map(normalizeName).filter(Boolean),
  );
  for (const [key, entry] of Object.entries(index)) {
    if (entry.kind !== record.kind) continue;
    const entryNames = [entry.name, ...entry.aliases].map(normalizeName);
    if (entryNames.some((value) => recordKeys.has(value))) return key;
  }
  return null;
}

/** 按 name/别名归一交叉匹配定位条目键(C1 集成 Step 9 增量导出:runner 晋升
 * 判定需要拿到合并后的索引条目;匹配面=findMatchingEntry 本体,零新语义)。 */
export function findAppearanceEntryKey(
  index: EntityAppearanceIndex,
  record: AppearanceRecordInput,
): string | null {
  return findMatchingEntry(index, record);
}

/** 单章提取记录并入索引(幂等并集语义;不可变更新)。
 *
 * 匹配规则=同 kind 下 name/别名 归一交叉命中——第 2 章主名「监工赵四」、
 * 别名含「赵四」时命中第 1 章的「赵四」条目,并入同一条(AC13 闭合);
 * 反向形态(先「监工赵四」后「赵四」)同理由 entry.aliases 命中。
 */
export function mergeChapterAppearances(
  index: EntityAppearanceIndex,
  chapterId: string,
  records: AppearanceRecordInput[],
): EntityAppearanceIndex {
  const next: EntityAppearanceIndex = { ...index };

  for (const record of records) {
    if (!record.name.trim()) continue;
    const matchKey = findMatchingEntry(next, record);
    const key = matchKey ?? appearanceKey(record.kind, record.name);

    const existing = next[key];
    if (!existing) {
      next[key] = {
        kind: record.kind,
        name: record.name,
        aliases: uniqueAliases(record.name, record.aliases),
        ...(record.importance ? { importance: record.importance } : {}),
        firstChapterId: chapterId,
        chapterIds: [chapterId],
      };
      continue;
    }

    const chapterIds = [...new Set([...existing.chapterIds, chapterId])].sort(byChapterNumber);
    const importance = mergeImportance(existing.importance, record.importance);
    next[key] = {
      ...existing,
      aliases: uniqueAliases(existing.name, [...existing.aliases, record.name, ...record.aliases]),
      ...(importance ? { importance } : {}),
      firstChapterId: [existing.firstChapterId, ...chapterIds].sort(byChapterNumber)[0]!,
      chapterIds,
    };
  }

  return next;
}

/** 别名并集:去空/去重,并滤与自身规范名同归一的冗余 token。 */
function uniqueAliases(name: string, aliases: string[]): string[] {
  const self = normalizeName(name);
  return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))].filter(
    (alias) => normalizeName(alias) !== self,
  );
}

export interface PromotionContext {
  /** 三库既有实体键集合(`kind:normName`,由库名+别名归一构建);已在三库=晋升。 */
  libraryKeys?: ReadonlySet<string>;
}

/** 晋升判定(R7/D10):chapterIds≥2 或 importance=protagonist 或 已在三库(名或别名命中)。 */
export function isPromotedForLibrary(
  entry: EntityAppearanceEntry,
  context?: PromotionContext,
): boolean {
  if (entry.chapterIds.length >= 2) return true;
  if (entry.importance === "protagonist") return true;
  if (context?.libraryKeys) {
    const keys = [entry.name, ...entry.aliases].map((value) =>
      appearanceKey(entry.kind, value),
    );
    if (keys.some((key) => context.libraryKeys!.has(key))) return true;
  }
  return false;
}

export interface BuildKnownEntityListOptions {
  /** 即将提取的章号(窗口=该章之前近 N 章)。 */
  currentChapterNumber: number;
  recentChapters?: number;
  limit?: number;
}

/** 已知实体清单(D4/D23):近 N 章出场 ∪ importance=protagonist,去重,截断至 limit。
 *
 * 排序=最近出场章号降序(平键按 appearanceKey 字典序)——截断保最近,结果确定。
 * 不读三库(三库 Character 无 importance 字段,来源二=索引 protagonist)。
 */
export function buildKnownEntityList(
  index: EntityAppearanceIndex,
  options: BuildKnownEntityListOptions,
): KnownEntityListItem[] {
  const recent = options.recentChapters ?? DEFAULT_KNOWN_LIST_RECENT_CHAPTERS;
  const limit = options.limit ?? DEFAULT_KNOWN_LIST_LIMIT;
  const windowLower = options.currentChapterNumber - recent;

  const candidates = Object.entries(index)
    .filter(([_key, entry]) => {
      if (entry.importance === "protagonist") return true;
      return entry.chapterIds.some(
        (chapterId) =>
          chapterNumberFromId(chapterId) >= windowLower &&
          chapterNumberFromId(chapterId) < options.currentChapterNumber,
      );
    })
    .map(([key, entry]) => ({
      key,
      entry,
      lastSeen: Math.max(...entry.chapterIds.map(chapterNumberFromId)),
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen || (a.key < b.key ? -1 : 1));

  const seen = new Set<string>();
  const list: KnownEntityListItem[] = [];
  for (const { key, entry } of candidates) {
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ kind: entry.kind, name: entry.name, aliases: [...entry.aliases] });
    if (list.length >= limit) break;
  }
  return list;
}

/** 确定性序列化(键字典序)。 */
export function serializeAppearanceIndex(index: EntityAppearanceIndex): string {
  const sorted: EntityAppearanceIndex = {};
  for (const key of Object.keys(index).sort()) {
    sorted[key] = index[key]!;
  }
  return JSON.stringify(sorted);
}

/** 宽容解析:非法 JSON/空串 → 空索引。 */
export function parseAppearanceIndex(raw: string): EntityAppearanceIndex {
  try {
    const parsed = JSON.parse(raw) as EntityAppearanceIndex;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}
