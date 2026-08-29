import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adaptTemplateBriefToCastCount,
  adaptTemplateBriefToShotMotion,
  buildShotColorMoodLine,
  buildStoryboardFactionColorSection,
  buildStoryboardFramePrompt,
  chapterFactionTemperature,
  classifyFactionPaletteTemperature,
  dominantChapterFaction,
  filterVoiceoverDialogue,
  parseStoryboardFrameTemplates,
  selectStoryboardFrameTemplate,
} from "./storyboard-frame-prompt";

const MANUAL_SAMPLE = [
  "## 成片模板速查（按用途只选 1 个，骨架要点版）",
  "### 02. 青绿山水长卷人物",
  "适用：山川全境、行旅长卷。要点：远景层叠；画幅 16:9 横卷。",
  "",
  "### 07. 国风漫剧电影帧",
  "适用：通用剧情帧。要点：主体明确，背景三层；画幅 16:9。",
  "",
  "### 21. 水墨战斗瞬间",
  "适用：动作图、技能击中、漫剧高潮。要点：劈斩动作方向明确重心真实；画幅 16:9 动态中景。",
  "",
  "### 26. 双人对话电影帧",
  "适用：谈判、冲突、师徒、对峙。要点：只有角色 A 与 B；眼神方向和手部动作说明关系张力；画幅 16:9 双人中景。",
  "",
  "### 31. 水墨灵气特写",
  "适用：灵气、经脉、丹田。要点：淡彩灵气沿经脉；画幅 16:9 特写。",
  "",
  "## 提示词质量增强",
  "后续内容不应进入模板。",
].join("\n");

describe("storyboard frame template parsing", () => {
  it("parses ### NN. sections with brief paragraphs only", () => {
    const templates = parseStoryboardFrameTemplates(MANUAL_SAMPLE);
    expect(templates.map(({ id }) => id)).toEqual(["02", "07", "21", "26", "31"]);
    expect(templates[0]).toMatchObject({ id: "02", title: "青绿山水长卷人物" });
    expect(templates[0]!.brief).toContain("远景层叠");
    expect(templates[4]!.brief).toContain("淡彩灵气");
  });

  it("returns empty for content without template headings (fail-empty)", () => {
    expect(parseStoryboardFrameTemplates("## 别的章节\n正文")).toEqual([]);
  });
});

describe("storyboard frame template selection", () => {
  const templates = parseStoryboardFrameTemplates(MANUAL_SAMPLE);

  it("routes combat/spirit/dialogue cues to their templates", () => {
    expect(selectStoryboardFrameTemplate("皮鞭劈落，剑光交击", templates)?.id).toBe("21");
    expect(selectStoryboardFrameTemplate("丹田灵气沿经脉流转", templates)?.id).toBe("31");
    expect(selectStoryboardFrameTemplate("画面静止\n赵四：都给我快些！", templates)?.id).toBe("26");
  });

  it("falls back to the generic cinema-frame template 07", () => {
    expect(selectStoryboardFrameTemplate("船桩压住前景，铁链横穿石板", templates)?.id).toBe("07");
    expect(selectStoryboardFrameTemplate("任意", [])).toBeNull();
  });
});

describe("storyboard frame prompt assembly", () => {
  const templates = parseStoryboardFrameTemplates(MANUAL_SAMPLE);

  it("assembles structured body with scene and composition sections", () => {
    const prompt = buildStoryboardFramePrompt({
      description: "船桩压住前景，铁链横穿石板；矿奴弯腰搬动藤筐。",
      lines: "旁白：铁链一节接一节。",
      template: selectStoryboardFrameTemplate("船桩压住前景，铁链横穿石板", templates),
    });
    expect(prompt).toContain("【画面】船桩压住前景");
    expect(prompt).toContain("【构图】适用：通用剧情帧");
    expect(prompt).toContain("【台词语境】旁白：铁链一节接一节");
  });

  it("degrades to the bare description without a template", () => {
    expect(buildStoryboardFramePrompt({
      description: "矿场远景。",
      template: null,
    })).toBe("矿场远景。");
  });
});

describe("storyboard faction color section", () => {
  const faction = {
    members: { 独孤剑尘: "万劫圣宗", 晏燎: "万劫圣宗", 金水河码头: "人族", 赵四: "人族" },
    palette: {
      万劫圣宗: { person: "底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛旧金", scene: "底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛银灰" },
      人族: { person: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛朱红", scene: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄" },
    },
  };

  it("maps scene and person names to their faction tracks", () => {
    const section = buildStoryboardFactionColorSection(
      { sceneNames: ["金水河码头"], personNames: ["独孤剑尘"] },
      faction,
    );
    expect(section).toContain("(万劫圣宗·人物)底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛旧金");
    expect(section).toContain("(人族·场景)底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄");
    expect(section.startsWith("【色彩】阵营色彩职责")).toBe(true);
  });

  it("returns empty for unknown names or empty data (fail-empty)", () => {
    expect(buildStoryboardFactionColorSection({ sceneNames: ["无名之地"] }, faction)).toBe("");
    expect(buildStoryboardFactionColorSection({ personNames: ["独孤剑尘"] }, { members: {}, palette: {} })).toBe("");
  });
  it("defaults prop faction color to not_applicable and only injects for explicit applicable prop-focused input", () => {
    const withProp = { ...faction, palette: { ...faction.palette, 万劫圣宗: { ...faction.palette.万劫圣宗, prop: "底色宣纸白+墨线浓墨+主色铁灰+辅色银灰+点睛旧金" } } };
    // 未提供道具名 → 无道具轨输出(不为三轨齐全无条件补齐)
    expect(buildStoryboardFactionColorSection(
      { sceneNames: ["金水河码头"], personNames: ["独孤剑尘"] },
      withProp,
    )).not.toContain("道具");
    // 仅有道具名仍是默认 not_applicable；不得因参考资产存在就自动开启 prop 色。
    expect(buildStoryboardFactionColorSection(
      { propNames: ["戒律碑"] },
      { ...withProp, members: { ...withProp.members, 戒律碑: "万劫圣宗" } },
    )).not.toContain("道具");
    // 明确的 prop-focused + applicable 规则才允许注入。(阵营·道具)为弱倾向配方。
    const section = buildStoryboardFactionColorSection(
      {
        sceneNames: ["金水河码头"],
        personNames: ["独孤剑尘"],
        propNames: ["戒律碑"],
        propFactionColorApplicability: "applicable",
        propFocus: true,
      },
      { ...withProp, members: { ...withProp.members, 戒律碑: "万劫圣宗" } },
    );
    expect(section).toContain("(万劫圣宗·道具)底色宣纸白");
    // 源码层声明条件注入政策(合同声明与实现互锁)
    const source = readFileSync(new URL("./storyboard-frame-prompt.ts", import.meta.url), "utf8");
    expect(source).toContain("not_applicable");
  });

  it("feeds the color section into the frame prompt between composition and dialogue", () => {
    const templates = parseStoryboardFrameTemplates(MANUAL_SAMPLE);
    const prompt = buildStoryboardFramePrompt({
      description: "剑尘立于码头。",
      lines: "独孤剑尘OS：归元，为谁而鸣？",
      template: selectStoryboardFrameTemplate("剑尘立于码头。", templates),
      colorSection: buildStoryboardFactionColorSection({ personNames: ["独孤剑尘"] }, faction),
    });
    expect(prompt.indexOf("【构图】")).toBeLessThan(prompt.indexOf("【色彩】"));
    expect(prompt.indexOf("【色彩】")).toBeLessThan(prompt.indexOf("【台词语境】"));
  });
});

describe("adaptTemplateBriefToCastCount (R18 构图人物数自适应)", () => {
  const BRIEF = "适用：谈判、冲突、师徒、对峙。要点：只有角色 A 与 B；明确前后或左右关系；工笔线描照亮脸和手。画幅 16:9 双人中景。";

  it("n=1:双人约束改单人,双人中景改单人中景", () => {
    const out = adaptTemplateBriefToCastCount(BRIEF, ["独孤剑尘"]);
    expect(out).toContain("只有独孤剑尘一人");
    expect(out).toContain("单人中景");
    expect(out).not.toContain("只有角色 A 与 B");
    expect(out).not.toContain("双人中景");
  });

  it("n=2或缺省:原样返回(fail-safe)", () => {
    expect(adaptTemplateBriefToCastCount(BRIEF, ["独孤剑尘", "管事"])).toBe(BRIEF);
    expect(adaptTemplateBriefToCastCount(BRIEF)).toBe(BRIEF);
    expect(adaptTemplateBriefToCastCount(BRIEF, [])).toBe(BRIEF);
  });

  it("n=3:列名+三人中景", () => {
    const out = adaptTemplateBriefToCastCount(BRIEF, ["独孤剑尘", "女孩", "男孩"]);
    expect(out).toContain("独孤剑尘、女孩、男孩共3名角色同框");
    expect(out).toContain("3人中景");
  });

  it("n>4:前4名+「等」", () => {
    const out = adaptTemplateBriefToCastCount(BRIEF, ["甲", "乙", "丙", "丁", "戊"]);
    expect(out).toContain("甲、乙、丙、丁等共5名角色同框");
    expect(out).toContain("5人中景");
  });

  it("无双人条款的模板原样返回(幂等)", () => {
    const plain = "适用：山川全境。要点：远景层叠；画幅 16:9 横卷。";
    expect(adaptTemplateBriefToCastCount(plain, ["独孤剑尘"])).toBe(plain);
  });

  it("buildStoryboardFramePrompt 接线:castNames 传导到【构图】段", () => {
    const templates = parseStoryboardFrameTemplates(MANUAL_SAMPLE);
    const dialogue = templates.find((t) => t.id === "26") ?? templates[0]!;
    const prompt = buildStoryboardFramePrompt({
      description: "独孤握拳松拳",
      template: { ...dialogue, brief: BRIEF },
      castNames: ["独孤剑尘"],
    });
    expect(prompt).toContain("只有独孤剑尘一人");
  });
});

describe("buildShotColorMoodLine (08-28 两套色彩系统衔接)", () => {
  const faction = {
    members: { 独孤剑尘: "万劫圣宗", 晏燎: "万劫圣宗", 金水河码头: "人族", 赵四: "人族", 管事: "人族", 李先生: "人族" },
    palette: {
      万劫圣宗: { person: "底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛旧金", scene: "底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛银灰" },
      人族: { person: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛朱红", scene: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄" },
    },
  };

  it("人物轨=visibleCharacterNames;assetNames 中的角色名不重复进场景轨", () => {
    const line = buildShotColorMoodLine(
      { assetNames: ["金水河码头", "独孤剑尘"], visibleCharacterNames: ["独孤剑尘"] },
      faction,
    );
    expect(line).toContain("(万劫圣宗·人物)主色铁灰+辅色烟紫+点睛旧金");
    expect(line).toContain("(人族·场景)主色赭石+辅色栗褐+点睛藤黄");
    // 紧凑三职责:底色/墨线零区分度不进锚(08-28 蓝图紧凑口径)
    expect(line).not.toContain("底色");
    expect(line).not.toContain("墨线");
    // 紧凑串不带【色彩】段头
    expect(line.startsWith("【色彩】")).toBe(false);
  });

  it("复合名按分号拆段:人物段的分段同时挡掉 assetNames 同名段(互斥)", () => {
    const line = buildShotColorMoodLine(
      { assetNames: ["金水河码头;管事"], visibleCharacterNames: ["李先生;管事"] },
      faction,
    );
    expect(line).toContain("(人族·人物)");
    // 「管事」已按人物轨命中,复合场景名里的同名段不得再走场景轨
    expect(line).not.toContain("(人族·场景)");
  });

  it("纯场景(无可见角色)只出场景轨", () => {
    expect(buildShotColorMoodLine({ assetNames: ["金水河码头"] }, faction))
      .toBe("(人族·场景)主色赭石+辅色栗褐+点睛藤黄");
  });

  it("无命中/数据未预热 → 空串(fail-empty,prompt 零变化)", () => {
    expect(buildShotColorMoodLine({ assetNames: ["无名之地"] }, faction)).toBe("");
    expect(buildShotColorMoodLine(
      { assetNames: ["金水河码头"], visibleCharacterNames: ["独孤剑尘"] },
      { members: {}, palette: {} },
    )).toBe("");
  });
});

describe("classifyFactionPaletteTemperature (温感关键词投票)", () => {
  it("人族盘(主色赭石+点睛藤黄/朱红)=warm", () => {
    expect(classifyFactionPaletteTemperature([
      "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛朱红",
      "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄",
    ])).toBe("warm");
  });

  it("冷词盘(靛蓝/黛青/碧)=cool", () => {
    expect(classifyFactionPaletteTemperature([
      "底色雪灰+墨线浓墨+主色靛蓝+辅色烟紫+点睛石青",
      "底色雪灰+墨线浓墨+主色黛青+辅色天青+点睛碧",
    ])).toBe("cool");
  });

  it("万劫圣宗新盘(靛蓝+朱砂+石青+赭石 各半)=neutral(平票)", () => {
    expect(classifyFactionPaletteTemperature([
      "底色雪灰+墨线浓墨+主色靛蓝+辅色烟紫+点睛朱砂",
      "底色雪灰+墨线浓墨+主色石青+辅色黛蓝+点睛赭石",
    ])).toBe("neutral");
  });

  it("零票(灰/紫/黑白不计)=neutral;辅色段不参与投票", () => {
    expect(classifyFactionPaletteTemperature(["底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛银灰"])).toBe("neutral");
    // 辅色烟紫不计票;主色靛蓝单票即 cool
    expect(classifyFactionPaletteTemperature(["主色靛蓝+辅色藤黄"])).toBe("cool");
  });
});

describe("dominantChapterFaction / chapterFactionTemperature", () => {
  const faction = {
    members: { 独孤剑尘: "万劫圣宗", 金水河码头: "人族", 赵四: "人族" },
    palette: {
      万劫圣宗: { person: "底色雪灰+墨线浓墨+主色靛蓝+辅色烟紫+点睛朱砂", scene: "底色雪灰+墨线浓墨+主色石青+辅色黛蓝+点睛赭石" },
      人族: { person: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛朱红", scene: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄" },
    },
  };

  it("主导阵营=逐镜命中阵营的众数(每镜每阵营至多一票)", () => {
    const shots = [
      { associateAssetsNames: ["金水河码头", "赵四"] },
      { associateAssetsNames: ["金水河码头"] },
      { associateAssetsNames: ["独孤剑尘"] },
    ];
    expect(dominantChapterFaction(shots, faction)).toBe("人族");
  });

  it("无分镜/无命中 → undefined(fail-safe)", () => {
    expect(dominantChapterFaction([], faction)).toBeUndefined();
    expect(dominantChapterFaction([{ associateAssetsNames: ["无名之地"] }], faction)).toBeUndefined();
  });

  it("人族主导章温感=warm;万劫圣宗新盘主导(平票)=neutral", () => {
    expect(chapterFactionTemperature(
      [{ associateAssetsNames: ["金水河码头"] }, { associateAssetsNames: ["金水河码头", "赵四"] }],
      faction,
    )).toEqual({ faction: "人族", temperature: "warm" });
    expect(chapterFactionTemperature(
      [{ associateAssetsNames: ["独孤剑尘"] }, { associateAssetsNames: ["独孤剑尘"] }],
      faction,
    )).toEqual({ faction: "万劫圣宗", temperature: "neutral" });
  });

  it("数据未预热 → neutral 不带阵营(永不误报)", () => {
    expect(chapterFactionTemperature(
      [{ associateAssetsNames: ["金水河码头"] }],
      { members: {}, palette: {} },
    )).toEqual({ temperature: "neutral" });
  });
});

describe("adaptTemplateBriefToShotMotion (S04 行进镜根修)", () => {
  const DUAL = "适用：谈判、冲突、师徒、对峙。要点：只有角色 A 与 B；明确前后或左右关系，眼神方向和手部动作说明关系张力；工笔线描照亮脸和手。画幅 16:9 双人中景。";
  it("行进文本:对峙域改行进域,张力句改行进姿态", () => {
    const out = adaptTemplateBriefToShotMotion(DUAL, "独孤沿街向右行走，藤筐从旁擦过");
    expect(out).toContain("适用：行进途中、擦肩而过。");
    expect(out).toContain("人物保持行进姿态与身体朝向");
    expect(out).not.toContain("对峙");
  });
  it("非行进文本:原样返回(幂等)", () => {
    expect(adaptTemplateBriefToShotMotion(DUAL, "两人隔桌对坐交谈")).toBe(DUAL);
  });
});

describe("filterVoiceoverDialogue (画外音过滤)", () => {
  it("OS/V.S. 被滤除,画面内台词与旁白保留", () => {
    const out = filterVoiceoverDialogue("OS（独孤剑尘，克制）：不是每一鞭，都值得我拔剑。<br>管事：半个时辰。");
    expect(out).toBe("管事：半个时辰。");
  });
  it("旁白保留(氛围价值),V.S. 滤除", () => {
    const out = filterVoiceoverDialogue("旁白：铁链从码头进入街巷。<br>宗门弟子（V.S.）：明年矿供，还能翻倍。");
    expect(out).toBe("旁白：铁链从码头进入街巷。");
  });
  it("无冒号段落原样保留", () => {
    expect(filterVoiceoverDialogue("啊！")).toBe("啊！");
  });
});
