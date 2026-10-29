import { describe, expect, it } from "vitest";
import {
  buildStoryboardTableMessages,
  parseStoryboardTable,
  computeDurationSec,
  resolveSpeed,
  serializeStoryboardTable,
  toStoryboardItems,
} from "./storyboard-table";
import { VOICE_CPS_MIN } from "./script-draft-metrics";
import { createStoryboardSliceActions } from "@/stores/studio/storyboard-slice";
import { storyboardSourceFingerprint } from "@/stores/studio/studio-store-continuity-helpers";
import { mergeStudioWorkflowShards, planStudioWorkflowShards } from "@/lib/storage/studio-workflow-shards";
import type { StoryboardItem } from "@/types/studio";

describe("buildStoryboardTableMessages · 资产清单注入", () => {
  it("仅有真实原文的严格道劫分镜使用195秒预算，通用入口保持3分钟", () => {
    const common = { episodeId: "c1", scriptText: "剧本", strictDaojieAdaptation: true };
    const strict = buildStoryboardTableMessages({ ...common, sourceText: "原文" });
    expect(strict.system).toContain("单集总时长 ≤195 秒（3.25 分钟）");
    expect(strict.system).toContain("单集实际时长总和不得超过195秒");
    expect(strict.system).not.toContain("单集总时长 ≤3 分钟");
    expect(buildStoryboardTableMessages({ ...common, sourceText: " " }).system).toContain("单集总时长 ≤3 分钟");
  });

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

describe("H2/H8 语速唯一口径与纯视觉兼容(10-14 裁定,四审D manual-alignment)", () => {
  // Q1 区间口径(10-14 晚裁定,取代「唯一=4」单口径):resolveSpeed 服务时长估算面,缺省取区间
  // 保守端 VOICE_CPS_MIN=2.5(script-draft-metrics 单源家导出,D 批 import 消费禁本地自定义);
  // 慢速提示(SLOW_EMOTION_HINTS)分档 2 保留(本在即绿,登记维持锁)。
  it("T1 缺省语速=区间保守端 2.5(VOICE_CPS_MIN,平静/无情绪不升档);慢速类保持 2", () => {
    expect(resolveSpeed("")).toBe(VOICE_CPS_MIN);
    expect(resolveSpeed("平静对白")).toBe(VOICE_CPS_MIN);
    expect(resolveSpeed("悲伤低语")).toBe(2);
  });

  // Q1 区间口径:fallback 与缺省同源(同取保守端 VOICE_CPS_MIN)。「这一句台词整整有十个字哦」12 字
  // → ceil(12/2.5)+1 = ceil(4.8)+1 = 6(旧缺省 4 时为 4;估时变长=保守端方向,只严不松)。
  it("T2 computeDurationSec 的 speed<=0 fallback=区间保守端 2.5(与缺省语速同一口径)", () => {
    const text = "这一句台词整整有十个字哦"; // 12 字
    expect(computeDurationSec(text, 0)).toBe(Math.ceil(text.length / VOICE_CPS_MIN) + 1);
  });

  // H8 三处同批(design §6):guard 第 2 条改「无台词」兼容——旁白照录、纯视觉镜写
  // `无台词`,废除「不要留空或写无台词」强制旁白旧口径(现 :87 在场 → RED)。
  // 「无台词」子串正向断言新旧文本均满足(现文本借「…写无台词」满足),登记为绿锁。
  it("T3 guard 兼容无台词:允许纯视觉镜写『无台词』,禁止再强制旁白填充", () => {
    const messages = buildStoryboardTableMessages({
      episodeId: "chapter-001",
      scriptText: "第一场：夜，矿场。",
    });
    expect(messages.system).toContain("无台词");
    expect(messages.system).not.toContain("不要留空或写无台词");
  });

  // 裁定②保留锁(design §3,不改文本只加锁):3 分钟上限与 8~15s 单镜基准硬编码
  // 在 guard(:89)内,任何 H2/H8 改动不得漂移。本在即绿,登记。
  it("T3b 裁定②保留锁:guard 含 ≤3 分钟 / 8~15 秒 / 2~4 句(10-10 裁定文本零改)", () => {
    const messages = buildStoryboardTableMessages({
      episodeId: "chapter-001",
      scriptText: "第一场：夜，矿场。",
    });
    expect(messages.system).toContain("≤3 分钟");
    expect(messages.system).toContain("8~15 秒");
    expect(messages.system).toContain("2~4 句");
  });

  // R17(10-14-audit4-residuals D 批):配音硬约束首条(guard 第 1 条)与次条对齐——强制填写的
  // 是「台词字段」的合法三态(台词/旁白逐字照录|纯视觉镜「无台词」)。旧措辞「每条分镜必须填写
  // 台词/旁白字段」只认两态,会倒逼纯视觉镜为凑字段编旁白——正是次条明令禁止的行为;分镜表手册
  // :142 示例「旁白：西瓜…」即被该措辞带出来的编造旁白实例(T5⑩ 同批修)。
  it("T3c 配音硬约束首条与次条一致:纯视觉镜合法态=「无台词」,不再倒逼编旁白(R17)", () => {
    const messages = buildStoryboardTableMessages({
      episodeId: "chapter-001",
      scriptText: "第一场：夜，矿场。",
    });
    expect(messages.system).toContain("「无台词」");
    expect(messages.system).not.toContain("必须填写台词/旁白字段");
  });
});

describe("studio storyboard duration math", () => {
  it("resolves speech speed by emotion and computes duration with margin", () => {
    // Q1 区间口径(10-14 晚裁定):缺省=区间保守端 VOICE_CPS_MIN=2.5;慢速类保持 2。
    expect(resolveSpeed("愤怒轻蔑")).toBe(VOICE_CPS_MIN);
    expect(resolveSpeed("正常陈述")).toBe(VOICE_CPS_MIN);
    expect(resolveSpeed("悲伤绝望")).toBe(2);
    expect(resolveSpeed("低语虚弱")).toBe(2);
    expect(resolveSpeed("")).toBe(VOICE_CPS_MIN); // default normal (区间保守端 2.5)

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

  it("includes the H3 duration budget guard (2026-10-10 3-min cap + 8~15s long-shot ruling)", () => {
    const messages = buildStoryboardTableMessages({
      episodeId: "chapter-001",
      scriptText: "第一场：夜，矿场。",
    });
    expect(messages.system).toContain("时长预算（H3 视频线）");
    expect(messages.system).toContain("每镜基准 8~15 秒");
    expect(messages.system).toContain("≤3 分钟");
    expect(messages.system).toContain("17k+5");
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
    // 09-14 上游产线 H3 对齐:分镜表列的景别/运镜必须并入 shotSemantics(此前在此断流)。
    expect(item.shotSemantics).toMatchObject({ shotSize: "近景", cameraMove: "静止" });
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
      shotSize: "近景",
      cameraMove: "静止",
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
  it("filters scene-role inheritance to people actually in the shot frame (镜级人物精确性)", () => {
    const md = [
      "## 场1：道口镇街巷｜参演角色：[独孤剑尘, 老苦力, 年轻苦力, 铁山, 油布剑包]",
      "| 1 | 两名妇人带孩子贴墙走，矿奴队列穿过；独孤剑尘被铁链隔在另一侧 | 6s | 中景 | 缓推 | 街巷妇孺与队列 | 旁白：街面嘈杂 | 环境音 |",
      "| 2 | 断臂散修攥紧凝血草，伤处白布渗血 | 4s | 特写 | 固定 | 断臂手部 | 无 | 低鸣 |",
    ].join("\n");
    const parsed = parseStoryboardTable(md, "episode-test");
    const rows = parsed.rows.sort((a, b) => a.index - b.index);
    expect(rows[0]?.associateAssetsNames).toContain("独孤剑尘");
    expect(rows[0]?.associateAssetsNames).not.toContain("铁山");
    expect(rows[1]?.associateAssetsNames.every((n) => n !== "独孤剑尘" && n !== "铁山" && n !== "老苦力")).toBe(true);
  });
});


// ── 批3 D5(10-13-audit4-downstream,裁定⑤):分镜条目带来源剧本指纹 ──────────────
// design §3 D5:分镜条目(sourceScript 条目 id+updatedAt,与 G3 reviewTarget 同形
// 态)随 toStoryboardItems 写入条目可选字段——下游(chapter-pipeline-stale 分镜层
// 过期判定/软标)据此识别「这批分镜基于哪一版剧本」。旧数据无该字段=回落现行为。
// RED:现 ToStoryboardItemsOptions 无 sourceScript,选项被忽略 → 条目无指纹。
it("D5: toStoryboardItems 接受 sourceScript(来源剧本条目 id+updatedAt)并落到每个分镜条目", () => {
  const md = [
    "## 场1：金水河码头",
    "| 1 | 河雾压低 | 4.2秒 | 远景 | 缓推 | 旁白：河雾压低。 | 水声 |",
    "| 2 | 火印亮起 | 4.8秒 | 近景 | 静止 | 旁白：火印亮起。 | 风声 |",
  ].join("\n");
  const { rows, errors } = parseStoryboardTable(md, "chapter-001");
  expect(errors).toHaveLength(0);
  const options = {
    unknownSpeaker: "narrator" as const,
    sourceScript: { entryId: "work-draft-001", updatedAt: 42 },
  } as unknown as Parameters<typeof toStoryboardItems>[4];
  const items = toStoryboardItems(rows, "chapter-001", [], { sourceId: "source-001", revision: 1 }, options);
  expect(items).toHaveLength(2);
  // RED 期断言收窄:sourceScript 为批3 GREEN 将新增的条目可选字段(裁定⑤),
  // StoryboardItem 类型尚无该键——不收窄则 tsc 先红,盖过行为红因。
  for (const item of items as Array<{ sourceScript?: { entryId: string; updatedAt: number } }>) {
    expect(item.sourceScript).toEqual({ entryId: "work-draft-001", updatedAt: 42 });
  }
});


describe("explicit production scene association", () => {
  const semantic = JSON.stringify({ sceneViewpointId: "room", personFree: true, visibleCharacters: [], visibleProps: [], actionIn: "静止", actionOut: "静止" });
  const row = (index: number, location: string) => `| ${index} | 空房 | ${location} | [] | 10 | 中景 | 静止 | 静止 | — | — | 平静 | 无台词 | 无 | [] | ${semantic} |`;
  const parse = () => parseStoryboardTable([
    "## 场4：金水塾馆入馆", row(1, "金水塾馆"),
    "## 场5：金水塾馆点验", row(2, "金水塾馆"),
    "## 场6：悦来客栈最里间", row(3, "悦来客栈最里间"),
  ].join("\n"), "chapter-001");

  it("uses explicit 15-column headings for same-location Sc4/Sc5 and final Sc6", () => {
    const result = parse();
    expect(result.errors).toEqual([]);
    expect(result.rows.map(item => item.sceneIndex)).toEqual([4, 5, 6]);
    expect(result.rows.map(item => item.scene)).toEqual(["金水塾馆", "金水塾馆", "悦来客栈最里间"]);
  });

  it("carries only explicit production scene identity through conversion and shard reload", () => {
    const items = toStoryboardItems(parse().rows, "chapter-001", []);
    const expected = [
      { index: 4, name: "金水塾馆入馆" }, { index: 5, name: "金水塾馆点验" }, { index: 6, name: "悦来客栈最里间" },
    ];
    expect(items.map(item => item.sourceEvidence)).toEqual(expected.map(scene => ({ source: "storyboard-table", scene })));
    const shards = planStudioWorkflowShards(JSON.stringify({ state: { storyboards: items }, version: 11 }));
    const restored = mergeStudioWorkflowShards(shards.files.map(file => file.content));
    expect(restored.state.storyboards).toEqual(JSON.parse(JSON.stringify(items)));
  });

  it("preserves explicit scene index and heading name through canonical Markdown roundtrip", () => {
    const original = toStoryboardItems(parse().rows, "chapter-001", []);
    const serialized = serializeStoryboardTable(original.slice().reverse());
    const reparsed = parseStoryboardTable(serialized, "chapter-001", { requireShotSemantics: true });
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.rows.map(item => item.sceneIndex)).toEqual([4, 5, 6]);
    expect(reparsed.rows.map(item => item.scene)).toEqual([
      "金水塾馆入馆", "金水塾馆点验", "悦来客栈最里间",
    ]);
    expect(toStoryboardItems(reparsed.rows, "chapter-001", []).map(item => item.sourceEvidence))
      .toEqual(original.map(item => item.sourceEvidence));
  });

  it("does not inherit explicit scene evidence onto an interleaved legacy item", () => {
    const original = toStoryboardItems(parse().rows, "chapter-001", []);
    original[1] = { ...original[1]!, sourceEvidence: undefined };
    const serialized = serializeStoryboardTable(original);
    const reparsed = parseStoryboardTable(serialized, "chapter-001", { requireShotSemantics: true });
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.rows.map(item => item.sourceEvidence)).toEqual(original.map(item => item.sourceEvidence));
    expect(reparsed.rows[1]?.scene).toBe(original[1]?.trackKey);
  });

  it("keeps unheaded legacy serialization free of invented production scene headings", () => {
    const original = toStoryboardItems(parseStoryboardTable(row(1, "金水塾馆"), "chapter-001").rows, "chapter-001", []);
    const serialized = serializeStoryboardTable(original);
    const reparsed = parseStoryboardTable(serialized, "chapter-001", { requireShotSemantics: true });
    expect(serialized).not.toContain("## 场");
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.rows[0]?.scene).toBe(original[0]?.trackKey);
    expect(reparsed.rows[0]?.sourceEvidence).toBeUndefined();
  });

  it("preserves unheaded legacy location deduplication without inventing editorial scenes", () => {
    const parsed = parseStoryboardTable([row(1, "金水塾馆"), row(2, "金水塾馆"), row(3, "客栈")].join("\n"), "chapter-001");
    expect(parsed.rows.map(item => item.sceneIndex)).toEqual([1, 1, 2]);
    expect(toStoryboardItems(parsed.rows, "chapter-001", []).every(item => item.sourceEvidence === undefined)).toBe(true);
  });

  it("clears previous evidence when fresh generated unheaded rows replace old shots", () => {
    const fresh = toStoryboardItems(parseStoryboardTable(row(1, "金水塾馆"), "chapter-001").rows, "chapter-001", []);
    const old: StoryboardItem = { ...fresh[0]!, sourceEvidence: { source: "old-import", sourcePath: "old/source.md" } };
    const state = { storyboards: [old], continuityAssetVersions: [], updateStoryboard: () => {}, rebuildTracks: () => {}, startMediaTask: () => "task", finishMediaTask: () => {} };
    const actions = createStoryboardSliceActions(
      update => Object.assign(state, typeof update === "function" ? update(state) : update),
      () => state,
    );
    actions.replaceStoryboardsForEpisode("chapter-001", fresh);
    expect(state.storyboards[0]?.sourceEvidence).toBeUndefined();
  });

  it("includes explicit scene identity in source fingerprints and invalidates previous media", () => {
    const items = toStoryboardItems(parse().rows, "chapter-001", []);
    const first = { ...items[0]!, sourceEvidence: { source: "storyboard-table", scene: { index: 4, name: "金水塾馆入馆" } } };
    const next = { ...first, sourceEvidence: { source: "storyboard-table", scene: { index: 5, name: "金水塾馆点验" } } };
    expect(storyboardSourceFingerprint(first)).not.toBe(storyboardSourceFingerprint(next));
    const state = { storyboards: [{ ...first, mediaRef: { kind: "image" as const, path: "project-file://old.png" }, sourceFingerprint: storyboardSourceFingerprint(first) }], continuityAssetVersions: [], updateStoryboard: () => {}, rebuildTracks: () => {}, startMediaTask: () => "task", finishMediaTask: () => {} };
    const actions = createStoryboardSliceActions(
      update => Object.assign(state, typeof update === "function" ? update(state) : update),
      () => state,
    );
    actions.replaceStoryboardsForEpisode("chapter-001", [next]);
    expect(state.storyboards[0]?.stale).toBe(true);
    expect(state.storyboards[0]?.sourceEvidence).toEqual(next.sourceEvidence);
  });
});


it("keeps mixed raw lines, canonical utterances and original nineteen shot IDs", () => {
  const rows = Array.from({ length: 19 }, (_, i) => ({ index: i + 1, description: "雨夜。", scene: "门外", associateAssetsNames: [], shotSize: "中景", cameraMove: "固定", orientation: "正面", spatialRelation: "门外", emotion: "平静", sound: "雨声", action: "望向门口", duration: 10, lines: "旁白：风起。\n独孤剑尘：借灯。", associateAssetsIds: [] }));
  const result = toStoryboardItems(rows, "chapter-001", [{ characterId: "dugu", name: "独孤剑尘", aliases: [] }]);
  expect(result.map(s => s.id)).toEqual(rows.map(r => `sb-chapter-001-${String(r.index).padStart(3, "0")}`));
  expect(result[0].lines).toBe(rows[0].lines);
  expect(result[0].speechUtterances?.map(p => p.speakerId)).toEqual(["narrator", "character:dugu"]);
  expect(result[0].ttsSpokenText).toBe("风起。 借灯。");
});
