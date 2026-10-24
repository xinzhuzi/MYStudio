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

export function StudioAssetRoleSkills({ skills }: { skills: string | undefined | null }) {
  const payloads = useMemo(() => parseRoleSkills(skills), [skills]);
  const [collapsedDaos, setCollapsedDaos] = useState<Set<string>>(new Set());
  const [expandedRealms, setExpandedRealms] = useState<Set<string>>(new Set());

  if (payloads.length === 0) return null;

  const toggleDao = (dao: string) =>
    setCollapsedDaos((prev) => {
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
      <div className="flex min-w-0 items-center gap-2">
        <div className="text-xs font-semibold text-foreground">人物技能</div>
        <div className="text-[10px] text-muted-foreground">
          {payloads.length} 道途 · {totalSkills} 术法
        </div>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {payloads.map((payload) => {
          const daoCollapsed = collapsedDaos.has(payload.dao);
          const realms = groupSkillsByRealm(payload.skills);
          return (
            <div key={payload.dao} className="rounded-md border border-border/60 bg-background/40">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left"
                onClick={() => toggleDao(payload.dao)}
                aria-expanded={!daoCollapsed}
                aria-label={`${payload.dao} 道途技能${daoCollapsed ? "展开" : "折叠"}`}
              >
                {daoCollapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="text-xs font-medium text-foreground">{payload.dao}</span>
                <span className="text-[10px] text-muted-foreground">{payload.skills.length} 式</span>
              </button>
              {!daoCollapsed && (
                <div className="space-y-1 px-2 pb-1.5">
                  {realms.map(([realm, entries]) => {
                    const key = `${payload.dao}::${realm ?? "未分组"}`;
                    const expanded = expandedRealms.has(key);
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1 rounded-md py-0.5 text-left"
                          onClick={() => toggleRealm(key)}
                          aria-expanded={expanded}
                          aria-label={`${payload.dao} ${realm ?? "未分组"}${expanded ? "折叠" : "展开"}`}
                        >
                          {expanded ? (
                            <ChevronDown className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="text-[11px] font-medium text-muted-foreground">
                            {realm ?? "未分组"}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">{entries.length}</span>
                        </button>
                        {expanded && (
                          <div className="space-y-1 pl-4">
                            {entries.map((skill) => (
                              <div key={`${key}::${skill.name}`} className="text-[11px] leading-relaxed">
                                <div className="flex min-w-0 items-baseline gap-1.5">
                                  <span className="shrink-0 font-medium text-foreground">{skill.name}</span>
                                  <TypeBadge type={skill.type} />
                                  {skill.prerequisite && (
                                    <span className="shrink-0 text-[10px] text-muted-foreground/70">
                                      前置:{skill.prerequisite}
                                    </span>
                                  )}
                                </div>
                                {skill.description && (
                                  <p className="text-muted-foreground">{skill.description}</p>
                                )}
                              </div>
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
      </div>
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
