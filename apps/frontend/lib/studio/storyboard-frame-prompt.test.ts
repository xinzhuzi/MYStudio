import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildStoryboardFactionColorSection,
  buildStoryboardFramePrompt,
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
  it("prop 阵营色 = 条件注入(弱倾向):仅在明确提供道具名时出现,不凭空补齐", () => {
    const withProp = { ...faction, palette: { ...faction.palette, 万劫圣宗: { ...faction.palette.万劫圣宗, prop: "底色宣纸白+墨线浓墨+主色铁灰+辅色银灰+点睛旧金" } } };
    // 未提供道具名 → 无道具轨输出(不为三轨齐全无条件补齐)
    expect(buildStoryboardFactionColorSection(
      { sceneNames: ["金水河码头"], personNames: ["独孤剑尘"] },
      withProp,
    )).not.toContain("道具");
    // 明确提供道具名 → (阵营·道具)弱倾向配方注入
    const section = buildStoryboardFactionColorSection(
      { sceneNames: ["金水河码头"], personNames: ["独孤剑尘"], propNames: ["戒律碑"] },
      { ...withProp, members: { ...withProp.members, 戒律碑: "万劫圣宗" } },
    );
    expect(section).toContain("(万劫圣宗·道具)底色宣纸白");
    // 源码层声明条件注入政策(合同声明与实现互锁)
    const source = readFileSync(new URL("./storyboard-frame-prompt.ts", import.meta.url), "utf8");
    expect(source).toContain("prop 仅在分镜明确提供道具资产名时注入");
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
