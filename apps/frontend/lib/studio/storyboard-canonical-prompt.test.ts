import { describe, expect, it } from "vitest";
import {
  buildCanonicalSubjectSentence,
  assertCanonicalAnchors,
  buildCanonicalTransportInstruction,
  CANONICAL_TEXT_REQUIREMENT_BLOCK,
  findSubjectOverlapBlocks,
  getStoryboardBaseSubjectText,
  lintCanonicalPrompt,
  mapCanonicalReferenceSlots,
  type CanonicalIdentityParagraph,
  type CanonicalSubjectInput,
} from "./storyboard-canonical-prompt";

const IDENTITY_YANLIAO: CanonicalIdentityParagraph = {
  name: "晏燎",
  paragraph: "青年刀修晏燎，玄色劲装束袖束腰，长发高束马尾，腰束黑革刀带，佩一柄乌木鞘长刀",
  origin: "asset-override",
};

function subjectInput(partial: Partial<CanonicalSubjectInput> = {}): CanonicalSubjectInput {
  return {
    description: "晏燎拖着锁链在矿道中前行，回头看向倒地的老苦力",
    identities: [IDENTITY_YANLIAO],
    visibleCharacters: [{ name: "晏燎", position: "画面中央", actionIn: "拖链前行" }],
    visibleProps: [{ name: "铁链", position: "晏燎腕上", state: "锁链绷直" }],
    scene: { name: "灵矿坑道葬玉", location: "地下矿道", time: "夜", atmosphere: "压抑" },
    lighting: "夜色，矿灯暖光近处暖色沿岩壁晕开",
    factionColorLines: ["(人族·人物)主色赭石+辅色栗褐+点睛藤黄"],
    ...partial,
  };
}

describe("buildCanonicalSubjectSentence(t2i 五项序,07 宪法 §二)", () => {
  it("五项序就位:身份段→配器→动作→环境→光色,单段全角标点", () => {
    const { text } = buildCanonicalSubjectSentence(subjectInput());
    const identityAt = text.indexOf("青年刀修晏燎");
    const propAt = text.indexOf("铁链");
    const actionAt = text.indexOf("拖着锁链");
    const sceneAt = text.indexOf("灵矿坑道葬玉");
    const lightAt = text.indexOf("夜色");
    expect(identityAt).toBeGreaterThanOrEqual(0);
    expect(propAt).toBeGreaterThan(identityAt);
    expect(actionAt).toBeGreaterThan(propAt);
    expect(sceneAt).toBeGreaterThan(actionAt);
    expect(lightAt).toBeGreaterThan(sceneAt);
    expect(text.endsWith("。")).toBe(true);
    expect(text).not.toMatch(/\r|\n/);
    expect(text).not.toMatch(/[,.!?;:]/);
  });

  it("身份段逐字搬运(07 §三跨图同源,禁改写)", () => {
    const { text } = buildCanonicalSubjectSentence(subjectInput());
    expect(text).toContain(IDENTITY_YANLIAO.paragraph);
  });

  it("阵营色明文行逐字保留(明文设定色级,PRD §三迁移)", () => {
    const { text } = buildCanonicalSubjectSentence(subjectInput());
    expect(text).toContain("(人族·人物)主色赭石+辅色栗褐+点睛藤黄");
  });

  it("缺身份段落 identity-missing 告警(§7 槽位注:主角身份段必须搬)", () => {
    const { warnings } = buildCanonicalSubjectSentence(subjectInput({ identities: [] }));
    expect(warnings).toContain("identity-missing:晏燎");
    expect(warnings).toContain("identity-missing:all");
  });

  it("描述已点名角色不重复补语义句;未点名者按来源事实补位", () => {
    const { text } = buildCanonicalSubjectSentence(subjectInput({
      visibleCharacters: [
        { name: "晏燎" },
        { name: "赵四", position: "画面右侧", orientation: "背对镜头" },
      ],
    }));
    expect(text).toContain("赵四，位于画面右侧，背对镜头");
    // 晏燎已在 description 中点名,不再追加「位于画面中央」类语义句
    expect(text).not.toContain("晏燎，位于");
  });

  it("来源事实半角标点归一为全角(形态归一,内容逐字)", () => {
    const { text } = buildCanonicalSubjectSentence(subjectInput({
      description: "晏燎前行,回头,半角逗号",
    }));
    expect(text).toContain("晏燎前行，回头，半角逗号");
  });
});

describe("mapCanonicalReferenceSlots(§4.5 已裁槽位映射)", () => {
  const characters = [
    { title: "晏燎", imageUrl: "file://a1.png" },
    { title: "赵四", imageUrl: "file://a2.png" },
    { title: "独孤剑尘", imageUrl: "file://a3.png" },
  ];
  const scenes = [{ title: "灵矿坑道葬玉", imageUrl: "file://s1.png" }];
  const props = [{ title: "铁链", imageUrl: "file://p1.png" }];

  it("image_1=主角立绘,image_2=场景,image_3=次角色;道具不入图", () => {
    const { slots, dropped } = mapCanonicalReferenceSlots({ characters, scenes, props });
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ slot: 1, role: "character", title: "晏燎" });
    expect(slots[1]).toMatchObject({ slot: 2, role: "scene", title: "灵矿坑道葬玉" });
    expect(slots[2]).toMatchObject({ slot: 3, role: "character", title: "赵四" });
    expect(dropped).toContainEqual({ title: "铁链", reason: "prop-not-transported" });
    expect(dropped).toContainEqual({ title: "独孤剑尘", reason: "character-overflow" });
  });

  it("多帧续帧:前帧恒槽 3,第三角色让位", () => {
    const { slots } = mapCanonicalReferenceSlots({
      characters, scenes, props,
      previousFrameImageUrl: "project-file://prev.png",
    });
    expect(slots[2]).toMatchObject({ slot: 3, role: "previous-frame", imageUrl: "project-file://prev.png" });
  });

  it("无场景时次角色顶槽 2", () => {
    const { slots } = mapCanonicalReferenceSlots({ characters, scenes: [], props: [] });
    expect(slots[1]).toMatchObject({ slot: 2, role: "character", title: "赵四" });
  });

  it("无角色时场景顶槽 1(171 主参考位)", () => {
    const { slots } = mapCanonicalReferenceSlots({ characters: [], scenes, props });
    expect(slots[0]).toMatchObject({ slot: 1, role: "scene", title: "灵矿坑道葬玉" });
  });

  it("纯道具镜=零槽(t2i 路,道具走指令文字)", () => {
    const { slots, dropped } = mapCanonicalReferenceSlots({ characters: [], scenes: [], props });
    expect(slots).toHaveLength(0);
    expect(dropped).toContainEqual({ title: "铁链", reason: "prop-not-transported" });
  });

  it("槽位恒不超 3(三参考硬上限)", () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({ title: `角色${n}`, imageUrl: `file://c${n}.png` }));
    const { slots } = mapCanonicalReferenceSlots({ characters: many, scenes: [], props: [] });
    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.slot)).toEqual([1, 2, 3]);
  });
});

describe("buildCanonicalTransportInstruction(体裁路由+i2i 五段)", () => {
  it("零参考→t2i 主体句直通", () => {
    const result = buildCanonicalTransportInstruction({ subject: subjectInput(), slots: [] });
    expect(result.genre).toBe("t2i");
    expect(result.prompt).toBe(buildCanonicalSubjectSentence(subjectInput()).text);
  });

  it("N≥2→i2i 指令体:<imageN> 逐张点名+操作段+保真段在场+身份指图不描字", () => {
    const { slots } = mapCanonicalReferenceSlots({
      characters: [{ title: "晏燎", imageUrl: "file://a1.png" }],
      scenes: [{ title: "灵矿坑道葬玉", imageUrl: "file://s1.png" }],
      props: [],
    });
    const result = buildCanonicalTransportInstruction({ subject: subjectInput(), slots });
    expect(result.genre).toBe("i2i");
    // 操作动词领头(09 §四①)
    expect(result.prompt.startsWith("绘制一张全新的单格剧情画面：")).toBe(true);
    // <imageN> 分工点名(09 §二引用规范②)
    expect(result.prompt).toContain("<image1>为晏燎的身份来源");
    expect(result.prompt).toContain("<image2>为灵矿坑道葬玉的场景来源");
    // 保真段在场(段序两式硬约束)+指图不描字(身份段不重描)
    expect(result.prompt).toContain("在此基础上，完整保留<image1>中晏燎的面部身份，发型与服装配饰");
    expect(result.prompt).toContain("完整保留<image2>中灵矿坑道葬玉的环境结构与陈设");
    expect(result.prompt).not.toContain(IDENTITY_YANLIAO.paragraph);
    // 变化项仍载动作事实
    expect(result.prompt).toContain("拖着锁链");
    // 单段成文
    expect(result.prompt).not.toMatch(/\r|\n/);
  });

  it("N=1→自然指称,禁 <imageN> 标签(09 §二引用规范③)", () => {
    const result = buildCanonicalTransportInstruction({
      subject: subjectInput(),
      slots: [{ slot: 1, role: "character", title: "晏燎", imageUrl: "file://a1.png" }],
    });
    expect(result.genre).toBe("i2i");
    expect(result.prompt).not.toMatch(/<image\d+>/);
    expect(result.prompt).toContain("参考图中的晏燎为身份来源");
  });

  it("前帧槽→画面连续性承接句", () => {
    const result = buildCanonicalTransportInstruction({
      subject: subjectInput(),
      slots: [
        { slot: 1, role: "character", title: "晏燎", imageUrl: "file://a1.png" },
        { slot: 2, role: "previous-frame", title: "上一帧画面", imageUrl: "project-file://prev.png" },
      ],
    });
    expect(result.prompt).toContain("完整承接<image2>的画面连续性，人物形象与光色氛围延续上一帧");
  });

  it("自产文本过体裁断言(生成器↔断言自洽)", () => {
    const slots2 = mapCanonicalReferenceSlots({
      characters: [{ title: "晏燎", imageUrl: "file://a1.png" }],
      scenes: [{ title: "灵矿坑道葬玉", imageUrl: "file://s1.png" }],
      props: [],
    }).slots;
    const i2i = buildCanonicalTransportInstruction({ subject: subjectInput(), slots: slots2 });
    expect(lintCanonicalPrompt(i2i.prompt, "i2i", slots2.length)).toEqual([]);
    const t2i = buildCanonicalTransportInstruction({ subject: subjectInput(), slots: [] });
    expect(lintCanonicalPrompt(t2i.prompt, "t2i", 0)).toEqual([]);
  });
});

describe("lintCanonicalPrompt(§4.2 硬纪律断言)", () => {
  const clean = "晏燎拖着锁链在矿道中前行，回头看向倒地的老苦力，灵矿坑道葬玉，夜，压抑。";

  it("风格词/写实词违例(画风由底座承担,主体句禁)", () => {
    const violations = lintCanonicalPrompt(`${clean}工笔线描照亮脸和手。`, "t2i", 0);
    expect(violations).toContainEqual(expect.objectContaining({ rule: "style-word", detail: "工笔" }));
  });

  it("摄影布光术语违例(07 §八 D7)", () => {
    const violations = lintCanonicalPrompt(`${clean}色温5500K。`, "t2i", 0);
    expect(violations).toContainEqual(expect.objectContaining({ rule: "photography-lighting" }));
  });

  it("画幅/分辨率词违例(09 格式七规③)", () => {
    const violations = lintCanonicalPrompt(`${clean}16：9画幅。`, "t2i", 0);
    expect(violations).toContainEqual(expect.objectContaining({ rule: "aspect-or-resolution" }));
  });

  it("否定式违例(09 格式七规⑤;钦定【文字要求】块豁免)", () => {
    expect(lintCanonicalPrompt("画面中没有多余人物。", "t2i", 0))
      .toContainEqual(expect.objectContaining({ rule: "negation" }));
    const withBlock = `${CANONICAL_TEXT_REQUIREMENT_BLOCK}${clean}`;
    expect(lintCanonicalPrompt(withBlock, "t2i", 0))
      .not.toContainEqual(expect.objectContaining({ rule: "negation" }));
  });

  it("两可句违例(十型 §0.3 直陈确定式)", () => {
    expect(lintCanonicalPrompt("晏燎持刀或者持剑。", "t2i", 0))
      .toContainEqual(expect.objectContaining({ rule: "ambiguous-choice" }));
  });

  it("手部 L4/L5 姿势违例(十型 §0.3 姿势分级)", () => {
    expect(lintCanonicalPrompt("晏燎比出剑指手势。", "t2i", 0))
      .toContainEqual(expect.objectContaining({ rule: "hand-pose-l4-l5" }));
  });

  it("画面文字触发而缺官方块违例(07 §二A)", () => {
    expect(lintCanonicalPrompt("街边挂着招牌。", "t2i", 0))
      .toContainEqual(expect.objectContaining({ rule: "text-requirement-block" }));
    expect(lintCanonicalPrompt(`${CANONICAL_TEXT_REQUIREMENT_BLOCK}街边挂着招牌。`, "t2i", 0))
      .not.toContainEqual(expect.objectContaining({ rule: "text-requirement-block" }));
  });

  it("i2i N≥2 引用契约:缺标签/自然指称均违例(09 §二引用规范②)", () => {
    const missing = lintCanonicalPrompt("以两张图里的人物为准，绘制画面。", "i2i", 2);
    expect(missing).toContainEqual(expect.objectContaining({ rule: "image-tag-contract", detail: "缺 <image1> 标签" }));
    const natural = lintCanonicalPrompt("<image1>为晏燎，<image2>为场景，图1仅示身份。", "i2i", 2);
    expect(natural).toContainEqual(expect.objectContaining({ rule: "image-tag-contract", detail: "N≥2 禁「图1/第一张」自然指称" }));
  });

  it("单图/零参考禁 <imageN> 标签(09 §二引用规范③)", () => {
    expect(lintCanonicalPrompt("以<image1>为准绘制。", "i2i", 1))
      .toContainEqual(expect.objectContaining({ rule: "image-tag-contract" }));
    expect(lintCanonicalPrompt("以<image1>为准绘制。", "t2i", 0))
      .toContainEqual(expect.objectContaining({ rule: "image-tag-contract" }));
  });

  it("换行/半角标点违例(09 格式七规①+十型 §0.9)", () => {
    expect(lintCanonicalPrompt("第一段\n第二段", "t2i", 0))
      .toContainEqual(expect.objectContaining({ rule: "single-paragraph" }));
    expect(lintCanonicalPrompt("晏燎前行,回头。", "t2i", 0))
      .toContainEqual(expect.objectContaining({ rule: "fullwidth-punctuation" }));
  });
});

describe("findSubjectOverlapBlocks(宪法 §十预检,daojie_subject_overlap.py 同源)", () => {
  it("型底座真源装载非空(分镜剧情图 positive_text,漂移即红)", () => {
    expect(getStoryboardBaseSubjectText().length).toBeGreaterThan(600);
    expect(getStoryboardBaseSubjectText()).toContain("单格叙事画面");
  });

  it("≥10 字公共子串=重复块;短于 10 字不报", () => {
    const base = "一幅单格叙事画面，前后笔意连贯，带彩色连环画的概括造型感";
    const subject = "画面主体是一幅单格叙事画面，前后笔意连贯，事件写到动词精度。";
    const blocks = findSubjectOverlapBlocks(subject, base);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]!.size).toBeGreaterThanOrEqual(10);
    expect(findSubjectOverlapBlocks("晏燎拖着锁链前行，回头看向前方。", base)).toEqual([]);
  });

  it("子句按 [;。] 切分,<10 字子句跳过(与 python 脚本同口径)", () => {
    const base = "一二三四五六七八九十百千万亿";
    const subject = "短句；一二三四五六七八九十百千万亿照抄底座";
    const blocks = findSubjectOverlapBlocks(subject, base);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.clause).toContain("一二三四五六七八九十百千万亿照抄底座");
  });

  it("真源底座实弹:十画法句照抄会被抓", () => {
    const base = getStoryboardBaseSubjectText();
    const stolen = `${base.slice(0, 30)}，晏燎前行。`;
    expect(findSubjectOverlapBlocks(stolen, base).length).toBeGreaterThan(0);
  });

  it("底座缺席时预检降级不拦(fail-open,空串)", () => {
    expect(findSubjectOverlapBlocks("任意主体句", "")).toEqual([]);
  });
});

// ─── 1117 C2 门A:剧情锚词断言(场景名/时辰词族/主角名,缺=拒发) ──────────────

describe("assertCanonicalAnchors(1117 C2 门A)", () => {
  const anchoredPrompt = "青年刀修晏燎立于金水塾馆，两盏油灯，夜，孩童盘坐。";

  it("三锚齐备=过(空违规清单)", () => {
    expect(
      assertCanonicalAnchors(anchoredPrompt, {
        sceneName: "金水塾馆",
        timeOfDay: "夜",
        protagonist: "晏燎",
      }),
    ).toEqual([]);
  });

  it("缺场景名=拒(scene-name)", () => {
    const violations = assertCanonicalAnchors("晏燎立于夜色中", {
      sceneName: "金水塾馆",
      timeOfDay: "夜",
      protagonist: "晏燎",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ anchor: "scene-name" });
  });

  it("缺时辰=拒(time-of-day);同义词族命中=过(夜↔深夜/入夜/夜里)", () => {
    const anchors = { sceneName: "金水塾馆", timeOfDay: "夜", protagonist: "晏燎" };
    expect(assertCanonicalAnchors("晏燎立于金水塾馆白墙前。", anchors)[0]).toMatchObject({
      anchor: "time-of-day",
    });
    // 族内同义写法互认
    expect(
      assertCanonicalAnchors("晏燎立于金水塾馆，入夜后灯亮。", anchors),
    ).toEqual([]);
    expect(
      assertCanonicalAnchors("晏燎立于金水塾馆，深夜灯下。", anchors),
    ).toEqual([]);
    // 暮族:黄昏/傍晚互认
    expect(
      assertCanonicalAnchors("晏燎立于金水塾馆，黄昏灯下。", { ...anchors, timeOfDay: "暮" }),
    ).toEqual([]);
  });

  it("缺主角=拒(protagonist);零角色镜 identities 兜位=按兜位名核", () => {
    const anchors = { sceneName: "金水塾馆", timeOfDay: "夜", protagonist: "独孤剑尘" };
    expect(assertCanonicalAnchors("金水塾馆夜灯下少年盘坐。", anchors)[0]).toMatchObject({
      anchor: "protagonist",
    });
    // 零角色镜由调用方传 identities 首位兜位——锚在句中即过
    expect(assertCanonicalAnchors("独孤剑尘立于金水塾馆夜灯下。", anchors)).toEqual([]);
  });

  it("态行名命中基础名或态行名均认(S12 金水塾馆·夜内态)", () => {
    expect(
      assertCanonicalAnchors("金水塾馆两盏油灯夜。", {
        sceneName: "金水塾馆·夜内态：两盏油灯·墨板·盘坐孩童",
        timeOfDay: "夜",
        protagonist: "晏燎",
      }).filter((v) => v.anchor === "scene-name"),
    ).toEqual([]);
  });

  it("锚未解析(require 缺省全 true)=拒;调用方可按镜型关断言", () => {
    const violations = assertCanonicalAnchors("任意画面。", {});
    expect(violations.map((v) => v.anchor)).toEqual(["scene-name", "time-of-day", "protagonist"]);
    expect(assertCanonicalAnchors("任意画面。", {}, { requireProtagonist: false }).map((v) => v.anchor))
      .toEqual(["scene-name", "time-of-day"]);
  });
});

// ─── 1117 C2:B3 环境句萃取并入环境槽 / G5 形态句进动作槽尾 / S12 双写去重 ────

describe("buildCanonicalSubjectSentence 1117 C2 扩展", () => {
  it("environmentClauses 并入环境槽(殿后,在场景四要素之后)", () => {
    const { text } = buildCanonicalSubjectSentence(
      subjectInput({ environmentClauses: ["屋内两盏歪芯油灯", "墨板是拿门板刷了一层墨汁凑的"] }),
    );
    expect(text).toContain("屋内两盏歪芯油灯");
    expect(text).toContain("墨板是拿门板刷了一层墨汁凑的");
    expect(text.indexOf("屋内两盏歪芯油灯")).toBeGreaterThan(text.indexOf("灵矿坑道葬玉"));
  });

  it("derivedStateNotes 进动作槽尾(G5 衍生行缺席文字承载;身份段不改写)", () => {
    const { text } = buildCanonicalSubjectSentence(
      subjectInput({ derivedStateNotes: ["「晏燎·夜课少年」:灰布短褐袖口短一截、露趾草鞋冻疮"] }),
    );
    // 形态句经全角归一(半角冒号→全角),词面逐字保留
    expect(text).toContain("「晏燎·夜课少年」：灰布短褐袖口短一截、露趾草鞋冻疮");
    // 动作槽尾=在环境槽(灵矿坑道葬玉)之前
    expect(text.indexOf("夜课少年")).toBeGreaterThan(text.indexOf("拖着锁链"));
    expect(text.indexOf("夜课少年")).toBeLessThan(text.indexOf("灵矿坑道葬玉"));
    expect(text).toContain(IDENTITY_YANLIAO.paragraph);
  });

  it("sceneText 同段去重(S12 晏燎静室×2 实录修)", () => {
    const { text } = buildCanonicalSubjectSentence(
      subjectInput({ scene: { name: "晏燎静室", location: "晏燎静室", time: "夜" } }),
    );
    expect(text.match(/晏燎静室/g)).toHaveLength(1);
  });

  it("环境槽全源去重:场景四要素与萃取句重复只入一次", () => {
    const { text } = buildCanonicalSubjectSentence(
      subjectInput({ environmentClauses: ["夜"], lighting: undefined, factionColorLines: [] }),
    );
    // scene.time=夜 与萃取句「夜」重复——环境槽内只一次
    expect(text.match(/夜/g)?.length).toBe(1);
  });
});
