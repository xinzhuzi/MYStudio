import { describe, expect, it } from "vitest";
import {
  buildStoryboardTableMessages,
  parseStoryboardTable,
  computeDurationSec,
  resolveSpeed,
  toStoryboardItems,
} from "./storyboard-table";

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

describe("studio storyboard table parsing", () => {
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
    ]);
    expect(items).toHaveLength(2);
    expect(items.map(({ id, trackKey }) => ({ id, trackKey }))).toEqual([
      { id: "sb-chapter-001-001", trackKey: "chapter-001-scene-1" },
      { id: "sb-chapter-001-002", trackKey: "chapter-001-scene-1" },
    ]);
    expect(items[0]?.speakerId).toBe("character:char-keeper");
    expect(items[1]?.speakerId).toBe("character:char-dugu");
    expect(items[0]?.assetIds).toEqual(["role-001", "role-002", "scene-001"]);
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
    ).toEqual(["ep1-scene-1", "ep1-scene-2"]);
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
