import { describe, expect, it } from "vitest";
import {
  REQUIRED_DIRECTOR_PLAN_SECTIONS,
  auditDirectorPlanStructure,
  buildDirectorPlanRepairUserMessage,
  buildDirectorPlanMessages,
  parseDirectorPlan,
  detectLightingTerms,
  stripLightingTerms,
} from "./director-plan";

describe("studio director plan — lighting separation (§2.4)", () => {
  it("detects and strips light/color-temperature words", () => {
    const text = "中景正反打，暖光从逆光方向打来，色温偏冷，人物靠向椅背";
    const found = detectLightingTerms(text);
    expect(found).toContain("暖光");
    expect(found).toContain("逆光");
    expect(found).toContain("色温");

    const cleaned = stripLightingTerms(text);
    expect(cleaned).not.toMatch(/暖光|逆光|色温/);
    expect(cleaned).toContain("中景正反打");
    expect(cleaned).toContain("靠向椅背");
  });
});

describe("studio director plan parsing", () => {
  it("rejects weak three-block Toonflow-style plans in the generation audit", () => {
    const output = [
      "<scriptPlan>",
      "### 分场汇总表（核心）",
      "| 场次 | 场景名 | 台词条数 | 台词字数 | 情绪浓度 | 情绪基调（含 X→Y） |",
      "|---|---|---|---|---|---|",
      "| Sc1 | 金水河码头 | 4 | 38 | 8 | 压迫→隐忍 |",
      "### 逐场注意事项",
      "- **Sc1**：情感砸点：鞭梢将落未落。",
      "### 场间过渡",
      "| 场间 | 过渡方式 | 说明 |",
      "|---|---|---|",
      "| Sc1 → Sc2 | 硬切 | 直接进入下一场 |",
      "</scriptPlan>",
    ].join("\n");

    const audit = auditDirectorPlanStructure(output);

    expect(audit.passed).toBe(false);
    expect(audit.issues.join("\n")).toContain("缺少固定二级标题");
    expect(audit.issues.join("\n")).toContain("旧三段导演规划格式");
    expect(audit.metrics.legacyThreeBlockHeadings).toEqual([
      "分场汇总表",
      "逐场注意事项",
      "场间过渡",
    ]);
    expect(audit.issues.join("\n")).toContain("第④段");
  });

  it("accepts audited six-section director plans with complete Sc scene intents", () => {
    const output = [
      "<scriptPlan>",
      "# 《剑主夜访道口镇 EP01》导演创作规划",
      "",
      "## ① 主题立意与叙事核心",
      "核心主题：在被宗门火印压低的道口镇里，落魄剑修用一寸不暴露实力的动作看见穷苦少年的命数。情感主线从码头压迫，到客栈旧痛，再到塾馆微光和灵舟逼近，形成压迫、微燃、倒计时三层递进。离场感受应是苍凉、紧迫、意难平。",
      "",
      "## ② 视觉风格与画面基调",
      "构图以偏侧留白和纵深层叠为主，角色常被压在画面边缘，空间像旧宣纸上的冷灰水痕。码头用队列和藤筐形成斜向压迫，客栈用门框和柜台制造牢笼感，塾馆用角落和水缸突出少年被忽视的位置。镜头运动以定镜、缓推、缓拉为主，禁止无目的环绕和炫技变焦。",
      "",
      "## ③ 叙事结构与节奏规划",
      "叙事采用起承转合：Sc1 建立码头压迫和独孤的隐性救人，Sc2 收入客栈断剑和铜钱线索，Sc3 让晏燎暗红灵气成为全章微光，Sc4 用残卷裂纹和灵舟压境完成钩子。节奏先慢压，再短促点燃，最后把希望和追杀同时推到门口。",
      "",
      "## ④ 分场景情绪与画面意图",
      "",
      "### Sc 1-1 金水河码头 晨/外",
      "- **情绪目标**：观众先看见人被制度压扁，再看见灰衫客只动一寸就救下小杂役；他像河岸枯木，不出声，却能让灾祸偏开半寸。",
      "- **氛围方向**：压迫、窒息、冷漠。",
      "- **镜头意图**：",
      "  - 大远景展示藤筐、矿石和苦力队列，让码头像一台吞人的机器。",
      "  - 中景跟住独孤草鞋滑半寸，矿石砸空，观众只看到物理结果，不看到他暴露实力。",
      "  - 鞋尖拨朽木救人保持中远距离，避免英雄化，突出他仍选择隐藏。",
      "- **空间叙事**：前景朽木栈道，中景赵四与小杂役，背景金水河雾中船影，三层都在压向人。",
      "- **连续性锚点**：独孤灰衫、草鞋、背后油布剑包贯穿后续场次；小杂役恐惧姿态和赵四鞭梢方向不能错位。",
      "",
      "### Sc 1-2 悦来客栈 夜/内",
      "- **情绪目标**：铜钱落柜和断剑揭布把他的贫困与旧案同时推出来，观众第一次靠近他的秘密。",
      "- **氛围方向**：戒备、逼仄、旧痛翻涌。",
      "- **镜头意图**：",
      "  - 柜台正反打压低独孤位置，表现他在人间规则里没有余地。",
      "  - 上楼脚步避开木板响声，与码头避矿石形成同一套肉身本能。",
      "  - 三层油布被揭开，断剑断口进入大特写，旧案线索由道具承担。",
      "- **空间叙事**：柜台、楼梯、斗室层层收紧，门框和木墙让角色无处可退。",
      "- **连续性锚点**：断剑位置、账册线索、铜钱数量和油布剑包状态必须进入后续分镜表。",
      "",
      "## ⑤ 声音方向",
      "逐场声音要服务压迫和微光：Sc1 用苦力号子、矿石碎裂、鞭梢破空构成底噪，独孤救人瞬间压低其他声源，只留矿石砸空；Sc2 用算盘、铜钱落柜、木梯轻响和断剑低鸣建立旧案感；Sc3 用孩童压低的呼吸、水缸闷响和枯枝折断声点出晏燎命数；Sc4 用更鼓、缆绳绷断、寒铁震鸣和窗棂响声完成倒计时。",
      "",
      "## ⑥ 转场与视觉连续性",
      "Sc1 到 Sc2 以矿石裂纹的墨痕硬切到客栈柜台账册，保留压迫质感；Sc2 到 Sc3 用断剑断口形状接塾馆门框，暗示旧伤寻找新因；Sc3 到 Sc4 用晏燎掌心余温接残卷新裂纹，形成希望与杀机同源。视觉连续性锚点包括独孤灰衫和油布剑包、断剑断口、铜钱和账册、晏燎湿草鞋与暗红灵气。",
      "",
      "## ⑦ 衍生资产预划清单",
      "| 资产名 | 衍生状态 | 原因/出现段落 |",
      "|---|---|---|",
      "| 独孤剑尘 | 灰衫入镇态 | Sc1-Sc4 连续出镜 |",
      "</scriptPlan>",
    ].join("\n");

    const audit = auditDirectorPlanStructure(output);
    const { plan } = parseDirectorPlan(output, "chapter-001");

    expect(audit.passed).toBe(true);
    expect(audit.metrics.sceneSections).toBe(2);
    expect(audit.metrics.completeSceneIntents).toBe(2);
    expect(plan.sceneIntents).toHaveLength(2);
  });

  it("parses Toonflow-style <scriptPlan> into structured downstream fields", () => {
    const output = [
      "<scriptPlan>",
      "### 分场汇总表（核心）",
      "| 场次 | 场景名 | 台词条数 | 台词字数 | 情绪浓度 | 情绪基调（含 X→Y） |",
      "|---|---|---|---|---|---|",
      "| Sc1 | 金水河码头·苦力受鞭 | 6 | 42 | 8 | 压迫→隐忍救人 |",
      "| Sc2 | 悦来客栈·断剑露出 | 8 | 38 | 6 | 冷静→旧痛翻涌 |",
      "",
      "### 逐场注意事项",
      "- **Sc1**：",
      "  - 情感砸点：鞭梢将落未落，小杂役缩肩护头。",
      "  - 环境音：铁链拖石声、藤筐炸裂声。",
      "- **Sc2**：",
      "  - 一致性锚点：油布剑包始终压住独孤背脊。",
      "",
      "### 场间过渡",
      "| 场间 | 过渡方式 | 说明 |",
      "|---|---|---|",
      "| Sc1 → Sc2 | 叠化 | 鞭痕墨色晕开，化作顺风街灰雾 |",
      "",
      "### 衍生资产预划清单",
      "| 资产名 | 衍生状态 | 原因/出现段落 |",
      "|---|---|---|",
      "| 独孤剑尘 | 鞭伤破衣 | Sc1 受鞭后连续复用 |",
      "| 油布剑包 | 露出断剑 | Sc2 关键物证特写 |",
      "</scriptPlan>",
    ].join("\n");

    const { plan } = parseDirectorPlan(output, "chapter-001");

    expect(plan.episodeId).toBe("chapter-001");
    expect(plan.theme).toContain("Sc1");
    expect(plan.theme).toContain("金水河码头");
    expect(plan.narrativeRhythm).toContain("情感砸点");
    expect(plan.narrativeRhythm).toContain("油布剑包");
    expect(plan.transitions).toContain("Sc1 → Sc2");
    expect(plan.transitions).toContain("顺风街灰雾");
    expect(plan.transitions).not.toContain("衍生资产预划清单");
    expect(plan.derivedAssetPlan).toEqual([
      {
        parentAssetId: "独孤剑尘",
        state: "鞭伤破衣",
        reason: "Sc1 受鞭后连续复用",
      },
      {
        parentAssetId: "油布剑包",
        state: "露出断剑",
        reason: "Sc2 关键物证特写",
      },
    ]);
  });

  it("merges multiple <scriptPlan> segments, maps sections to prose fields, parses ⑦ table to derivedAssetPlan, collects lighting warnings", () => {
    const output = [
      "好的，以下是规划：",
      "<scriptPlan>",
      "#### ① 主题立意与叙事核心",
      "核心主题：救赎。情感主线从愧疚到释怀。",
      "#### ② 视觉风格与画面基调",
      "对称构图传达压迫；缓推靠近角色内心；逆光轮廓登场。",
      "</scriptPlan>",
      "<scriptPlan>",
      "#### ③ 叙事结构与节奏规划",
      "原著保真型，按场景边界划分，情绪曲线渐进。",
      "#### ⑤ 声音方向",
      "环境音：蝉鸣、溪水。关键瞬间留白。",
      "#### ⑥ 转场与视觉连续性",
      "同场硬切，场间空镜缓冲。锚点：服装状态一致。",
      "</scriptPlan>",
      "<scriptPlan>",
      "#### ⑦ 衍生资产预划清单",
      "| 资产名 | 衍生状态 | 原因/出现段落 |",
      "| --- | --- | --- |",
      "| 林逸 | 受伤带血 | 第3段决斗后多镜复用 |",
      "| 客栈大堂 | 夜景版 | Sc7 夜戏定场 |",
      "| | 缺名 | 非法行应跳过 |",
      "</scriptPlan>",
    ].join("\n");

    const { plan, warnings } = parseDirectorPlan(output, "episode-1");

    expect(plan.episodeId).toBe("episode-1");
    expect(plan.id).toBeTruthy();
    expect(plan.theme).toContain("救赎");
    expect(plan.visualStyle).toContain("对称构图");
    // lighting term in ② must be stripped from the stored field
    expect(plan.visualStyle).not.toContain("逆光");
    expect(plan.narrativeRhythm).toContain("原著保真型");
    expect(plan.soundDirection).toContain("蝉鸣");
    expect(plan.transitions).toContain("硬切");

    // ⑦ table → derivedAssetPlan (2 valid rows, illegal row skipped)
    expect(plan.derivedAssetPlan).toHaveLength(2);
    expect(plan.derivedAssetPlan[0]).toMatchObject({
      parentAssetId: "林逸",
      state: "受伤带血",
      reason: "第3段决斗后多镜复用",
    });
    expect(plan.derivedAssetPlan[1]).toMatchObject({
      parentAssetId: "客栈大堂",
      state: "夜景版",
    });

    // lighting warning surfaced
    expect(warnings.some((w) => w.includes("逆光"))).toBe(true);
  });

  it("parses rich ①-⑥ director plans with Sc scene subsections into sceneIntents", () => {
    const output = [
      "<scriptPlan>",
      "## ① 主题立意与叙事核心",
      "核心主题：灰衫剑修在被宗门火印碾压的小镇里等到微光。",
      "## ② 视觉风格与画面基调",
      "宣纸淡彩工笔，低饱和蓝灰。",
      "## ③ 叙事结构与节奏规划",
      "P1 码头压迫，P2 客栈蓄压。",
      "## ④ 分场景情绪与画面意图",
      "### Sc 1-1 金水河码头 傍晚/外",
      "- **情绪目标**：观众先看见人被制度压扁，再看见灰衫客只动一寸。",
      "- **氛围方向**：压迫、窒息、冷漠。",
      "- **镜头意图**：",
      "  - 鞋尖拨木、鞭落偏移、空筐炸裂三步完成救人。",
      "  - 逆光不能进入结构化字段。",
      "- **空间叙事**：前景朽木栈道，中景赵四与小杂役，背景金水河雾。",
      "- **距离感设计**：独孤多用中远景，赵四用近景压迫。",
      "",
      "### Sc 1-2 悦来客栈 夜/内",
      "- **情绪目标**：铜钱落柜，断剑旧案被推入斗室。",
      "- **氛围方向**：戒备、孤独。",
      "- **镜头意图**：斗室揭油布一圈圈打开。",
      "- **空间叙事**：柜台、楼梯、斗室层层收紧。",
      "- **距离感设计**：斗室内才允许镜头靠近断剑。",
      "## ⑤ 声音方向",
      "算盘、铜钱、断剑低鸣。",
      "## ⑥ 转场与视觉连续性",
      "空筐裂口墨色晕开接绿锈铜钱。",
      "### ⑦ 衍生资产预划清单",
      "| 资产名 | 衍生状态 | 原因/出现段落 |",
      "|---|---|---|",
      "| 独孤剑尘 | 灰衫入镇态 | Sc1-Sc2 连续出镜 |",
      "</scriptPlan>",
    ].join("\n");

    const { plan, warnings } = parseDirectorPlan(output, "chapter-001");

    expect(plan.sceneIntents).toHaveLength(2);
    expect(plan.sceneIntents[0]).toMatchObject({
      sceneId: "Sc 1-1",
    });
    expect(plan.sceneIntents[0]?.emotion).toContain("压迫");
    expect(plan.sceneIntents[0]?.shotIntent).toContain("鞋尖拨木");
    expect(plan.sceneIntents[0]?.shotIntent).not.toContain("逆光");
    expect(plan.sceneIntents[0]?.spatial).toContain("前景朽木栈道");
    expect(plan.sceneIntents[1]).toMatchObject({
      sceneId: "Sc 1-2",
    });
    expect(plan.sceneIntents[1]?.spatial).toContain("斗室层层收紧");
    expect(plan.derivedAssetPlan).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes("逆光"))).toBe(true);
  });

  it("returns empty derivedAssetPlan when the plan states no derivation is needed", () => {
    const output = [
      "<scriptPlan>",
      "#### ① 主题立意与叙事核心",
      "核心主题：日常。",
      "#### ⑦ 衍生资产预划清单",
      "无需衍生资产",
      "</scriptPlan>",
    ].join("\n");

    const { plan } = parseDirectorPlan(output, "ep1");
    expect(plan.theme).toContain("日常");
    expect(plan.derivedAssetPlan).toEqual([]);
  });

  it("preserves Toonflow numeric assetsId and flowId in derived asset rows", () => {
    const output = [
      "<scriptPlan>",
      "### 分场汇总表（核心）",
      "| 场次 | 场景名 | 台词条数 | 台词字数 | 情绪浓度 | 情绪基调（含 X→Y） |",
      "|---|---|---|---|---|---|",
      "| Sc1 | 道口镇街口 | 4 | 28 | 7 | 压迫→反击 |",
      "",
      "### 衍生资产预划清单",
      "| assetsId | id | name | desc | flowId |",
      "|---|---|---|---|---|",
      "| 2521 | 3230 | 晨雾版 | 既有 Toonflow 衍生资产 | 1 |",
      "</scriptPlan>",
    ].join("\n");

    const { plan } = parseDirectorPlan(output, "chapter-001");

    expect(plan.derivedAssetPlan).toEqual([
      {
        parentAssetId: "2521",
        state: "晨雾版",
        reason: "既有 Toonflow 衍生资产",
        toonflowAssetsId: 2521,
        toonflowDerivedAssetId: 3230,
        imageWorkflowId: "1",
      },
    ]);
  });
});

describe("studio director plan messages", () => {
  it("injects the director-plan skill content and embeds script text", () => {
    const messages = buildDirectorPlanMessages({
      episodeId: "ep1",
      scriptText: "林逸走进客栈大堂，掏出account账册。",
      manualContext: "## 视觉手册\n写意国风",
    });

    expect(messages.system).toContain("导演规划");
    expect(messages.system).toContain("写意国风");
    for (const section of REQUIRED_DIRECTOR_PLAN_SECTIONS) {
      expect(messages.system).toContain(`## ${section}`);
    }
    expect(messages.user).toContain("林逸走进客栈大堂");
  });

  it("builds a concrete repair prompt with audit issues and fixed six headings", () => {
    const repair = buildDirectorPlanRepairUserMessage({
      originalUserContent: "剧本正文：第一场码头。",
      invalidOutput: "<scriptPlan>### 分场汇总表</scriptPlan>",
      issues: ["缺少固定二级标题", "第④段缺少 ### Sc ... 逐场小节"],
    });

    expect(repair).toContain("结构修复任务");
    expect(repair).toContain("缺少固定二级标题");
    expect(repair).toContain("第④段缺少 ### Sc ... 逐场小节");
    for (const section of REQUIRED_DIRECTOR_PLAN_SECTIONS) {
      expect(repair).toContain(`## ${section}`);
    }
  });
});
