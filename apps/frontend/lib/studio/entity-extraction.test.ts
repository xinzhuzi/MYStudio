import { describe, expect, it } from "vitest";
import {
  buildEntityExtractionMessages,
  parseEntityExtraction,
  dedupeEntities,
  type KnownEntity,
} from "./entity-extraction";

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
});
