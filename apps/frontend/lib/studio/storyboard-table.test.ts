import { describe, expect, it } from "vitest";
import {
  buildStoryboardTableMessages,
  parseStoryboardTable,
  computeDurationSec,
  resolveSpeed,
  serializeStoryboardTable,
  toStoryboardItems,
} from "./storyboard-table";

describe("buildStoryboardTableMessages · 资产清单注入", () => {
  it("includes the assets inventory block so the 资产真实 red line can be satisfied without tools", () => {
    const messages = buildStoryboardTableMessages({
      episodeId: "chapter-001",
      scriptText: "剧本正文",
      assetsInventory: "- 角色：独孤剑尘；晏燎\n- 场景：金水河码头",
    });
    expect(messages.user).toContain("## 资产清单（引用资产名称只允许使用以下真实在册资产，不得编造）");
    expect(messages.user).toContain("独孤剑尘；晏燎");
    expect(messages.user).toContain("剧本正文");
    expect(messages.system).toContain("分镜序号铁律：全表分镜序号从 1 起全局连续递增");
  });
});

describe("studio storyboard duration math", () => {
  it("resolves speech speed by emotion and computes duration with margin", () => {
    expect(resolveSpeed("愤怒轻蔑")).toBe(4);
    expect(resolveSpeed("正常陈述")).toBe(3);
    expect(resolveSpeed("悲伤绝望")).toBe(2);
    expect(resolveSpeed("低语虚弱")).toBe(2);
    expect(resolveSpeed("")).toBe(3); // default normal

    // 12 chars at 正常(3/s) = 4s, + 1s margin = 5s
    expect(computeDurationSec("这是一句十二个字的台词内容", 3)).toBe(
      Math.ceil("这是一句十二个字的台词内容".length / 3) + 1,
    );
    // 愤怒 4/s for same text → fewer seconds
    expect(
      computeDurationSec("这是一句十二个字的台词内容", 4),
    ).toBeLessThan(computeDurationSec("这是一句十二个字的台词内容", 2));
  });
});

describe("studio storyboard table messages", () => {
  it("injects manual context between the skill and the voiceover guard in system", () => {
    const messages = buildStoryboardTableMessages({
      episodeId: "chapter-001",
      scriptText: "第一场：夜，矿场。",
      scriptPlanContext: "导演规划要点：压抑",
      manualContext: "# 视觉手册 · 分镜表风格约束\n\n工笔线描锚词",
    });

    expect(messages.system).toContain("工笔线描锚词");
    const skillIndex = messages.system.indexOf("storyboardTable") >= 0
      ? messages.system.indexOf("分镜")
      : 0;
    const manualIndex = messages.system.indexOf("工笔线描锚词");
    const guardIndex = messages.system.indexOf("分镜配音硬约束");
    expect(manualIndex).toBeGreaterThan(skillIndex);
    expect(guardIndex).toBeGreaterThan(manualIndex);
  });

  it("keeps system assembled without manual context when it is absent", () => {
    const messages = buildStoryboardTableMessages({
      episodeId: "chapter-001",
      scriptText: "第一场：夜，矿场。",
    });

    expect(messages.system).toContain("分镜配音硬约束");
    expect(messages.system).not.toContain("视觉手册 · 分镜表风格约束");
  });

  it("injects the source bible before the manual context in system when provided", () => {
    const messages = buildStoryboardTableMessages({
      episodeId: "chapter-001",
      scriptText: "第一场：夜，矿场。",
      manualContext: "# 视觉手册 · 分镜表风格约束\n\n工笔线描锚词",
      bibleContext: "# 原著圣经（最高优先级·人物一律用此表规范名）\n\n## 主要人物\n- 林逸：主角",
    });

    const bibleIndex = messages.system.indexOf("原著圣经（最高优先级");
    const manualIndex = messages.system.indexOf("工笔线描锚词");
    const guardIndex = messages.system.indexOf("分镜配音硬约束");
    expect(bibleIndex).toBeGreaterThanOrEqual(0);
    expect(manualIndex).toBeGreaterThan(bibleIndex);
    expect(guardIndex).toBeGreaterThan(manualIndex);
  });
});

describe("studio storyboard table parsing", () => {
  it("serializes canonical storyboards to a Markdown source record without embedding media paths", () => {
    const parsedSource = parseStoryboardTable([
        "<storyboardTable>",
        "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID | 出镜语义JSON |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        `| 1 | 雨夜码头 | 码头 | [码头] | 2 | 近景 | 静止 | 镜头推进 | 面向右 | 中景 | 紧张 | 旁白：雨声压低 | 风声 | [scene-dock] | ${JSON.stringify({
          sceneViewpointId: "dock",
          personFree: true,
          visibleCharacters: [],
          visibleProps: [{ name: "码头", position: "中景", state: "湿润" }],
          actionIn: "雨落",
          actionOut: "雨声延续",
        })} |`,
        "</storyboardTable>",
      ].join("\n"),
      "episode-1",
    );
    const item = toStoryboardItems(parsedSource.rows, "episode-1", [])[0]!;
    const canonical = {
      ...item,
      mediaRef: { kind: "image" as const, path: "/project/media/shot.png" },
    };
    const source = serializeStoryboardTable([canonical]);
    const parsed = parseStoryboardTable(source, "episode-1");

    expect(source).toContain("<storyboardTable>");
    expect(source).not.toContain("/project/media/shot.png");
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows[0]).toMatchObject({
      index: 1,
      description: "雨夜码头",
      duration: 2,
      lines: "旁白：雨声压低",
    });
  });

  it("parses Toonflow grouped scene/segment storyboard tables", () => {
    const output = [
      "<storyboardTable>",
      "## 场1：道口镇客栈 ｜ 参演角色：独孤剑尘、掌柜",
      "",
      "### 片段一（约10s）",
      "**引用资产名称**：[独孤剑尘, 掌柜, 道口镇客栈]",
      "**引用资产ID**：[role-001, role-002, scene-001]",
      "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 |",
      "|------|------|------|------|------|------|------|",
      "| 1 | 独孤剑尘推门停在门槛前，掌柜抬眼收住拨算盘的手。 | 5 | 中景 | 缓推 | 掌柜：客官，外头雨大。 | 音效：木门吱呀声、算盘珠停顿声 |",
      "| 2 | 独孤剑尘侧身避开滴水，将断剑往怀里压紧。 | 5 | 近景 | 静止 | 独孤剑尘：借一盏灯。 | 音效：雨水滴落声 |",
      "</storyboardTable>",
    ].join("\n");

    const { rows, errors } = parseStoryboardTable(output, "chapter-001");

    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      index: 1,
      sceneIndex: 1,
      scene: "道口镇客栈",
      segmentTitle: "片段一（约10s）",
      shotSize: "中景",
      cameraMove: "缓推",
      lines: "掌柜：客官，外头雨大。",
    });
    expect(rows[0]?.associateAssetsNames).toEqual([
      "独孤剑尘",
      "掌柜",
      "道口镇客栈",
    ]);
    expect(rows[0]?.associateAssetsIds).toEqual([
      "role-001",
      "role-002",
      "scene-001",
    ]);
    const items = toStoryboardItems(rows, "chapter-001", [
      { characterId: "char-dugu", name: "独孤剑尘", aliases: ["剑尘"] },
      { characterId: "char-keeper", name: "掌柜", aliases: [] },
    ], { sourceId: "source-001", revision: 3 });
    expect(items).toHaveLength(2);
    expect(items.map(({ id, trackKey }) => ({ id, trackKey }))).toEqual([
      { id: "sb-chapter-001-001", trackKey: "001-1" },
      { id: "sb-chapter-001-002", trackKey: "001-2" },
    ]);
    expect(items[0]?.speakerId).toBe("character:char-keeper");
    expect(items[1]?.speakerId).toBe("character:char-dugu");
    expect(items[0]?.assetIds).toEqual(["role-001", "role-002", "scene-001"]);
    expect(items[0]).toMatchObject({ sourceId: "source-001", revision: 3 });
  });

  it("preserves decimal duration budgets from the source table", () => {
    const output = [
      "<storyboardTable>",
      "## 场1：金水河码头",
      "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 |",
      "|------|------|------|------|------|------|------|",
      "| 1 | 河雾压低 | 4.2秒 | 远景 | 缓推 | 旁白：河雾压低。 | 水声 |",
      "| 2 | 火印亮起 | 4.8秒 | 近景 | 静止 | 旁白：火印亮起。 | 风声 |",
      "</storyboardTable>",
    ].join("\n");

    const { rows, errors } = parseStoryboardTable(output, "chapter-001");
    expect(errors).toHaveLength(0);
    expect(rows.map((row) => row.duration)).toEqual([4.2, 4.8]);
    expect(
      toStoryboardItems(rows, "chapter-001", []).map(
        (item) => item.durationTarget,
      ),
    ).toEqual([4.2, 4.8]);
  });

  it("parses source-defined per-shot visibility instead of inferring the scene cast", () => {
    const semantics = JSON.stringify({
      sceneViewpointId: "dock-main-axis",
      personFree: false,
      visibleCharacters: [{
        name: "监工赵四",
        position: "左中格",
        orientation: "正面三分之四朝右下",
        actionIn: "抬鞭停在肩侧",
        actionOut: "鞭臂停在劈落前的顶点",
      }],
      visibleProps: [{
        name: "赤练蛇皮鞭",
        position: "左前景",
        state: "鞭梢扬起",
      }],
      actionIn: "赵四站在左中格，鞭梢朝向右下",
      actionOut: "赵四保持抬鞭姿势",
    });
    const output = [
      "<storyboardTable>",
      "## 场1：金水河码头 ｜ 参演角色：独孤剑尘、监工赵四、小杂役",
      "**引用资产名称**：[监工赵四, 赤练蛇皮鞭, 金水河码头]",
      "**引用资产ID**：[role-zhao, prop-whip, scene-dock]",
      "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 | 出镜语义JSON |",
      "|------|------|------|------|------|------|------|------|",
      `| 1 | 赵四抬鞭立在湿木栈道。 | 4 | 中景 | 缓推 | 旁白：鞭梢划过河雾。 | 风声 | ${semantics} |`,
      "</storyboardTable>",
    ].join("\n");

    const { rows, errors } = parseStoryboardTable(output, "chapter-001");

    expect(errors).toHaveLength(0);
    expect(rows[0]?.shotSemantics).toEqual(JSON.parse(semantics));
    expect(rows[0]?.shotSemantics?.visibleCharacters).toHaveLength(1);
    expect(rows[0]?.shotSemantics?.visibleCharacters[0]?.name).toBe("监工赵四");
  });

  it("rejects an ambiguous empty cast unless the source explicitly declares a person-free shot", () => {
    const output = [
      "<storyboardTable>",
      "## 场1：金水河码头",
      "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 | 出镜语义JSON |",
      "|------|------|------|------|------|------|------|------|",
      "| 1 | 河雾压低。 | 4 | 远景 | 静止 | 旁白：河雾压低。 | 水声 | {\"sceneViewpointId\":\"dock-main-axis\",\"personFree\":false,\"visibleCharacters\":[],\"visibleProps\":[],\"actionIn\":\"河雾压低\",\"actionOut\":\"河雾掠过木桩\"} |",
      "</storyboardTable>",
    ].join("\n");

    expect(parseStoryboardTable(output, "chapter-001").errors).toContain(
      "分镜 1 必须明确人物入画，或以 personFree=true 声明无人物镜头",
    );
  });

  it("rejects a production semantic without a viewpoint or visible-prop declaration", () => {
    const output = [
      "<storyboardTable>",
      "## 场1：金水河码头",
      "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 | 出镜语义JSON |",
      "|------|------|------|------|------|------|------|------|",
      "| 1 | 河雾压低。 | 4 | 远景 | 静止 | 旁白：河雾压低。 | 水声 | {\"personFree\":true,\"visibleCharacters\":[],\"actionIn\":\"河雾压低\",\"actionOut\":\"河雾掠过木桩\"} |",
      "</storyboardTable>",
    ].join("\n");

    expect(parseStoryboardTable(output, "chapter-001", { requireShotSemantics: true }).errors).toContain(
      "分镜 1 出镜语义JSON缺少 sceneViewpointId、personFree、visibleCharacters、visibleProps、actionIn 或 actionOut",
    );
  });

  it("requires per-shot semantics when accepting a newly generated production table", () => {
    const output = [
      "<storyboardTable>",
      "## 场1：金水河码头",
      "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 |",
      "|------|------|------|------|------|------|------|",
      "| 1 | 河雾压低。 | 4 | 远景 | 静止 | 旁白：河雾压低。 | 水声 |",
      "</storyboardTable>",
    ].join("\n");

    const parsed = parseStoryboardTable(output, "chapter-001", {
      requireShotSemantics: true,
    });

    expect(parsed.errors).toContain("分镜 1 缺少出镜语义JSON");
  });

  it.each([
    [1, 1],
    [2, 1],
    [1, 3],
  ])("blocks non-continuous storyboard indexes %j", (...indexes) => {
    const rows = indexes.map(
      (index) =>
        `| ${index} | 镜头${index} | 3 | 中景 | 静止 | 旁白：镜头${index}。 | 风声 |`,
    );
    const output = [
      "<storyboardTable>",
      "## 场1：金水河码头",
      "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 |",
      "|------|------|------|------|------|------|------|",
      ...rows,
      "</storyboardTable>",
    ].join("\n");

    const parsed = parseStoryboardTable(output, "chapter-001");
    const expectedError = `分镜序号必须连续为 1..N: [${indexes.join(", ")}]`;
    expect(parsed.errors).toContain(expectedError);
    expect(() =>
      toStoryboardItems(parsed.rows, "chapter-001", []),
    ).toThrow(expectedError);
  });

  it("merges multiple <storyboardTable> segments, parses 14 columns, splits [a,b] names/ids, skips header/separator/illegal", () => {
    const output = [
      "<storyboardTable>",
      "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 1 | 苏晚卿冷笑居高临下 | 大殿 | [苏晚卿, 凌玄] | 4 | 近景 | 静止 | (开篇)嘴角上扬 | 苏晚卿-3/4正面朝右 | 苏晚卿(中后)、凌玄(中前) | 冷傲轻蔑 | 苏晚卿：还有你当宝贝的青云令 | 空旷殿堂回声 | [101, 100] |",
      "</storyboardTable>",
      "<storyboardTable>",
      "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID |",
      "| 2 | 青云令灵纹暗淡裂痕浮现 | 偏殿 | [青云令] | 3 | 大特写 | 静止 | (承接上镜:喷血后切物件)灵纹由亮渐灭 | — | — | 紧张压迫 | 旁白：青云令表面灵纹一寸寸暗淡 | 细微玉石碎裂声 | [202] |",
      "| 坏行缺列 | 只有两列 |",
      "</storyboardTable>",
    ].join("\n");

    const { rows, errors } = parseStoryboardTable(output, "ep1");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      index: 1,
      description: "苏晚卿冷笑居高临下",
      scene: "大殿",
      shotSize: "近景",
      cameraMove: "静止",
      emotion: "冷傲轻蔑",
    });
    expect(rows[0]?.associateAssetsNames).toEqual(["苏晚卿", "凌玄"]);
    expect(rows[0]?.associateAssetsIds).toEqual(["101", "100"]);
    expect(rows[0]?.lines).toContain("还有你当宝贝的青云令");
    expect(rows[1]?.index).toBe(2);
    expect(rows[1]?.associateAssetsNames).toEqual(["青云令"]);
    expect(rows.map((row) => row.sceneIndex)).toEqual([1, 2]);
    expect(
      toStoryboardItems(rows, "ep1", [
        { characterId: "char-su", name: "苏晚卿", aliases: [] },
      ]).map((item) => item.trackKey),
    ).toEqual(["ep1-1", "ep1-2"]);
    expect(errors).toHaveLength(1);
  });

  it("strips lighting/color-temperature words from description/action/emotion and warns (§2.4)", () => {
    const output = [
      "<storyboardTable>",
      "| 1 | 暖光下人物靠向椅背，逆光轮廓 | 大殿 | [甲] | 3 | 近景 | 静止 | (开篇)色温偏冷地转身 | 面朝右 | — | 暖色调的平静 | 无台词 | 风声 | [1] |",
      "</storyboardTable>",
    ].join("\n");

    const { rows, warnings } = parseStoryboardTable(output, "ep1");
    expect(rows[0]?.description).not.toMatch(/暖光|逆光/);
    expect(rows[0]?.action).not.toMatch(/色温/);
    expect(rows[0]?.emotion).not.toMatch(/暖色调|色调/);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("studio storyboard items mapping", () => {
  it("maps rows to StoryboardItem while preserving the director-table duration budget", () => {
    const { rows } = parseStoryboardTable(
      [
        "<storyboardTable>",
        // The table duration is the chapter pacing budget; real TTS may extend it later.
        "| 1 | 描述 | 大殿 | [甲] | 2 | 近景 | 静止 | (开篇)动作 | 面朝右 | — | 正常陈述 | 甲：这是一句很长的台词需要更多时间念完 | 风声 | [1] |",
        "</storyboardTable>",
      ].join("\n"),
      "ep1",
    );
    const items = toStoryboardItems(rows, "ep1", [
      { characterId: "char-a", name: "甲", aliases: [] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.episodeId).toBe("ep1");
    expect(items[0]?.prompt).toBe("描述");
    expect(items[0]?.emotion).toBe("正常陈述");
    expect(items[0]?.orientation).toBe("面朝右");
    expect(items[0]?.lines).toBe("甲：这是一句很长的台词需要更多时间念完");
    expect(items[0]?.sound).toBe("风声");
    expect(items[0]?.speakerId).toBe("character:char-a");
    expect(items[0]?.shouldGenerateImage).toBe(true);
    expect(items[0]?.duration).toBe(2);
    expect(items[0]?.durationTarget).toBe(2);
  });

  it("keeps narration as a narrator speaker for TTS voice line generation", () => {
    const { rows } = parseStoryboardTable(
      [
        "<storyboardTable>",
        "| 1 | 灵舟压雾逼近道口镇 | 金水河 | [宗门灵舟] | 4 | 远景 | 缓推 | 雾中船影压近 | — | — | 危机逼近 | 旁白：宗门灵舟压雾而来 | 船桨破水声 | [ship-1] |",
        "</storyboardTable>",
      ].join("\n"),
      "chapter-001",
    );

    const items = toStoryboardItems(rows, "chapter-001", []);
    expect(items[0]?.lines).toBe("旁白：宗门灵舟压雾而来");
    expect(items[0]?.speakerId).toBe("narrator");
  });

  it("tolerates off-screen notation and walk-on speakers via narrator fallback options", () => {
    const { rows, errors } = parseStoryboardTable(
      [
        "<storyboardTable>",
        "## 场1：金水河码头",
        "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 |",
        "|------|------|------|------|------|------|------|",
        "| 1 | 剑尘立于雨中 | 6 | 中景 | 缓推 | 独孤剑尘OS：不是每一鞭，都值得我拔剑。 | 雨声 |",
        "| 2 | 散修攥紧药草 | 6 | 近景 | 静止 | 断臂散修：这草是我拿命换的！ | 喧闹声 |",
        "| 3 | 风声掠过街巷 | 6 | 远景 | 横移 | 街巷风声V.S.：一条命换不来一副药。 | 风声 |",
        "| 4 | 剑尘回望 | 6 | 特写 | 静止 | 独孤剑尘V.S.：归元，为谁而鸣？ | 低鸣 |",
        "</storyboardTable>",
      ].join("\n"),
      "chapter-001",
    );
    expect(errors).toHaveLength(0);

    const characters = [
      { characterId: "char-dugu", name: "独孤剑尘", aliases: [] },
    ];
    // 缺省严格：OS 记法已归一可解析，群演仍抛错
    expect(() => toStoryboardItems(rows, "chapter-001", characters)).toThrow(
      "speaker 无法解析到角色资产: 断臂散修",
    );

    const fallbacks: Array<[string, string]> = [];
    const items = toStoryboardItems(rows, "chapter-001", characters, undefined, {
      unknownSpeaker: "narrator",
      onSpeakerFallback: (storyboardId, speaker) => fallbacks.push([storyboardId, speaker]),
    });
    expect(items).toHaveLength(4);
    expect(items[0]?.speakerId).toBe("character:char-dugu");
    expect(items[0]?.speaker).toBe("独孤剑尘OS");
    expect(items[1]?.speakerId).toBe("narrator");
    expect(items[1]?.speaker).toBe("断臂散修");
    expect(items[3]?.speakerId).toBe("character:char-dugu");
    expect(fallbacks).toEqual([
      ["sb-chapter-001-002", "断臂散修"],
      ["sb-chapter-001-003", "街巷风声V.S."],
    ]);
  });
});

describe("studio storyboard table messages", () => {
  it("injects both storyboard skills and embeds scriptPlan context + script text", () => {
    const messages = buildStoryboardTableMessages({
      episodeId: "ep1",
      scriptText: "苏晚卿冷笑。",
      scriptPlanContext: "③节奏：高潮段快切",
    });
    expect(messages.system).toContain("分镜表");
    expect(messages.user).toContain("苏晚卿冷笑");
    expect(messages.user).toContain("高潮段快切");
  });

  it("requires dialogue and narration fields for later voice assignment", () => {
    const messages = buildStoryboardTableMessages({
      episodeId: "ep1",
      scriptText: "旁白：风雪压城。苏晚卿：还有你当宝贝的青云令。",
    });

    expect(`${messages.system}\n${messages.user}`).toContain("台词/旁白");
    expect(`${messages.system}\n${messages.user}`).toContain("配音");
    expect(`${messages.system}\n${messages.user}`).toContain("角色音色");
  });
});
