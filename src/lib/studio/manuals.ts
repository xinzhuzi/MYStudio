import type { AgentSkillPreset, StudioManualKind, StudioManualPreset, StudioWorkflowConfig } from "@/types/studio";

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
  "/src/assets/studio-manuals/art_skills/**/*.md",
  "!/src/assets/studio-manuals/art_skills/daojie_ink_guofeng/**",
], {
  eager: true,
  query: "?raw",
  import: "default",
}) as MarkdownMap;

const directorMarkdown = import.meta.glob("/src/assets/studio-manuals/story_skills/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as MarkdownMap;

const productionMarkdown = import.meta.glob("/src/assets/studio-manuals/production_skills/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as MarkdownMap;

const agentSkillMarkdown = import.meta.glob("/src/assets/studio-manuals/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as MarkdownMap;

const visualImages = import.meta.glob([
  "/src/assets/studio-manuals/art_skills/**/*.{png,jpg,jpeg,webp,gif,svg}",
  "!/src/assets/studio-manuals/art_skills/daojie_ink_guofeng/**",
], {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const directorImages = import.meta.glob("/src/assets/studio-manuals/story_skills/**/*.{png,jpg,jpeg,webp,gif,svg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

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
] as const;

const productionModuleKeys = [
  "storyboard_prompt_techniques",
  "storyboard_table_techniques",
] as const;

export const DAOJIE_VISUAL_MANUAL_ID = "daojie_ink_guofeng";
export const DAOJIE_DIRECTOR_MANUAL_ID = "Daojie_xianxia";
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

export function buildStudioManualContext(
  config: Partial<StudioWorkflowConfig>,
  catalog: StudioManualCatalog = {},
): string {
  const visualManual = resolveStudioManualPreset("visual", config.visualManualId, catalog);
  const directorManual = resolveStudioManualPreset("director", config.directorManualId, catalog);

  return [
    "# 视觉手册",
    visualManual ? buildManualSummary(visualManual, ["README", "prefix", "director_planning_style", "art_storyboard_video"]) : "未选择",
    "",
    "# 导演手册",
    directorManual ? buildManualSummary(directorManual, ["README", "director_planning_narrative", "director_storyboard_table_narrative"]) : "未选择",
  ].join("\n");
}

export function getManualModuleText(kind: StudioManualKind, id: string | undefined | null, moduleKey: string): string {
  return getStudioManualPreset(kind, id)?.modules[moduleKey] ?? "";
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
  const direct = `/src/assets/studio-manuals/${source}/${id}/${key}.md`;
  if (markdown[direct]) return markdown[direct];

  const suffix = `/${source}/${id}/`;
  const target = `/${key}.md`;
  const found = Object.entries(markdown).find(([filePath]) => filePath.includes(suffix) && filePath.endsWith(target));
  return found?.[1] ?? "";
}

function findProductionMarkdown(key: string): string {
  return productionMarkdown[`/src/assets/studio-manuals/production_skills/${key}.md`] ?? "";
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

function getManualSkillSource(kind: Extract<StudioManualKind, "visual" | "director">) {
  return kind === "visual" ? "art_skills" : "story_skills";
}

function getManualModuleKeys(kind: Extract<StudioManualKind, "visual" | "director">) {
  return kind === "visual" ? visualModuleKeys : directorModuleKeys;
}

function getManualModuleRelativePath(kind: Extract<StudioManualKind, "visual" | "director">, key: string) {
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

function buildManualSummary(manual: StudioManualPreset, keys: string[]) {
  return [
    `## ${manual.name}`,
    ...keys
      .map((key) => manual.modules[key]?.trim())
      .filter(Boolean)
      .map((value) => value.slice(0, 4000)),
  ].join("\n\n");
}
