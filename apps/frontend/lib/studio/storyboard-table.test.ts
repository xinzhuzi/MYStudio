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
  it("merges multiple <storyboardTable> segments, parses 14 columns, splits [a,b] names/ids, skips header/separator/illegal", () => {
    const output = [
      "<storyboardTable>",
      "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 1 | 苏晚卿冷笑居高临下 | 大殿 | [苏晚卿, 凌玄] | 4 | 近景 | 静止 | (开篇)嘴角上扬 | 苏晚卿-3/4正面朝右 | 苏晚卿(中后)、凌玄(中前) | 冷傲轻蔑 | 苏晚卿：还有你当宝贝的青云令 | 空旷殿堂回声 | [101, 100] |",
      "</storyboardTable>",
      "<storyboardTable>",
      "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID |",
      "| 2 | 青云令灵纹暗淡裂痕浮现 | 大殿 | [青云令] | 3 | 大特写 | 静止 | (承接上镜:喷血后切物件)灵纹由亮渐灭 | — | — | 紧张压迫 | 旁白：青云令表面灵纹一寸寸暗淡 | 细微玉石碎裂声 | [202] |",
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
  it("maps rows to StoryboardItem, duration = max(table value, computed from lines)", () => {
    const { rows } = parseStoryboardTable(
      [
        "<storyboardTable>",
        // table says 2s but 12-char line at normal speed needs more → computed wins
        "| 1 | 描述 | 大殿 | [甲] | 2 | 近景 | 静止 | (开篇)动作 | 面朝右 | — | 正常陈述 | 甲：这是一句很长的台词需要更多时间念完 | 风声 | [1] |",
        "</storyboardTable>",
      ].join("\n"),
      "ep1",
    );
    const items = toStoryboardItems(rows, "ep1");
    expect(items).toHaveLength(1);
    expect(items[0]?.episodeId).toBe("ep1");
    expect(items[0]?.prompt).toBe("描述");
    expect(items[0]?.emotion).toBe("正常陈述");
    expect(items[0]?.orientation).toBe("面朝右");
    // computed duration for the long line should exceed the table's 2
    expect(items[0]?.duration).toBeGreaterThan(2);
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
});
