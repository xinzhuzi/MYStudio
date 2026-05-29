import { describe, expect, it } from "vitest";
import { getStudioSkillFile, listStudioSkillFiles } from "./skill-files";

describe("studio skill file index", () => {
  it("lists editable Markdown skills from all Toonflow manual categories", () => {
    const files = listStudioSkillFiles();
    const categories = new Set(files.map((file) => file.category));

    expect(files.length).toBeGreaterThan(140);
    expect([...categories].sort()).toEqual(["agent", "director", "production", "visual"]);
    expect(files.map((file) => file.relativePath)).toContain("agent_skills/script_execution_skeleton.md");
    expect(files.map((file) => file.relativePath)).toContain("art_skills/2D_chinese_guofeng/README.md");
    expect(files.map((file) => file.relativePath)).toContain("art_skills/2d_ghibli/README.md");
    expect(files.map((file) => file.relativePath)).not.toContain("art_skills/daojie_ink_guofeng/README.md");
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
    const file = getStudioSkillFile("art_skills/2D_chinese_guofeng/prefix.md");

    expect(file).toMatchObject({
      category: "visual",
      relativePath: "art_skills/2D_chinese_guofeng/prefix.md",
      directory: "art_skills/2D_chinese_guofeng",
    });
    expect(file?.title).toContain("全局美学基础");
    expect(file?.content).toContain("国风");
    expect(file?.relativePath).not.toContain("..");
  });

  it("keeps bundled visual skill text generic instead of naming specific works or studios", () => {
    const forbiddenTerms = [
      "Disney",
      "Pixar",
      "Ghibli",
      "Miyazaki",
      "Doraemon",
      "Dragon Ball",
      "Jojo",
      "Akira Toriyama",
      "Cartoon Network",
      "Genshin",
      "Guilty Gear",
      "Minecraft",
      "Sailor Moon",
      "Cuphead",
      "MAPPA",
      "Marvel/DC",
      "DC comic",
      "Junji Ito",
      "新海诚",
      "吉卜力",
      "宫崎骏",
      "鸟山明",
      "龙珠",
      "哆啦",
      "原神",
      "罪恶装备",
      "我的世界",
    ];
    const visualSkillContent = listStudioSkillFiles()
      .filter((file) => file.category === "visual")
      .map((file) => file.content)
      .join("\n");

    for (const term of forbiddenTerms) {
      expect(visualSkillContent, term).not.toContain(term);
    }
  });
});
