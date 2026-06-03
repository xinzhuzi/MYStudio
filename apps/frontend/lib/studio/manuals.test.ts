import { describe, expect, it } from "vitest";
import * as manuals from "./manuals";
import {
  buildStudioManualContext,
  DAOJIE_DIRECTOR_MANUAL_ID,
  DAOJIE_VISUAL_MANUAL_ID,
  DEFAULT_DIRECTOR_MANUAL_ID,
  DEFAULT_VISUAL_MANUAL_ID,
  getStudioManualPreset,
  buildStudioManualsFromSkillFiles,
  listStudioManualPresets,
} from "./manuals";

describe("studio manual presets", () => {
  it("loads Toonflow visual and director manuals from bundled assets", () => {
    const visualManuals = listStudioManualPresets("visual");
    const directorManuals = listStudioManualPresets("director");

    expect(visualManuals.map((item) => item.id)).toContain("2D_chinese_guofeng");
    expect(visualManuals.map((item) => item.id)).toContain("2d_ghibli");
    expect(visualManuals.map((item) => item.id)).toContain("3d_xuanhuan");
    expect(visualManuals.map((item) => item.id)).toContain("real_movie");
    expect(visualManuals.map((item) => item.id)).toContain("stop_motion");
    expect(directorManuals.map((item) => item.id)).toContain("Xianxia_fantasy");
    expect(getStudioManualPreset("visual", "2D_chinese_guofeng")?.modules.art_storyboard_video).toContain("视频提示词");
    expect(getStudioManualPreset("visual", "2d_ghibli")?.modules.art_character).toContain("正向质量锚点");
    expect(getStudioManualPreset("visual", "2d_ghibli")?.modules.art_character).toContain("反向规避提示词");
    expect(getStudioManualPreset("director", "Xianxia_fantasy")?.modules.director_planning_narrative).toContain("古风仙侠");
  });

  it("keeps Daojie visual style out of bundled presets and resolves it from stored skills", () => {
    expect(DEFAULT_VISUAL_MANUAL_ID).toBe("");
    expect(DEFAULT_DIRECTOR_MANUAL_ID).toBe("");
    expect(DAOJIE_VISUAL_MANUAL_ID).toBe("daojie_ink_guofeng");
    expect(DAOJIE_DIRECTOR_MANUAL_ID).toBe("Daojie_xianxia");

    expect(getStudioManualPreset("visual", DAOJIE_VISUAL_MANUAL_ID)).toBeNull();

    const visualManuals = buildStudioManualsFromSkillFiles("visual", [
      {
        relativePath: "art_skills/daojie_ink_guofeng/README.md",
        content: "# 水墨国风修仙\n\n三族灵气与万道归真",
      },
      {
        relativePath: "art_skills/daojie_ink_guofeng/prefix.md",
        content: "道劫专属水墨风格",
      },
    ]);
    const visualManual = visualManuals.find((manual) => manual.id === DAOJIE_VISUAL_MANUAL_ID);
    const directorManual = getStudioManualPreset("director", DAOJIE_DIRECTOR_MANUAL_ID);

    expect(visualManual).toMatchObject({
      id: "daojie_ink_guofeng",
      source: "stored-copy",
      basePresetId: "2D_chinese_guofeng",
    });
    expect(visualManual?.modules.README).toContain("水墨国风修仙");

    expect(directorManual).toMatchObject({
      id: "Daojie_xianxia",
      source: "toonflow-runtime",
      moduleCount: 3,
      imageCount: 0,
      basePresetId: "Xianxia_fantasy",
    });
    expect(directorManual?.modules.README).toContain("三族灵气");
  });

  it("builds a compact manual context for workflow prompts", () => {
    const context = buildStudioManualContext({
      visualManualId: "2D_chinese_guofeng",
      directorManualId: "Xianxia_fantasy",
    });

    expect(context).toContain("视觉手册");
    expect(context).toContain("导演手册");
    expect(context).toContain("国风二次元");
    expect(context).toContain("古风仙侠");
  });

  it("injects Daojie manual context from the stored skill catalog", () => {
    const visualManuals = buildStudioManualsFromSkillFiles("visual", [
      {
        relativePath: "art_skills/daojie_ink_guofeng/README.md",
        content: "# 水墨国风修仙\n\n三族灵气",
      },
      {
        relativePath: "art_skills/daojie_ink_guofeng/prefix.md",
        content: "万道归真",
      },
    ]);
    const context = buildStudioManualContext({
      visualManualId: DAOJIE_VISUAL_MANUAL_ID,
    }, {
      visual: visualManuals,
    });

    expect(context).toContain("水墨国风修仙");
    expect(context).toContain("三族灵气");
    expect(context).toContain("万道归真");
  });

  it("does not inject a manual when workflow config is empty", () => {
    const visualManuals = buildStudioManualsFromSkillFiles("visual", [
      {
        relativePath: "art_skills/daojie_ink_guofeng/README.md",
        content: "# 水墨国风修仙\n\n三族灵气",
      },
    ]);
    const context = buildStudioManualContext({}, {
      visual: visualManuals,
    });

    expect(context).toContain("# 视觉手册\n未选择");
    expect(context).toContain("# 导演手册\n未选择");
    expect(context).not.toContain("水墨国风修仙");
    expect(context).not.toContain("三族灵气");
  });

  it("builds workflow manuals from stored skill files without falling back to bundled modules", () => {
    const directorManuals = buildStudioManualsFromSkillFiles("director", [
      {
        relativePath: "story_skills/Daojie_xianxia/README.md",
        content: "# 本地道劫导演手册\n\n本地导演说明",
      },
      {
        relativePath: "story_skills/Daojie_xianxia/driector_skills/director_planning_narrative.md",
        content: "本地导演规划规则",
      },
    ]);
    const directorManual = directorManuals.find((manual) => manual.id === "Daojie_xianxia");

    expect(directorManual?.name).toBe("本地道劫导演手册");
    expect(directorManual?.modules.director_planning_narrative).toBe("本地导演规划规则");
    expect(directorManual?.modules.director_storyboard_table_narrative).toBe("");
    expect(directorManual?.source).toBe("stored-copy");

    const context = buildStudioManualContext({
      directorManualId: "Daojie_xianxia",
    }, {
      director: directorManuals,
    });
    expect(context).toContain("本地道劫导演手册");
    expect(context).toContain("本地导演规划规则");
    expect(context).not.toContain("三族灵气");
  });

  it("loads root Toonflow agent skill presets", () => {
    const agentExports = manuals as typeof manuals & {
      listAgentSkillPresets?: () => Array<{ id: string; kind: string; content: string; source: string }>;
      getAgentSkillPreset?: (id: string) => { id: string; kind: string; content: string; source: string } | null;
    };

    expect(agentExports.listAgentSkillPresets).toBeTypeOf("function");
    expect(agentExports.getAgentSkillPreset).toBeTypeOf("function");

    const agentSkills = agentExports.listAgentSkillPresets?.() ?? [];
    expect(agentSkills.map((item) => item.id)).toContain("script_execution_skeleton");
    expect(agentSkills.map((item) => item.id)).toContain("production_execution_storyboard_table");

    expect(agentExports.getAgentSkillPreset?.("script_execution_skeleton")).toMatchObject({
      kind: "script",
      source: "toonflow-runtime",
    });
    expect(agentExports.getAgentSkillPreset?.("production_execution_storyboard_table")?.content).toContain("分镜");
  });

  it("script/production 文本类 skill 为单次 Markdown 输出（不再 XML 增量；storyboard_panel 属结构化属性 XML、未被代码引用，不在此列）", () => {
    const agentExports = manuals as typeof manuals & {
      getAgentSkillPreset?: (id: string) => { content: string } | null;
    };
    const markdownSkillIds = [
      "script_execution_skeleton",
      "script_execution_adaptation",
      "script_execution_script",
      "production_execution_director_plan",
      "production_execution_storyboard_table",
    ];

    for (const id of markdownSkillIds) {
      const content = agentExports.getAgentSkillPreset?.(id)?.content ?? "";
      expect(content, id).not.toMatch(/<storySkeleton>|<adaptationStrategy>|<scriptItem|<scriptPlan>|<storyboardTable>/);
      expect(content, id).not.toContain("自动继续");
      expect(content, id).toContain("一次性输出全部");
    }
  });
});
