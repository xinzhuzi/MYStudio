// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
export type StudioSkillFileCategory = "agent" | "visual" | "director" | "production" | "other";

export interface StudioSkillFile {
  id: string;
  relativePath: string;
  directory: string;
  filename: string;
  title: string;
  category: StudioSkillFileCategory;
  content: string;
}

export const STUDIO_SKILL_CATEGORY_LABELS: Record<StudioSkillFileCategory, string> = {
  agent: "Agent 技能",
  visual: "视觉风格",
  director: "导演风格",
  production: "制作技法",
  other: "其他",
};

const skillMarkdown = import.meta.glob([
  "/src/assets/studio-manuals/**/*.md",
  "!/src/assets/studio-manuals/art_skills/daojie_ink_guofeng/**",
], {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const categoryOrder: StudioSkillFileCategory[] = ["agent", "visual", "director", "production", "other"];

export function listStudioSkillFiles(): StudioSkillFile[] {
  return Object.entries(skillMarkdown)
    .map(([filePath, content]) => {
      const relativePath = getStudioSkillRelativePath(filePath);
      const filename = relativePath.split("/").at(-1) ?? relativePath;
      const directory = relativePath.includes("/") ? relativePath.split("/").slice(0, -1).join("/") : "根级技能";
      return {
        id: relativePath,
        relativePath,
        directory,
        filename,
        title: getStudioSkillTitle(content, filename),
        category: getStudioSkillCategory(relativePath),
        content,
      };
    })
    .sort((left, right) => {
      const categoryDelta = categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category);
      if (categoryDelta !== 0) return categoryDelta;
      return left.relativePath.localeCompare(right.relativePath);
    });
}

export function getStudioSkillFile(relativePath: string | undefined | null): StudioSkillFile | null {
  if (!relativePath) return null;
  return listStudioSkillFiles().find((file) => file.relativePath === relativePath) ?? null;
}

export function getStudioSkillCategory(relativePath: string): StudioSkillFileCategory {
  if (relativePath.startsWith("agent_skills/")) return "agent";
  if (relativePath.startsWith("art_skills/")) return "visual";
  if (relativePath.startsWith("story_skills/")) return "director";
  if (relativePath.startsWith("production_skills/")) return "production";
  if (!relativePath.includes("/")) return "agent";
  return "other";
}

function getStudioSkillRelativePath(filePath: string) {
  const relativePath = filePath.replace(/^.*\/studio-manuals\//, "").replace(/\\/g, "/");
  if (!relativePath.includes("/") && relativePath.endsWith(".md")) {
    return `agent_skills/${relativePath}`;
  }
  return relativePath;
}

function getStudioSkillTitle(content: string, fallback: string) {
  const frontMatterName = content.match(/^---[\s\S]*?\nname:\s*([^\n]+)[\s\S]*?\n---/m)?.[1]?.trim();
  if (frontMatterName) return cleanTitle(frontMatterName);

  const body = content.replace(/^---[\s\S]*?\n---\s*/, "");
  const firstLine = body.split(/\r?\n/).find((line) => line.trim());
  return cleanTitle(firstLine ?? fallback);
}

function cleanTitle(value: string) {
  return value
    .replace(/^#+\s*/, "")
    .replace(/\.md$/, "")
    .replace(/--/g, "")
    .trim();
}
