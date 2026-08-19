// 概览元数据 AI 填充（Trellis 08-18-overview-portal-ai-fill R2/R3）。
// 素材优先级复用动作级注入链（偏好→MEMORY.md→档案检索），
// 追加剧本开头；问答答案仅作本次生成约束，不持久化（长期口味归作者偏好层）。
import type { Faction, NamedEntity, SeriesMeta } from "@/types/script";

export interface OverviewFillQuestions {
  /** 改编基调（单选，可空=跳过） */
  tone?: string;
  /** 侧重维度（多选，可空） */
  focus?: string[];
  /** 概略详略（单选，可空） */
  detailLevel?: string;
}

export interface OverviewFillMessages {
  system: string;
  user: string;
}

/** AI 可填充的文本字段 → 中文标签 + 长度上限 */
const TEXT_FIELDS: Record<string, { label: string; max: number }> = {
  title: { label: "书名", max: 40 },
  logline: { label: "一句话概括", max: 160 },
  outline: { label: "大纲", max: 600 },
  centralConflict: { label: "核心冲突", max: 160 },
  era: { label: "时代", max: 24 },
  genre: { label: "类型", max: 24 },
  timelineSetting: { label: "时间线", max: 120 },
  socialSystem: { label: "社会体系", max: 160 },
  powerSystem: { label: "力量体系", max: 160 },
  worldNotes: { label: "世界观补充", max: 400 },
};

const THEMES_MAX = 6;
const ENTITY_LIST_MAX = 12;

export const OVERVIEW_FILL_FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(TEXT_FIELDS).map(([k, v]) => [k, v.label])),
  themes: "主题",
  geography: "地理设定",
  keyItems: "关键物品",
  factions: "阵营",
};

/** characters 不进 AI 填充：ScriptCharacter 结构复杂（身份/外貌/口癖等），
 *  生成质量不可控且污染面大——角色以实体提取管线与手编为准。 */

function describeQuestions(questions: OverviewFillQuestions): string {
  const lines: string[] = [];
  if (questions.tone) lines.push(`- 改编基调：${questions.tone}`);
  if (questions.focus?.length) lines.push(`- 侧重维度：${questions.focus.join("、")}`);
  if (questions.detailLevel) lines.push(`- 概略详略：${questions.detailLevel}`);
  return lines.length ? `【用户改编意图（最高优先级，覆盖默认判断）】\n${lines.join("\n")}` : "";
}

function describeCurrentMeta(meta: SeriesMeta): string {
  const filled: string[] = [];
  const empty: string[] = [];
  for (const [key, def] of Object.entries(TEXT_FIELDS)) {
    const value = (meta as unknown as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) filled.push(`${def.label}=${value.trim().slice(0, 60)}`);
    else empty.push(def.label);
  }
  for (const key of ["themes", "geography", "keyItems", "factions"] as const) {
    const value = meta[key];
    if (value && value.length) filled.push(`${OVERVIEW_FILL_FIELD_LABELS[key]}=${value.length} 项（已存在）`);
    else empty.push(OVERVIEW_FILL_FIELD_LABELS[key]);
  }
  return [
    `【当前字段状态】`,
    `已填（供参考保持一致，除非用户意图冲突）：${filled.join("；") || "无"}`,
    `为空（优先推断这些）：${empty.join("；") || "无"}`,
  ].join("\n");
}

export function buildOverviewFillMessages(input: {
  context: string;
  currentMeta: SeriesMeta;
  questions?: OverviewFillQuestions;
}): OverviewFillMessages {
  const fieldRules = [
    ...Object.entries(TEXT_FIELDS).map(([key, def]) => `"${key}"（${def.label}，≤${def.max}字）`),
    `"themes"（主题标签，字符串数组，≤${THEMES_MAX}个，每个2-6字）`,
    `"geography"（地理设定，对象数组 {name,desc}，≤${ENTITY_LIST_MAX}个）`,
    `"keyItems"（关键物品，对象数组 {name,desc}，≤${ENTITY_LIST_MAX}个）`,
    `"factions"（阵营，对象数组 {name,members:人名数组}，≤${ENTITY_LIST_MAX}个）`,
  ].join("；");
  const system = [
    "你是剧集制片助理，依据原著素材为「项目概览」元数据提字段建议。",
    `可输出字段（不确定的键直接省略，严禁编造）：${fieldRules}。`,
    "characters 角色列表不在你的输出范围。",
    "只输出一个 JSON 对象，不要 markdown 代码块，不要解释文字。",
  ].join("\n");
  const user = [
    describeQuestions(input.questions ?? {}),
    "【原著素材】",
    input.context,
    describeCurrentMeta(input.currentMeta),
    "依据素材填字段；用户意图与素材冲突时以用户意图为准；为空字段优先。",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, user };
}

function coerceNamedEntityList(value: unknown): NamedEntity[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rec = item as Record<string, unknown>;
      if (typeof rec.name !== "string" || !rec.name.trim()) return null;
      return { name: rec.name.trim().slice(0, 40), desc: String(rec.desc ?? "").trim().slice(0, 120) };
    })
    .filter((x): x is NamedEntity => x !== null)
    .slice(0, ENTITY_LIST_MAX);
  return out;
}

function coerceText(key: string, value: unknown): string | undefined {
  const def = TEXT_FIELDS[key];
  if (!def || typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, def.max) : undefined;
}

/** 解析模型输出为白名单字段集；未知键丢弃、形状不对丢弃、全空返回 error。 */
export function parseOverviewFillResponse(text: string): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, error: "AI 响应不含 JSON 对象" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: "AI 响应 JSON 解析失败" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "AI 响应不是 JSON 对象" };
  }
  const rec = parsed as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(TEXT_FIELDS)) {
    const coerced = coerceText(key, rec[key]);
    if (coerced !== undefined) fields[key] = coerced;
  }
  if (Array.isArray(rec.themes)) {
    const themes = rec.themes.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim().slice(0, 12)).slice(0, THEMES_MAX);
    if (themes.length) fields.themes = themes;
  }
  for (const key of ["geography", "keyItems"] as const) {
    const list = coerceNamedEntityList(rec[key]);
    if (list?.length) fields[key] = list;
  }
  if (Array.isArray(rec.factions)) {
    const factions = rec.factions
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const r = item as Record<string, unknown>;
        if (typeof r.name !== "string" || !r.name.trim()) return null;
        const members = Array.isArray(r.members)
          ? r.members.filter((m): m is string => typeof m === "string" && !!m.trim()).slice(0, 20)
          : [];
        return { name: r.name.trim().slice(0, 40), members } satisfies Faction;
      })
      .filter((x): x is Faction => x !== null)
      .slice(0, ENTITY_LIST_MAX);
    if (factions.length) fields.factions = factions;
  }
  if (Object.keys(fields).length === 0) return { ok: false, error: "AI 响应无可识别字段" };
  return { ok: true, fields };
}

function isEmptyMetaValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** 默认只填空字段；overwrite=true 时建议值覆盖已有值。 */
export function mergeFillIntoMeta(
  current: SeriesMeta,
  proposal: Record<string, unknown>,
  options: { overwrite?: boolean } = {},
): Partial<SeriesMeta> {
  const updates: Partial<SeriesMeta> = {};
  for (const [key, value] of Object.entries(proposal)) {
    if (!(key in OVERVIEW_FILL_FIELD_LABELS)) continue;
    const current_value = (current as unknown as Record<string, unknown>)[key];
    if (options.overwrite || isEmptyMetaValue(current_value)) {
      (updates as Record<string, unknown>)[key] = value;
    }
  }
  return updates;
}

export interface OverviewFillResult {
  ok: boolean;
  fields?: Record<string, unknown>;
  error?: string;
}

/** 编排一次填充：消息构造 → callText（注入以便测试）→ 解析。 */
export async function runOverviewMetaFill(input: {
  context: string;
  currentMeta: SeriesMeta;
  questions?: OverviewFillQuestions;
  callText: (messages: OverviewFillMessages) => Promise<string>;
}): Promise<OverviewFillResult> {
  let raw: string;
  try {
    raw = await input.callText(buildOverviewFillMessages(input));
  } catch (error) {
    return { ok: false, error: `AI 调用失败：${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = parseOverviewFillResponse(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, fields: parsed.fields };
}
