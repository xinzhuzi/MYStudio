import { describe, expect, it } from "vitest";
import * as manuals from "./manuals";
import {
  buildStudioManualContext,
  DEFAULT_DIRECTOR_MANUAL_ID,
  DEFAULT_VISUAL_MANUAL_ID,
  getStudioManualPreset,
  listStudioManualPresets,
} from "./manuals";

describe("studio manual presets", () => {
  it("loads Toonflow visual and director manuals from bundled assets", () => {
    const visualManuals = listStudioManualPresets("visual");
    const directorManuals = listStudioManualPresets("director");

    expect(visualManuals.map((item) => item.id)).toContain("2D_chinese_guofeng");
    expect(directorManuals.map((item) => item.id)).toContain("Xianxia_fantasy");
    expect(getStudioManualPreset("visual", "2D_chinese_guofeng")?.modules.art_storyboard_video).toContain("视频提示词");
    expect(getStudioManualPreset("director", "Xianxia_fantasy")?.modules.director_planning_narrative).toContain("古风仙侠");
  });

  it("defaults to Daojie runtime visual and director manuals", () => {
    expect(DEFAULT_VISUAL_MANUAL_ID).toBe("daojie_ink_guofeng");
    expect(DEFAULT_DIRECTOR_MANUAL_ID).toBe("Daojie_xianxia");

    const visualManual = getStudioManualPreset("visual", DEFAULT_VISUAL_MANUAL_ID);
    const directorManual = getStudioManualPreset("director", DEFAULT_DIRECTOR_MANUAL_ID);

    expect(visualManual).toMatchObject({
      id: "daojie_ink_guofeng",
      source: "toonflow-runtime",
      moduleCount: 12,
      imageCount: 1,
      basePresetId: "2D_chinese_guofeng",
    });
    expect(visualManual?.completenessScore).toBeGreaterThanOrEqual(13);
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

  it("injects Daojie manual context by default", () => {
    const context = buildStudioManualContext({});

    expect(context).toContain("水墨国风修仙");
    expect(context).toContain("三族灵气");
    expect(context).toContain("万道归真");
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

  it("keeps long-running agent skills incremental instead of single-shot XML output", () => {
    const agentExports = manuals as typeof manuals & {
      getAgentSkillPreset?: (id: string) => { content: string } | null;
    };
    const incrementalSkillIds = [
      "script_execution_skeleton",
      "script_execution_adaptation",
      "script_execution_script",
      "production_execution_director_plan",
      "production_execution_storyboard_panel",
      "production_execution_storyboard_table",
    ];

    for (const id of incrementalSkillIds) {
      const content = agentExports.getAgentSkillPreset?.(id)?.content ?? "";
      expect(content, id).not.toContain("一次性完整输出");
      expect(content, id).not.toContain("禁止拆分为多次 XML 输出");
      expect(content, id).toContain("自动继续");
    }
  });
});
