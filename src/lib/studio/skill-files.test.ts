import { describe, expect, it } from "vitest";
import { getStudioSkillFile, listStudioSkillFiles } from "./skill-files";

describe("studio skill file index", () => {
  it("lists editable Markdown skills from all Toonflow manual categories", () => {
    const files = listStudioSkillFiles();
    const categories = new Set(files.map((file) => file.category));

    expect(files.length).toBeGreaterThan(100);
    expect([...categories].sort()).toEqual(["agent", "director", "production", "visual"]);
    expect(files.map((file) => file.relativePath)).toContain("agent_skills/script_execution_skeleton.md");
    expect(files.map((file) => file.relativePath)).toContain("art_skills/daojie_ink_guofeng/README.md");
    expect(files.map((file) => file.relativePath)).toContain("story_skills/Daojie_xianxia/README.md");
    expect(files.map((file) => file.relativePath)).toContain("production_skills/storyboard_table_techniques.md");
  });

  it("classifies root agent skills into the agent_skills directory", () => {
    const file = getStudioSkillFile("agent_skills/script_execution_skeleton.md");

    expect(file).toMatchObject({
      category: "agent",
      relativePath: "agent_skills/script_execution_skeleton.md",
      directory: "agent_skills",
    });
    expect(file?.relativePath).not.toBe("script_execution_skeleton.md");
  });

  it("classifies nested skill files and keeps safe relative paths", () => {
    const file = getStudioSkillFile("art_skills/daojie_ink_guofeng/prefix.md");

    expect(file).toMatchObject({
      category: "visual",
      relativePath: "art_skills/daojie_ink_guofeng/prefix.md",
      directory: "art_skills/daojie_ink_guofeng",
    });
    expect(file?.title).toContain("全局美学基础");
    expect(file?.content).toContain("水墨");
    expect(file?.relativePath).not.toContain("..");
  });
});
