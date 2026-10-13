import { describe, expect, it } from "vitest";
import * as manuals from "./manuals";
import {
  buildScriptManualContext,
  buildStoryboardTableManualContext,
  buildStudioManualContext,
  EXTENDED_DIRECTOR_MANUAL_SEED_ID,
  EXTENDED_VISUAL_MANUAL_SEED_ID,
  DEFAULT_DIRECTOR_MANUAL_ID,
  DEFAULT_VISUAL_MANUAL_ID,
  getAgentSkillPreset,
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
    expect(EXTENDED_VISUAL_MANUAL_SEED_ID).toBe("daojie_ink_guofeng");
    expect(EXTENDED_DIRECTOR_MANUAL_SEED_ID).toBe("Daojie_xianxia");

    expect(getStudioManualPreset("visual", EXTENDED_VISUAL_MANUAL_SEED_ID)).toBeNull();

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
    const visualManual = visualManuals.find((manual) => manual.id === EXTENDED_VISUAL_MANUAL_SEED_ID);
    const directorManual = getStudioManualPreset("director", EXTENDED_DIRECTOR_MANUAL_SEED_ID);

    expect(visualManual).toMatchObject({
      id: "daojie_ink_guofeng",
      source: "stored-copy",
      basePresetId: "2D_chinese_guofeng",
    });
    expect(visualManual?.modules.README).toContain("水墨国风修仙");

    expect(directorManual).toMatchObject({
      id: "Daojie_xianxia",
      source: "toonflow-runtime",
      // Phase 3(父 I2 定序):v3 已建 script_narrative.md 且此处登记键 → 道劫 3→4
      moduleCount: 4,
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

  it("builds storyboard-table manual context from prefix/style/narrative modules only", () => {
    const visualManuals = buildStudioManualsFromSkillFiles("visual", [
      {
        relativePath: "art_skills/daojie_ink_guofeng/prefix.md",
        content: "# 全局美学基础\n\n工笔线描锚词",
      },
      {
        relativePath: "art_skills/daojie_ink_guofeng/driector_skills/director_storyboard_table_style.md",
        content: "# 分镜表水墨国风约束\n\n墨色层次锁定",
      },
      {
        relativePath: "art_skills/daojie_ink_guofeng/README.md",
        content: "# 道劫 README\n\n不应进入分镜表上下文",
      },
    ]);
    const directorManuals = buildStudioManualsFromSkillFiles("director", [
      {
        relativePath: "story_skills/Daojie_xianxia/driector_skills/director_storyboard_table_narrative.md",
        content: "# 分镜表叙事手法\n\n水墨远景为基础景别",
      },
    ]);

    const context = buildStoryboardTableManualContext({
      visualManualId: EXTENDED_VISUAL_MANUAL_SEED_ID,
      directorManualId: EXTENDED_DIRECTOR_MANUAL_SEED_ID,
    }, {
      visual: visualManuals,
      director: directorManuals,
    });

    expect(context).toContain("工笔线描锚词");
    expect(context).toContain("墨色层次锁定");
    expect(context).toContain("水墨远景为基础景别");
    expect(context).not.toContain("不应进入分镜表上下文");
  });

  it("returns empty storyboard-table manual context when no manual is selected", () => {
    expect(buildStoryboardTableManualContext({})).toBe("");
  });

  it("H3(10-14 裁定)：分镜上下文缺省全量不截断——>4000 字 narrative/prefix 模块尾标在场(现缺省 cap 4000 → RED)", () => {
    // G39 同款尾标判截法:周期串会使尾部串在帽内重演,故以唯一尾标判「未被截断」。
    // 基线现状:buildStoryboardTableManualContext 未传 cap → buildManualSummary 缺省 4000
    // (manuals.ts:401),道劫 narrative 17945 字等被截;10-14 裁定=该函数缺省全量(design §4,
    // 量级依据=规划阶段两调用方已传 0 全量注入),两处 buildManualSummary(prefix/style 与
    // narrative)同此。RED 判据:两侧尾标均不在场。
    const longPrefix = `${"视觉风格锚词正文。".repeat(600)}【视觉侧全量尾部标记】`;
    const longNarrative = `${"分镜叙事技法正文。".repeat(600)}【导演侧全量尾部标记】`;
    expect(longPrefix.length).toBeGreaterThan(4000);
    expect(longNarrative.length).toBeGreaterThan(4000);
    const visualManuals = buildStudioManualsFromSkillFiles("visual", [
      {
        relativePath: "art_skills/daojie_ink_guofeng/README.md",
        content: "# 本地视觉手册",
      },
      {
        relativePath: "art_skills/daojie_ink_guofeng/prefix.md",
        content: longPrefix,
      },
    ]);
    const directorManuals = buildStudioManualsFromSkillFiles("director", [
      {
        relativePath: "story_skills/Daojie_xianxia/README.md",
        content: "# 本地导演手册",
      },
      {
        relativePath: "story_skills/Daojie_xianxia/driector_skills/director_storyboard_table_narrative.md",
        content: longNarrative,
      },
    ]);

    const context = buildStoryboardTableManualContext({
      visualManualId: EXTENDED_VISUAL_MANUAL_SEED_ID,
      directorManualId: EXTENDED_DIRECTOR_MANUAL_SEED_ID,
    }, {
      visual: visualManuals,
      director: directorManuals,
    });

    expect(context).toContain("【视觉侧全量尾部标记】");
    expect(context).toContain("【导演侧全量尾部标记】");
    // 尾标在场 ⇒ 模块整段原文在场(同一函数产出,零截断等价)
    expect(context).toContain(longPrefix);
    expect(context).toContain(longNarrative);
  });

  it("buildScriptManualContext(R2/G12)：题材包含 script_narrative → 题材剧本规则节全文不截断;缺省/未选 → 空串", () => {
    const longBody = `${"道劫剧本级规则正文。"}`.repeat(500); // 5000 字 > 4000,验证不截断(G12)
    const withNarrative = buildStudioManualsFromSkillFiles("director", [
      {
        relativePath: "story_skills/Daojie_xianxia/README.md",
        content: "# 本地道劫导演手册\n\n本地导演说明",
      },
      {
        relativePath: "story_skills/Daojie_xianxia/script_narrative.md",
        content: longBody,
      },
      {
        relativePath: "story_skills/Daojie_xianxia/driector_skills/director_planning_narrative.md",
        content: "下游阶段文档,不应进入剧本上下文",
      },
    ]);

    const context = buildScriptManualContext(
      { directorManualId: EXTENDED_DIRECTOR_MANUAL_SEED_ID },
      { director: withNarrative },
    );

    expect(context).toContain("## 题材剧本规则（本地道劫导演手册）");
    expect(context).toContain(longBody); // 全文不截断(buildManualSummary 的 4000 字截断不适用)
    expect(context).not.toContain("# 视觉手册");
    expect(context).not.toContain("# 导演手册");
    expect(context).not.toContain("下游阶段文档"); // 只注 script_narrative,README/规划文档不进(G12)
    // G12 核心失败通道负向锁:README 正文不得泄入(父 G12 根因=道劫 README.md:77 音乐方向
    // 漏入剧本头部 E6)——「本地导演说明」为夹具 README 正文独有串;包名「本地道劫导演手册」
    // 经节标题合法出现,不可作负向串
    expect(context).not.toContain("本地导演说明");

    // 种子真源同验:产出必须包含种子 script_narrative 模块全文——若 buildScriptManualContext
    // 回退为注 README,产出不含 narrative 全文,此处必红。旧负向串「三族灵气」(道劫 README
    // 3 处/其 script_narrative 0 处)与 script_narrative 同题材语汇同域,真包措辞演进会假失败,
    // 故换模块全文等价锁(种子文件为打包资产不可加串,等价锁零语汇巧合且锁力更强);
    // 空串会使 toContain 恒真,先锁锚存在
    const seededNarrative =
      getStudioManualPreset("director", EXTENDED_DIRECTOR_MANUAL_SEED_ID)?.modules.script_narrative?.trim() ?? "";
    expect(seededNarrative.length).toBeGreaterThan(0);
    const seeded = buildScriptManualContext({ directorManualId: EXTENDED_DIRECTOR_MANUAL_SEED_ID });
    expect(seeded).toContain("## 题材剧本规则（道劫");
    expect(seeded).toContain(seededNarrative);

    // 存储副本缺 script_narrative 文件 → 模块空 → 返回 ""(G14 容忍缺失)
    const withoutNarrative = buildStudioManualsFromSkillFiles("director", [
      {
        relativePath: "story_skills/Daojie_xianxia/README.md",
        content: "# 本地道劫导演手册\n\n本地导演说明",
      },
    ]);
    expect(
      buildScriptManualContext(
        { directorManualId: EXTENDED_DIRECTOR_MANUAL_SEED_ID },
        { director: withoutNarrative },
      ),
    ).toBe("");
    // 未选导演包 → ""
    expect(buildScriptManualContext({})).toBe("");
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
      visualManualId: EXTENDED_VISUAL_MANUAL_SEED_ID,
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
        // 「未选注入探针串」为夹具 README 正文独有串(参照「本地导演说明」模式),
        // 与种子/题材语汇零共享——负向判别不随真包措辞演进漂移
        content: "# 水墨国风修仙\n\n未选注入探针串",
      },
    ]);
    const context = buildStudioManualContext({}, {
      visual: visualManuals,
    });

    expect(context).toContain("# 视觉手册\n未选择");
    expect(context).toContain("# 导演手册\n未选择");
    expect(context).not.toContain("水墨国风修仙");
    expect(context).not.toContain("未选注入探针串");
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

  it("G39：moduleCharCap≤0 → 超帽模块全量注入;缺省仍截 4000(口径零变化)", () => {
    // 夹具:规划叙事模块 5400 字(>4000 帽),尾部唯一标记=截断痕判别串(周期串会使尾部串
    // 在帽内重演,故以唯一尾标判截断,免假失败)
    const longBody = `${"导演规划叙事正文。".repeat(600)}【全量注入尾部标记】`;
    expect(longBody.length).toBeGreaterThan(4000);
    const tailMarker = "【全量注入尾部标记】";
    const directorManuals = buildStudioManualsFromSkillFiles("director", [
      {
        relativePath: "story_skills/Daojie_xianxia/README.md",
        content: "# 本地全量注入手册",
      },
      {
        relativePath: "story_skills/Daojie_xianxia/driector_skills/director_planning_narrative.md",
        content: longBody,
      },
    ]);
    const config = { directorManualId: EXTENDED_DIRECTOR_MANUAL_SEED_ID };

    // a) cap=0:全文注入——模块整段原文在场(长度等于原文),帽外尾标在场=未截断
    const full = buildStudioManualContext(config, { director: directorManuals }, { moduleCharCap: 0 });
    expect(full).toContain("## 本地全量注入手册");
    expect(full).toContain(longBody);
    expect(full).toContain(tailMarker);
    // cap<0 同义(≤0 皆全量)
    expect(
      buildStudioManualContext(config, { director: directorManuals }, { moduleCharCap: -1 }),
    ).toContain(tailMarker);

    // b) 缺省(不传 opts):仍截 4000——帽内前缀恰在场,帽外尾标(截断痕)消失,全文不在场
    const capped = buildStudioManualContext(config, { director: directorManuals });
    expect(capped).toContain(longBody.slice(0, 4000));
    expect(capped).not.toContain(tailMarker);
    expect(capped).not.toContain(longBody);
  });

  it("loads root Toonflow agent skill presets", () => {
    const agentExports = manuals as typeof manuals & {
      listAgentSkillPresets?: () => Array<{ id: string; kind: string; content: string; source: string }>;
      getAgentSkillPreset?: (id: string) => { id: string; kind: string; content: string; source: string } | null;
    };

    expect(agentExports.listAgentSkillPresets).toBeTypeOf("function");
    expect(agentExports.getAgentSkillPreset).toBeTypeOf("function");

    const agentSkills = agentExports.listAgentSkillPresets?.() ?? [];
    expect(agentSkills.map((item) => item.id)).toContain("script_execution_script");
    expect(agentSkills.map((item) => item.id)).toContain("production_execution_storyboard_table");
    // B+ 收口:骨架/策略文档已删(职能迁入 method_* 方法文档),不得复活
    expect(agentSkills.map((item) => item.id)).not.toContain("script_execution_skeleton");
    expect(agentSkills.map((item) => item.id)).not.toContain("script_execution_adaptation");
    expect(agentSkills.map((item) => item.id)).toContain("method_story_development");
    expect(agentSkills.map((item) => item.id)).toContain("method_screen_adaptation");

    expect(agentExports.getAgentSkillPreset?.("script_execution_script")).toMatchObject({
      kind: "script",
      source: "toonflow-runtime",
    });
    expect(agentExports.getAgentSkillPreset?.("production_execution_storyboard_table")?.content).toContain("分镜");
  });

  it("script 文本类 skill 为单次 Markdown 输出，production 工作区 skill 保留 Toonflow XML 写入契约", () => {
    const agentExports = manuals as typeof manuals & {
      getAgentSkillPreset?: (id: string) => { content: string } | null;
    };
    const markdownSkillIds = [
      "script_execution_script",
    ];

    for (const id of markdownSkillIds) {
      const content = agentExports.getAgentSkillPreset?.(id)?.content ?? "";
      expect(content, id).not.toMatch(/<storySkeleton>|<adaptationStrategy>|<scriptItem|<scriptPlan>|<storyboardTable>/);
      expect(content, id).not.toContain("自动继续");
      // 单次输出契约锚:三件 skill 措辞各异(script 为「一次性输出完整本集剧本」),共含「一次性输出」
      expect(content, id).toContain("一次性输出");
    }

    expect(
      agentExports.getAgentSkillPreset?.("production_execution_director_plan")
        ?.content,
    ).toContain("<scriptPlan>");
    expect(
      agentExports.getAgentSkillPreset?.("production_execution_storyboard_table")
        ?.content,
    ).toContain("<storyboardTable>");
    expect(
      agentExports.getAgentSkillPreset?.("production_execution_storyboard_table")
        ?.content,
    ).toContain("## 场N：场景名");
    expect(
      agentExports.getAgentSkillPreset?.("production_execution_storyboard_table")
        ?.content,
    ).toContain("引用资产ID");
  });
});

// ── riderA(D1 手册,10-13-audit4-downstream):⑥示例区 N-M 决策行锁 ──────────────
// 手册 :66 明许「Sc1、Sc2 或 Sc 1-1」双编号,但 :154 结构化示例区只示例单数写法
// ——「:66 允许 / :154 只示例单数」诱导模型产 ⑥ 全单数(解析侧 D1 已认 N-M)。
// 本锁要求示例区补 N-M 复合场号决策行,且风格词必须取词表内词(手册 :160)。
// RED:现手册无 N-M 决策行示例。改手册属 MANUALS 文件,本轮 RED 只落锁不动文件。
describe("riderA · 导演规划手册⑥示例区 N-M 决策行锁", () => {
  const STYLE_VOCAB = [
    "水墨晕染",
    "灵气色彩",
    "境界跃迁",
    "四季流转",
    "剑痕",
    "血祭",
    "梦境",
    "空镜呼吸",
    "同场景硬切",
  ];

  it("⑥ 结构化示例区含 Sc N-M 复合场号决策行,风格词取词表内词", () => {
    const content = getAgentSkillPreset("production_execution_director_plan")?.content ?? "";
    const nmLines = [
      ...content.matchAll(
        /-\s*Sc\s*\d+\s*[-－—–]\s*\d+\s*(?:→|->)\s*Sc\s*\d+\s*[-－—–]\s*\d+\s*[:：]\s*风格词\s*[:：=]\s*([^；;\n]+?)\s*[;；]\s*氛围词\s*[:：=]\s*([^\n]+)/g,
      ),
    ];
    expect(
      nmLines.length,
      "⑥ 示例区应含形如「- Sc 1-1 → Sc 1-2：风格词=…；氛围词=…」的 N-M 决策行(手册 :66 明许双编号,:154 示例区须同步)",
    ).toBeGreaterThan(0);
    for (const line of nmLines) {
      expect(
        STYLE_VOCAB,
        `示例行风格词须取词表内词:${line[0]}`,
      ).toContain((line[1] ?? "").trim());
    }
  });
});
