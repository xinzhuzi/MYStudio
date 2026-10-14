import type { AgentSkillPreset, StudioManualKind, StudioManualPreset, StudioWorkflowConfig } from "@/types/studio";
import { directorImages, visualImages } from "@/lib/studio/manuals-images";

type MarkdownMap = Record<string, string>;

export interface StudioManualSkillOverrideFile {
  relativePath: string;
  content: string;
}

export type StudioManualCatalog = Partial<Record<StudioManualKind, StudioManualPreset[]>>;

export interface BuildStoredStudioManualsOptions {
  imagesByManualId?: Record<string, string[]>;
}

const visualMarkdown = import.meta.glob([
  "../../assets/studio-manuals/art_skills/**/*.md",
  "!../../assets/studio-manuals/art_skills/daojie_ink_guofeng/**",
], {
  eager: true,
  query: "?raw",
  import: "default",
}) as MarkdownMap;

const directorMarkdown = import.meta.glob("../../assets/studio-manuals/story_skills/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as MarkdownMap;

const productionMarkdown = import.meta.glob("../../assets/studio-manuals/production_skills/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as MarkdownMap;

const agentSkillMarkdown = import.meta.glob("../../assets/studio-manuals/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as MarkdownMap;

// 图片 glob 已拆至 manuals-images.ts:主进程构建经别名换空桩,防 out/main
// 重复发射 56MB PNG(09-15);此处仅渲染层构建解析到真图。

const visualModuleKeys = [
  "README",
  "prefix",
  "art_character",
  "art_character_derivative",
  "art_prop",
  "art_prop_derivative",
  "art_scene",
  "art_scene_derivative",
  "director_storyboard",
  "art_storyboard_video",
  "director_planning_style",
  "director_storyboard_table_style",
] as const;

const directorModuleKeys = [
  "README",
  "director_planning_narrative",
  "director_storyboard_table_narrative",
  // R2/父 I1/I2:剧本级规则模块(包根,与 README 同级);v3 建文件,此处登记键——影响 moduleCount
  "script_narrative",
] as const;

const productionModuleKeys = [
  "storyboard_prompt_techniques",
  "storyboard_table_techniques",
  "depth_friendly_3d",
] as const;

export const EXTENDED_VISUAL_MANUAL_SEED_ID = "daojie_ink_guofeng";
export const EXTENDED_DIRECTOR_MANUAL_SEED_ID = "Daojie_xianxia";
export const DEFAULT_VISUAL_MANUAL_ID = "";
export const DEFAULT_DIRECTOR_MANUAL_ID = "";

export function listStudioManualPresets(kind: StudioManualKind): StudioManualPreset[] {
  if (kind === "visual") return buildManuals("visual", visualMarkdown, visualImages, visualModuleKeys);
  if (kind === "director") return buildManuals("director", directorMarkdown, directorImages, directorModuleKeys);
  return buildProductionManuals();
}

export function getStudioManualPreset(kind: StudioManualKind, id: string | undefined | null): StudioManualPreset | null {
  if (!id) return null;
  return listStudioManualPresets(kind).find((item) => item.id === id) ?? null;
}

export interface BuildStudioManualContextOptions {
  /**
   * 模块注入字数帽(G39/G15,10-12 第8轮「都做完」):缺省 4000=现状摘要口径;
   * ≤0=不截断全量注入(导演规划阶段两调用方传 0,22KB 规划文档不再截 4000 字)。
   * 其余调用方缺省不传 → 行为零变化(G11 口径不动)。
   */
  moduleCharCap?: number;
}

export function buildStudioManualContext(
  config: Partial<StudioWorkflowConfig>,
  catalog: StudioManualCatalog = {},
  opts: BuildStudioManualContextOptions = {},
): string {
  const moduleCharCap = opts.moduleCharCap ?? 4000;
  const visualManual = resolveStudioManualPreset("visual", config.visualManualId, catalog);
  const directorManual = resolveStudioManualPreset("director", config.directorManualId, catalog);

  return [
    "# 视觉手册",
    visualManual ? buildManualSummary(visualManual, ["README", "prefix", "director_planning_style", "art_storyboard_video"], moduleCharCap) : "未选择",
    "",
    "# 导演手册",
    directorManual ? buildManualSummary(directorManual, ["README", "director_planning_narrative", "director_storyboard_table_narrative"], moduleCharCap) : "未选择",
  ].join("\n");
}

export function getManualModuleText(kind: StudioManualKind, id: string | undefined | null, moduleKey: string): string {
  return getStudioManualPreset(kind, id)?.modules[moduleKey] ?? "";
}

/**
 * 剧本阶段的手册上下文(R2/G11–G14):只返回所选导演包的 script_narrative(剧本级规则),
 * 不注 README/视觉手册/规划文档(G12);全文不截断(题材包自含篇幅约束,不走 4000 字摘要);
 * 未选导演包或模块缺失(存储副本无该文件) → 返回 ""(G14 容忍缺失,零注入)。
 * 标题=父 I3:`## 题材剧本规则（<包名>）`,由本函数自带(调用方原样推入 user 段)。
 */
export function buildScriptManualContext(
  config: Partial<StudioWorkflowConfig>,
  catalog: StudioManualCatalog = {},
): string {
  const directorManual = resolveStudioManualPreset("director", config.directorManualId, catalog);
  const body = directorManual?.modules.script_narrative?.trim() ?? "";
  if (!body || !directorManual) return "";
  return `## 题材剧本规则（${directorManual.name}）\n${body}`;
}

/**
 * 分镜表阶段的手册上下文：视觉手册 prefix（风格锚词）+ director_storyboard_table_style（分镜表风格约束）
 * 与导演手册 director_storyboard_table_narrative（分镜表叙事技法）——
 * 这两个模块原本只在 workflow-node-model 的 UI 预览卡出现,从未进入分镜表 LLM;
 * 注入后分镜表「画面描述」列（后续分镜帧生图的提示词种子）才携带所选风格。
 */
export function buildStoryboardTableManualContext(
  config: Partial<StudioWorkflowConfig>,
  catalog: StudioManualCatalog = {},
  opts: BuildStudioManualContextOptions = {},
): string {
  // H3(10-14 裁定,四审D):分镜上下文缺省全量不截断(moduleCharCap≤0=全量,G39 语义)——
  // 道劫 director_storyboard_table_narrative 17945 字此前被缺省 4000 截掉 §6-§10 关键节。
  // 量级依据:规划阶段两调用方今天已对同一导演包 narrative(22407 字)传 0 全量注入,分镜侧
  // 全量后系统段与规划侧同数量级,远低于上下文帽;生产调用方(useProductionPlanningActions)不传
  // opts → 自动全量,调用方零改。
  const moduleCharCap = opts.moduleCharCap ?? 0;
  const visualManual = resolveStudioManualPreset("visual", config.visualManualId, catalog);
  const directorManual = resolveStudioManualPreset("director", config.directorManualId, catalog);
  const sections: string[] = [];
  if (visualManual) {
    sections.push([
      "# 视觉手册 · 分镜表风格约束",
      buildManualSummary(visualManual, ["prefix", "director_storyboard_table_style"], moduleCharCap),
    ].join("\n"));
  }
  if (directorManual) {
    sections.push([
      "# 导演手册 · 分镜表叙事技法",
      buildManualSummary(directorManual, ["director_storyboard_table_narrative"], moduleCharCap),
    ].join("\n"));
  }
  return sections.join("\n\n");
}

export function buildStudioManualsFromSkillFiles(
  kind: Extract<StudioManualKind, "visual" | "director">,
  files: StudioManualSkillOverrideFile[],
  options: BuildStoredStudioManualsOptions = {},
): StudioManualPreset[] {
  const source = getManualSkillSource(kind);
  const moduleKeys = getManualModuleKeys(kind);
  const groupedFiles = groupManualOverrideFiles(files, source);

  return [...groupedFiles.keys()].sort().map((id) => {
    const overrides = groupedFiles.get(id) ?? new Map<string, string>();
    const modules = Object.fromEntries(moduleKeys.map((key) => {
      const relativePath = getManualModuleRelativePath(kind, key);
      return [key, overrides.get(relativePath) ?? ""];
    }));
    const images = options.imagesByManualId?.[id] ?? [];
    const moduleCount = countFilledModules(modules);

    return {
      id,
      kind,
      name: getManualName(modules.README, id),
      modules,
      images,
      builtin: false,
      source: "stored-copy",
      completenessScore: moduleCount + images.length,
      moduleCount,
      imageCount: images.length,
      basePresetId: getBasePresetId(id),
    };
  });
}

export function listAgentSkillPresets(): AgentSkillPreset[] {
  const presets: AgentSkillPreset[] = [];
  for (const [filePath, content] of Object.entries(agentSkillMarkdown)) {
    const id = getAgentSkillId(filePath);
    if (!id) continue;
    presets.push({
      id,
      kind: getAgentSkillKind(id),
      name: getAgentSkillName(content, id),
      content,
      source: "toonflow-runtime",
    });
  }
  return presets.sort((left, right) => left.id.localeCompare(right.id));
}

export function getAgentSkillPreset(id: string | undefined | null): AgentSkillPreset | null {
  if (!id) return null;
  return listAgentSkillPresets().find((item) => item.id === id) ?? null;
}

function buildManuals(
  kind: StudioManualKind,
  markdown: MarkdownMap,
  images: Record<string, string>,
  moduleKeys: readonly string[],
): StudioManualPreset[] {
  const ids = new Set<string>();
  for (const filePath of Object.keys(markdown)) {
    const id = getManualId(filePath, kind === "visual" ? "art_skills" : "story_skills");
    if (id) ids.add(id);
  }

  return [...ids].sort().map((id) => {
    const modules = Object.fromEntries(
      moduleKeys.map((key) => [key, findManualMarkdown(markdown, kind === "visual" ? "art_skills" : "story_skills", id, key)]),
    );
    const manualImages = Object.entries(images)
      .filter(([filePath]) => filePath.includes(`/${id}/images/`))
      .map(([, url]) => url);
    const moduleCount = countFilledModules(modules);
    const imageCount = manualImages.length;

    return {
      id,
      kind,
      name: getManualName(modules.README, id),
      modules,
      images: manualImages,
      builtin: true,
      source: "toonflow-runtime",
      completenessScore: moduleCount + imageCount,
      moduleCount,
      imageCount,
      basePresetId: getBasePresetId(id),
    };
  });
}

function buildProductionManuals(): StudioManualPreset[] {
  const modules = Object.fromEntries(
    productionModuleKeys.map((key) => [key, findProductionMarkdown(key)]),
  );
  return [
    {
      id: "toonflow-production",
      kind: "production",
      name: "漫影制作技法",
      modules,
      images: [],
      builtin: true,
      source: "toonflow-runtime",
      completenessScore: countFilledModules(modules),
      moduleCount: countFilledModules(modules),
      imageCount: 0,
    },
  ];
}

function findManualMarkdown(markdown: MarkdownMap, source: "art_skills" | "story_skills", id: string, key: string): string {
  const direct = `../../assets/studio-manuals/${source}/${id}/${key}.md`;
  if (markdown[direct]) return markdown[direct];

  const suffix = `/${source}/${id}/`;
  const target = `/${key}.md`;
  const found = Object.entries(markdown).find(([filePath]) => filePath.includes(suffix) && filePath.endsWith(target));
  return found?.[1] ?? "";
}

function findProductionMarkdown(key: string): string {
  return productionMarkdown[`../../assets/studio-manuals/production_skills/${key}.md`] ?? "";
}

function resolveStudioManualPreset(
  kind: StudioManualKind,
  id: string | undefined | null,
  catalog: StudioManualCatalog,
) {
  if (!id) return null;
  const manuals = catalog[kind] ?? listStudioManualPresets(kind);
  return manuals.find((item) => item.id === id) ?? null;
}

export function getManualSkillSource(kind: Extract<StudioManualKind, "visual" | "director">) {
  return kind === "visual" ? "art_skills" : "story_skills";
}

export function getManualModuleKeys(kind: Extract<StudioManualKind, "visual" | "director">) {
  return kind === "visual" ? visualModuleKeys : directorModuleKeys;
}

export function getManualModuleRelativePath(kind: Extract<StudioManualKind, "visual" | "director">, key: string) {
  const direct = key === "README" ? "README.md" : `${key}.md`;
  if (kind === "visual") {
    return findVisualModuleRelativePath(key) ?? direct;
  }
  return findDirectorModuleRelativePath(key) ?? direct;
}

function findVisualModuleRelativePath(key: string) {
  const mapping: Record<string, string> = {
    README: "README.md",
    prefix: "prefix.md",
    art_character: "art_prompt/art_character.md",
    art_character_derivative: "art_prompt/art_character_derivative.md",
    art_prop: "art_prompt/art_prop.md",
    art_prop_derivative: "art_prompt/art_prop_derivative.md",
    art_scene: "art_prompt/art_scene.md",
    art_scene_derivative: "art_prompt/art_scene_derivative.md",
    director_storyboard: "driector_skills/director_storyboard.md",
    art_storyboard_video: "art_prompt/art_storyboard_video.md",
    director_planning_style: "driector_skills/director_planning_style.md",
    director_storyboard_table_style: "driector_skills/director_storyboard_table_style.md",
  };
  return mapping[key];
}

function findDirectorModuleRelativePath(key: string) {
  const mapping: Record<string, string> = {
    README: "README.md",
    director_planning_narrative: "driector_skills/director_planning_narrative.md",
    director_storyboard_table_narrative: "driector_skills/director_storyboard_table_narrative.md",
    // R2/父 I1:剧本级规则住包根(与 README 同级)
    script_narrative: "script_narrative.md",
  };
  return mapping[key];
}

function groupManualOverrideFiles(files: StudioManualSkillOverrideFile[], source: "art_skills" | "story_skills") {
  const groups = new Map<string, Map<string, string>>();
  const prefix = `${source}/`;
  for (const file of files) {
    if (!file.relativePath.startsWith(prefix) || !file.relativePath.endsWith(".md")) continue;
    const parts = file.relativePath.slice(prefix.length).split("/");
    const id = parts.shift();
    if (!id || parts.length === 0) continue;
    const relativeModulePath = parts.join("/");
    if (!groups.has(id)) groups.set(id, new Map());
    groups.get(id)?.set(relativeModulePath, file.content);
  }
  return groups;
}

function getManualId(filePath: string, source: "art_skills" | "story_skills") {
  const match = filePath.match(new RegExp(`/studio-manuals/${source}/([^/]+)/`));
  return match?.[1] ?? null;
}

function getAgentSkillId(filePath: string) {
  const match = filePath.match(/\/studio-manuals\/([^/]+)\.md$/);
  return match?.[1] ?? null;
}

function getAgentSkillKind(id: string): AgentSkillPreset["kind"] {
  if (id.includes("supervision")) return "supervision";
  if (id.startsWith("production_")) return "production";
  return "script";
}

function getAgentSkillName(content: string, fallback: string) {
  const frontMatterName = content.match(/^---[\s\S]*?\nname:\s*([^\n]+)[\s\S]*?\n---/m)?.[1]?.trim();
  if (frontMatterName) return frontMatterName.replace(/\.md$/, "");
  return getManualName(content, fallback);
}

function getManualName(readme: string | undefined, fallback: string) {
  const firstLine = readme?.split(/\r?\n/).find((line) => line.trim());
  return firstLine?.replace(/^#+\s*/, "").replace(/--/g, "").trim() || fallback;
}

function countFilledModules(modules: Record<string, string>) {
  return Object.values(modules).filter((value) => value.trim().length > 0).length;
}

function getBasePresetId(id: string) {
  if (id === "daojie_ink_guofeng") return "2D_chinese_guofeng";
  if (id === "Daojie_xianxia") return "Xianxia_fantasy";
  return undefined;
}

function buildManualSummary(manual: StudioManualPreset, keys: string[], charCap = 4000) {
  return [
    `## ${manual.name}`,
    ...keys
      .map((key) => manual.modules[key]?.trim())
      .filter(Boolean)
      // G39:charCap≤0=不截断全量注入;缺省 4000=规划摘要口径(buildStudioManualContext,G11);
      // 分镜表上下文自 H3(10-14 裁定)起缺省 0=全量(buildStoryboardTableManualContext 传值覆盖,
      // 本参数缺省仅兜底——两调用方均显式传值,勿再据此行推断「分镜侧仍截 4000」)
      .map((value) => (charCap > 0 ? value.slice(0, charCap) : value)),
  ].join("\n\n");
}
