import { getAgentSkillPreset } from "@/lib/studio/manuals";

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
- 名称：实体最常用规范称呼
- 别名：顿号分隔，无则留空
- 集ID：逗号分隔，无则留空（默认归当前集）
- 备注：必填。角色写外貌特征/身份/性格（一句话），场景写环境特征，道具写外观/用途
- 不输出表头行、分隔线、解释、代码块围栏；只输出数据行
`.trim();

export function buildEntityExtractionMessages(input: BuildEntityExtractionInput): EntityExtractionMessages {
  const skill = getAgentSkillPreset("entity_extractor")?.content ?? "";
  const knownBlock = (input.knownEntities ?? [])
    .map((item) => `- [${item.kind}] ${item.name}${item.aliases.length ? `（别名：${item.aliases.join("、")}）` : ""} → 复用ID ${item.id}`)
    .join("\n");

  return {
    system: [skill, outputSpec].filter(Boolean).join("\n\n"),
    user: [
      `当前集ID：${input.episodeId}`,
      "已知实体（命中请复用其ID、归并别名，勿重复新建）：",
      knownBlock || "无",
      "",
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
    const name = fields[1]!;
    if (!isEntityKind(kind) || !name) {
      errors.push(line);
      continue;
    }

    const episodeIds = splitList(fields[3]!, /[,，]+/);
    entities.push({
      kind,
      name,
      aliases: splitList(fields[2]!),
      episodeIds: episodeIds.length ? episodeIds : [defaultEpisodeId],
      ...(fields[4] ? { note: fields[4] } : {}),
    });
  }

  return { entities, errors };
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
      aliases: item.aliases,
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
