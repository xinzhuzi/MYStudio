import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * 人物技能卡(10-25 用户令:人物技能文档要像设定一样有展示 UI)。
 *
 * 数据结构(assets.skills 列,入库役 campaigns/role_skills_ingest_1025.py):
 * RoleSkillPayload[] = 每道途一元素;晏燎五系=五元素,单道途角色=一元素。
 * 视图分层:道途 → 境界重(第N重) → 术法条(名/类型/前置/描述)。
 * 道途层与境界层均可折叠(晏燎五系×十境全展开会非常长);默认道途展开、境界折叠。
 */

export interface RoleSkill {
  /** 境界重分组,如「第1重」;null=未分组(文件顶部散条) */
  realm: string | null;
  /** 术法名 */
  name: string;
  /** 主动/增益/被动术法等 */
  type: string | null;
  /** 前置术法名;null=无 */
  prerequisite: string | null;
  /** 术法描述 */
  description: string;
}

export interface RoleSkillPayload {
  /** 道途名(如「剑主男」) */
  dao: string;
  /** 源文件名(审计溯源) */
  source: string;
  /** 该道途全量术法 */
  skills: RoleSkill[];
}

/** 解析 skills 列(容错:空/坏 JSON=无技能,不炸 UI)。 */
export function parseRoleSkills(raw: string | undefined | null): RoleSkillPayload[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is RoleSkillPayload =>
        typeof p === "object" && p !== null && typeof p.dao === "string" && Array.isArray(p.skills),
    );
  } catch {
    return [];
  }
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const tone =
    type.includes("被动") ? "text-muted-foreground" : type.includes("增益") ? "text-primary" : "text-foreground";
  return <span className={`shrink-0 text-[10px] ${tone}`}>[{type}]</span>;
}

/** 术法条(10-26 折叠手感修:描述默认两行截断,点条展开全文——与人物提示词面板
 *  同款交互;境界层箭头此前 2.5px 全灰不可感知,用户实录「没有折叠」)。 */
function SkillEntry({ skill }: { skill: RoleSkill }) {
  const [expanded, setExpanded] = useState(false);
  const clamped = skill.description.length > 60;
  return (
    <button
      type="button"
      className="w-full rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/50"
      onClick={() => clamped && setExpanded((value) => !value)}
      title={clamped ? (expanded ? "点击收起描述" : "点击展开完整描述") : undefined}
      aria-expanded={clamped ? expanded : undefined}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 font-medium text-foreground">{skill.name}</span>
        <TypeBadge type={skill.type} />
        {skill.prerequisite && (
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            前置:{skill.prerequisite}
          </span>
        )}
      </div>
      {skill.description ? (
        <p
          className={`text-muted-foreground ${expanded || !clamped ? "" : "line-clamp-2"}`}
        >
          {skill.description}
        </p>
      ) : null}
    </button>
  );
}

export function StudioAssetRoleSkills({ skills }: { skills: string | undefined | null }) {
  const payloads = useMemo(() => parseRoleSkills(skills), [skills]);
  // 10-26 用户令「默认情况下要折叠」:道途默认全收起(推翻 10-25 旧口径「默认
  // 道途展开」——晏燎五系开卡即铺一墙境界行);点道途行才展开该道途。
  // 记录法反转:expandedDaos 白名单(空集=全收),旧 collapsedDaos 黑名单弃用。
  const [expandedDaos, setExpandedDaos] = useState<Set<string>>(new Set());
  const [expandedRealms, setExpandedRealms] = useState<Set<string>>(new Set());
  // 10-25 用户令「人物技能,默认折叠」:整卡默认折叠(头部一行摘要可见)——
  // 晏燎五系道途行全铺会占弹窗约九成高度;点开卡后内层为 道途全收起/境界收起
  const [cardOpen, setCardOpen] = useState(false);

  if (payloads.length === 0) return null;

  const toggleDao = (dao: string) =>
    setExpandedDaos((prev) => {
      const next = new Set(prev);
      if (next.has(dao)) next.delete(dao);
      else next.add(dao);
      return next;
    });
  const toggleRealm = (key: string) =>
    setExpandedRealms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totalSkills = payloads.reduce((sum, p) => sum + p.skills.length, 0);

  return (
    <section
      className="space-y-2 overflow-hidden rounded-lg border border-border bg-muted/90 p-3"
      aria-label="人物技能"
    >
      <button
        type="button"
        className="flex min-w-0 w-full items-center gap-1.5 rounded-md text-left"
        onClick={() => setCardOpen((open) => !open)}
        aria-expanded={cardOpen}
        aria-label={`人物技能${cardOpen ? "折叠" : "展开"}`}
      >
        {cardOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-semibold text-foreground">人物技能</span>
        <span className="text-[10px] text-muted-foreground">
          {payloads.length} 道途 · {totalSkills} 术法
        </span>
      </button>
      {cardOpen && <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {payloads.map((payload) => {
          const daoOpen = expandedDaos.has(payload.dao);
          const realms = groupSkillsByRealm(payload.skills);
          return (
            <div key={payload.dao} className="rounded-md border border-border/60 bg-background/40">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                onClick={() => toggleDao(payload.dao)}
                aria-expanded={daoOpen}
                aria-label={`${payload.dao} 道途技能${daoOpen ? "折叠" : "展开"}`}
              >
                {daoOpen ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="text-xs font-medium text-foreground">{payload.dao}</span>
                <span className="text-[10px] text-muted-foreground">{payload.skills.length} 式</span>
              </button>
              {daoOpen && (
                <div className="space-y-1 px-2 pb-1.5">
                  {realms.map(([realm, entries]) => {
                    const key = `${payload.dao}::${realm ?? "未分组"}`;
                    const expanded = expandedRealms.has(key);
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60"
                          onClick={() => toggleRealm(key)}
                          aria-expanded={expanded}
                          aria-label={`${payload.dao} ${realm ?? "未分组"}${expanded ? "折叠" : "展开"}`}
                        >
                          {expanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          )}
                          <span className="text-[11px] font-medium text-foreground/90">
                            {realm ?? "未分组"}
                          </span>
                          <span className="rounded border border-border/60 px-1 text-[10px] leading-4 text-muted-foreground">
                            {entries.length}
                          </span>
                        </button>
                        {expanded && (
                          <div className="space-y-1 pl-4">
                            {entries.map((skill) => (
                              <SkillEntry key={`${key}::${skill.name}`} skill={skill} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>}
    </section>
  );
}

/** 按 realm 分组保序(第1重/第5重…保持文件序)。 */
function groupSkillsByRealm(entries: RoleSkill[]): Array<[string | null, RoleSkill[]]> {
  const map = new Map<string | null, RoleSkill[]>();
  for (const entry of entries) {
    const list = map.get(entry.realm);
    if (list) list.push(entry);
    else map.set(entry.realm, [entry]);
  }
  return [...map.entries()];
}
