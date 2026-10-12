import { describe, expect, it } from "vitest";
import {
  buildEntityExtractionMessages,
  parseAliasesFromNotes,
  parseEntityExtraction,
  dedupeEntities,
  type KnownEntity,
} from "./entity-extraction";
import { parseAssetNames } from "./asset-names";

describe("studio entity extraction parsing", () => {
  it("parses character/scene/prop rows, skips fences/headers/separators/blank, collects illegal rows", () => {
    const output = [
      "```",
      "| 类型 | 名称 | 别名 | 集 | 备注 |",
      "| --- | --- | --- | --- | --- |",
      "| character | 小红 | 红儿、阿红 | ep1,ep2 | 女主 |",
      "| scene | 咖啡厅 |  |  | 黄昏 |",
      "| prop | 账册 | 旧账本 | ep2 |  |",
      "| character |  | 无名 | ep1 |  |",
      "",
      "```",
    ].join("\n");

    const { entities, errors } = parseEntityExtraction(output, "ep0");

    expect(entities).toHaveLength(3);
    expect(entities[0]).toMatchObject({
      kind: "character",
      name: "小红",
      aliases: ["红儿", "阿红"],
      episodeIds: ["ep1", "ep2"],
      note: "女主",
    });
    expect(entities[1]).toMatchObject({
      kind: "scene",
      name: "咖啡厅",
      aliases: [],
      episodeIds: ["ep0"],
      note: "黄昏",
    });
    expect(entities[2]).toMatchObject({
      kind: "prop",
      name: "账册",
      aliases: ["旧账本"],
      episodeIds: ["ep2"],
    });
    expect(entities[2]?.note).toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("parses semicolon secondary names from the entity name column", () => {
    const { entities } = parseEntityExtraction(
      "| prop | 铜钱;铜币;古钱 | 孔方兄 | ep1 | 圆形方孔钱 |",
      "ep0",
    );

    expect(entities[0]).toMatchObject({
      kind: "prop",
      name: "铜钱",
      aliases: ["铜币", "古钱", "孔方兄"],
    });
  });
});

describe("studio entity dedup", () => {
  it("merges duplicates by name/alias overlap, reuses known ids, unions episodes, normalizes width/case", () => {
    const extracted = [
      { kind: "character" as const, name: "小红", aliases: ["红儿"], episodeIds: ["ep1"] },
      { kind: "character" as const, name: "红儿", aliases: [], episodeIds: ["ep2"] },
      { kind: "character" as const, name: "Jack", aliases: [], episodeIds: ["ep3"] },
      { kind: "character" as const, name: "小明", aliases: [], episodeIds: ["ep1"] },
      { kind: "scene" as const, name: "咖啡厅", aliases: [], episodeIds: ["ep1"] },
    ];
    const known: KnownEntity[] = [
      { id: "char-001", kind: "character", name: "小明", aliases: [] },
      { id: "char-jack", kind: "character", name: "Ｊａｃｋ", aliases: [] },
    ];

    const { entities } = dedupeEntities(extracted, known);

    const xiaohong = entities.find((item) => item.name === "小红");
    expect(xiaohong?.id).toBeNull();
    expect(xiaohong?.isNew).toBe(true);
    expect(xiaohong?.aliases).toContain("红儿");
    expect([...(xiaohong?.episodeIds ?? [])].sort()).toEqual(["ep1", "ep2"]);

    const xiaoming = entities.find((item) => item.name === "小明");
    expect(xiaoming?.id).toBe("char-001");
    expect(xiaoming?.isNew).toBe(false);

    const jack = entities.find((item) => item.kind === "character" && item.id === "char-jack");
    expect(jack?.isNew).toBe(false);

    const cafe = entities.find((item) => item.kind === "scene");
    expect(cafe?.isNew).toBe(true);

    // 小红 + 红儿 collapse to one character entity; 小明, Jack stay distinct → 4 characters? no: 3 chars + 1 scene
    expect(entities.filter((item) => item.kind === "character")).toHaveLength(3);
  });

  it("unions known aliases into the matched entity and keeps the cross-round loop closed (攻4 安全版 filter)", () => {
    // 主场景:模型主名「赵四」≠ 库规范名「监工赵四」,靠库别名命中——并集后主名保留在
    // 别名列(跨轮闭合锁:写回 notes 后第二轮解析仍含赵四,不会重复建库)
    const extracted = [
      { kind: "character" as const, name: "赵四", aliases: ["赵四"], episodeIds: ["ep1"] },
    ];
    const known: KnownEntity[] = [
      { id: "char-001", kind: "character", name: "监工赵四", aliases: ["监工", "监工老爷", "赵四"] },
    ];

    const { entities } = dedupeEntities(extracted, known);

    const merged = entities[0]!;
    expect(merged.id).toBe("char-001");
    expect(merged.isNew).toBe(false);
    expect(merged.aliases).toEqual(["赵四", "监工", "监工老爷"]);
    // 第二轮闭环:notes 写回「别名：赵四、监工、监工老爷」→ 守门解析仍含赵四
    expect(parseAliasesFromNotes(`别名：${merged.aliases.join("、")}`)).toContain("赵四");
  });

  it("filters the library canonical-name token from aliases when the model main name equals it", () => {
    const extracted = [
      { kind: "prop" as const, name: "归元断剑", aliases: ["归元古剑", "断剑"], episodeIds: ["ep1"] },
    ];
    const known: KnownEntity[] = [
      { id: "prop-001", kind: "prop", name: "归元断剑", aliases: ["归元古剑", "归元剑", "断剑", "归元断剑"] },
    ];

    const { entities } = dedupeEntities(extracted, known);

    const merged = entities[0]!;
    expect(merged.id).toBe("prop-001");
    // 匹配面经 name 字段保留;与库规范名同归一的冗余 token 从别名列滤除
    expect(merged.name).toBe("归元断剑");
    expect(merged.aliases).toEqual(["归元古剑", "断剑", "归元剑"]);
  });
});

describe("parseAliasesFromNotes", () => {
  it("parses 顿号-separated aliases from the first 别名： line", () => {
    expect(parseAliasesFromNotes("别名：监工、监工老爷、赵四")).toEqual(["监工", "监工老爷", "赵四"]);
    // 对照锁死回归防照抄事件分析半坏写法:parseAssetNames 拆不开顿号(整串 1 名)
    expect(parseAssetNames("监工、监工老爷、赵四").allNames).toEqual(["监工、监工老爷、赵四"]);
  });

  it("guards to the first line and strips trailing punctuation (攻2)", () => {
    // 多行混合:只认首行「别名：」,不把备注行拆成假别名
    expect(parseAliasesFromNotes("别名：赵四、监工\n备注：码头监工，持鞭")).toEqual(["赵四", "监工"]);
    // 句号尾:剥净后才可能经 normalizeName 命中
    expect(parseAliasesFromNotes("别名：赵四。")).toEqual(["赵四"]);
  });

  it("returns [] for descriptive notes and empty input (守门)", () => {
    expect(parseAliasesFromNotes("码头监工，持青盐鞭，克扣矿奴口粮")).toEqual([]);
    expect(parseAliasesFromNotes(undefined)).toEqual([]);
    expect(parseAliasesFromNotes("")).toEqual([]);
  });
});

describe("studio entity extraction messages", () => {
  it("includes a stable pipe output spec and embeds script text plus known entities", () => {
    const messages = buildEntityExtractionMessages({
      episodeId: "ep1",
      scriptText: "小红走进咖啡厅，掏出账册。",
      knownEntities: [{ id: "char-001", kind: "character", name: "小明", aliases: ["阿明"] }],
    });

    expect(messages.system).toContain("character | scene | prop");
    expect(messages.system).toContain("主名字;副名字1;副名字2");
    expect(messages.user).toContain("小红走进咖啡厅");
    expect(messages.user).toContain("小明");
  });

  it("injects the source bible before the known-entities block when provided", () => {
    const withBible = buildEntityExtractionMessages({
      episodeId: "ep1",
      scriptText: "小红走进咖啡厅。",
      bibleContext: "# 原著圣经（最高优先级·人物一律用此表规范名）\n\n## 主要人物\n- 小红（阿红）：主角",
    });
    expect(withBible.user).toContain("原著圣经（最高优先级");
    expect(withBible.user.indexOf("原著圣经")).toBeLessThan(withBible.user.indexOf("已知实体"));

    const withoutBible = buildEntityExtractionMessages({
      episodeId: "ep1",
      scriptText: "小红走进咖啡厅。",
    });
    expect(withoutBible.user).not.toContain("原著圣经");
  });

  it("renders known entities without the reuse-ID tail and teaches 全量输出/主名钉库名 (RC-1)", () => {
    const messages = buildEntityExtractionMessages({
      episodeId: "ep1",
      scriptText: "小红走进咖啡厅。",
      knownEntities: [{ id: "char-001", kind: "character", name: "小明", aliases: ["阿明"] }],
    });

    // knownBlock 渲染名+别名但无「→ 复用ID」尾串(revision-3 note 前缀回声源已除);
    // 标题文案「系统会自动按名称/别名去重复用ID」本身含该子串,故锁尾串形态与 ID 值
    expect(messages.user).toContain("小明");
    expect(messages.user).toContain("阿明");
    expect(messages.user).not.toContain("→ 复用ID");
    expect(messages.user).not.toContain("char-001");
    expect(messages.user).not.toContain("勿重复新建");
    // 全量输出指令与主名优先用清单库名(攻1 手册层配套文案)
    expect(messages.user).toContain("剧本中出场的实体无论是否在下列清单中都必须输出一行");
    expect(messages.user).toContain("主名优先用清单中的名称");
    // system 覆盖条款
    expect(messages.system).toContain("宁多勿漏");
    expect(messages.system).toContain("角色以每场「人物：」行、场景以每个场次标题为核对基准");
  });

  it("injects the script hints block only when hints carry names (向后兼容回归)", () => {
    const withHints = buildEntityExtractionMessages({
      episodeId: "ep1",
      scriptText: "剧本正文……",
      scriptHints: { characters: ["赵四"], scenes: ["金水河码头"] },
    });

    expect(withHints.user).toContain("剧本自报实体清单");
    expect(withHints.user).toContain("金水河码头");
    expect(withHints.user).toContain("赵四");
    expect(withHints.user).toContain("群演可跳过");
    // 注入位置:已知实体块之后、剧本正文之前
    expect(withHints.user.indexOf("已知实体")).toBeLessThan(withHints.user.indexOf("剧本自报实体清单"));
    expect(withHints.user.indexOf("剧本自报实体清单")).toBeLessThan(withHints.user.indexOf("剧本正文："));

    const emptyHints = buildEntityExtractionMessages({
      episodeId: "ep1",
      scriptText: "剧本正文……",
      scriptHints: { characters: [], scenes: [] },
    });
    expect(emptyHints.user).not.toContain("剧本自报实体清单");

    const noHints = buildEntityExtractionMessages({
      episodeId: "ep1",
      scriptText: "剧本正文……",
    });
    expect(noHints.user).not.toContain("剧本自报实体清单");
  });
});
