import { describe, expect, it } from "vitest";
import {
  APPEARANCE_INDEX_RELATIVE_PATH,
  DEFAULT_KNOWN_LIST_RECENT_CHAPTERS,
  DEFAULT_KNOWN_LIST_LIMIT,
  appearanceKey,
  buildKnownEntityList,
  chapterNumberFromId,
  isPromotedForLibrary,
  mergeChapterAppearances,
  parseAppearanceIndex,
  serializeAppearanceIndex,
  type AppearanceRecordInput,
  type EntityAppearanceIndex,
} from "./entity-appearances";

function rec(
  kind: AppearanceRecordInput["kind"],
  name: string,
  aliases: string[] = [],
  importance?: AppearanceRecordInput["importance"],
): AppearanceRecordInput {
  return { kind, name, aliases, ...(importance ? { importance } : {}) };
}

describe("entity-appearances · 键与路径", () => {
  it("appearanceKey = kind:normalizeName(全半角/大小写/空白归一)", () => {
    expect(appearanceKey("character", "赵四")).toBe("character:赵四");
    expect(appearanceKey("character", " ＺｈａｏＳｉ ")).toBe("character:zhaosi");
    expect(appearanceKey("scene", "悦来客栈")).not.toBe(appearanceKey("prop", "悦来客栈"));
  });

  it("chapterNumberFromId 提取章号(999/1000 边界)", () => {
    expect(chapterNumberFromId("chapter-002")).toBe(2);
    expect(chapterNumberFromId("chapter-999")).toBe(999);
    expect(chapterNumberFromId("chapter-4125")).toBe(4125);
  });

  it("索引家=store/extraction/entity-appearances.json,不在 studio-workflow/ 孤儿清理辖区(D18/AC15)", () => {
    expect(APPEARANCE_INDEX_RELATIVE_PATH).toBe("store/extraction/entity-appearances.json");
    expect(APPEARANCE_INDEX_RELATIVE_PATH.startsWith("store/studio-workflow/")).toBe(false);
  });
});

describe("entity-appearances · 章合并与幂等(AC6)", () => {
  it("首章合并建条目:firstChapterId/chapterIds/aliases/importance 各就位", () => {
    const index = mergeChapterAppearances({}, "chapter-002", [
      rec("character", "陈九", ["九爷"], "protagonist"),
      rec("scene", "道口镇"),
      rec("prop", "断剑", ["残剑"]),
    ]);
    expect(index["character:陈九"]).toMatchObject({
      kind: "character",
      name: "陈九",
      aliases: ["九爷"],
      importance: "protagonist",
      firstChapterId: "chapter-002",
      chapterIds: ["chapter-002"],
    });
    expect(index["scene:道口镇"]).toMatchObject({ kind: "scene", name: "道口镇" });
    expect(index["prop:断剑"].aliases).toEqual(["残剑"]);
  });

  it("重提同章幂等:同章同数据合两次,索引深度全等(AC6)", () => {
    const records = [rec("character", "陈九", ["九爷"], "supporting")];
    const once = mergeChapterAppearances({}, "chapter-002", records);
    const twice = mergeChapterAppearances(once, "chapter-002", records);
    expect(twice).toEqual(once);
    expect(twice["character:陈九"].chapterIds).toEqual(["chapter-002"]);
  });

  it("后续章累积:chapterIds 集合增长,首次出场章不被覆盖(AC11 正向)", () => {
    let index = mergeChapterAppearances({}, "chapter-002", [rec("character", "赵四")]);
    index = mergeChapterAppearances(index, "chapter-005", [rec("character", "赵四")]);
    const entry = index["character:赵四"]!;
    expect(entry.chapterIds).toEqual(["chapter-002", "chapter-005"]);
    expect(entry.firstChapterId).toBe("chapter-002");
  });

  it("后处理更早章:firstChapterId 纠正为真实首次(数字最小章)", () => {
    let index = mergeChapterAppearances({}, "chapter-005", [rec("character", "赵四")]);
    index = mergeChapterAppearances(index, "chapter-002", [rec("character", "赵四")]);
    expect(index["character:赵四"].firstChapterId).toBe("chapter-002");
    expect(index["character:赵四"].chapterIds).toEqual(["chapter-002", "chapter-005"]);
  });

  it("chapterIds 按章号数字排序(999/1000 边界不乱序)", () => {
    let index = mergeChapterAppearances({}, "chapter-1000", [rec("character", "甲")]);
    index = mergeChapterAppearances(index, "chapter-999", [rec("character", "甲")]);
    expect(index["character:甲"].chapterIds).toEqual(["chapter-999", "chapter-1000"]);
  });

  it("importance 幂等合并取最高档:npc→protagonist 升档,再遇 supporting 不降档", () => {
    let index = mergeChapterAppearances({}, "chapter-001", [rec("character", "乙", [], "npc")]);
    expect(index["character:乙"].importance).toBe("npc");
    index = mergeChapterAppearances(index, "chapter-003", [rec("character", "乙", [], "protagonist")]);
    expect(index["character:乙"].importance).toBe("protagonist");
    index = mergeChapterAppearances(index, "chapter-004", [rec("character", "乙", [], "supporting")]);
    expect(index["character:乙"].importance).toBe("protagonist");
  });

  it("aliases 跨章并集,重复 token 去重,自身规范名不进别名", () => {
    let index = mergeChapterAppearances({}, "chapter-001", [
      rec("character", "赵四", ["四哥", "赵四"]),
    ]);
    index = mergeChapterAppearances(index, "chapter-002", [
      rec("character", "赵四", ["四哥", "赵老四"]),
    ]);
    expect(index["character:赵四"].aliases).toEqual(["四哥", "赵老四"]);
  });
});

describe("entity-appearances · 别名跨章归并闭合(AC13,「监工赵四↔赵四」形态)", () => {
  it("第2章以别名命中第1章条目 → 并入同一索引条目,chapterIds=2 → 晋升=单库条目", () => {
    let index = mergeChapterAppearances({}, "chapter-001", [
      rec("character", "赵四"),
    ]);
    // 第2章模型主名用「监工赵四」、别名含「赵四」——record 的别名命中既有条目名
    index = mergeChapterAppearances(index, "chapter-002", [
      rec("character", "监工赵四", ["赵四"]),
    ]);

    const keys = Object.keys(index).filter((key) => key.startsWith("character:"));
    expect(keys).toEqual(["character:赵四"]);
    const entry = index["character:赵四"]!;
    expect(entry.aliases).toContain("监工赵四");
    expect(entry.chapterIds).toEqual(["chapter-001", "chapter-002"]);
    // 不重复建库:单条目 + 晋升(≥2 章)→ 三库只会拿到一个实体
    expect(isPromotedForLibrary(entry)).toBe(true);
  });

  it("反向形态:首章主名「监工赵四」,次章主名「赵四」也并入同条目", () => {
    let index = mergeChapterAppearances({}, "chapter-001", [
      rec("character", "监工赵四", ["赵四"]),
    ]);
    index = mergeChapterAppearances(index, "chapter-002", [rec("character", "赵四")]);
    const keys = Object.keys(index).filter((key) => key.startsWith("character:"));
    expect(keys).toEqual(["character:监工赵四"]);
    expect(index["character:监工赵四"].chapterIds).toEqual(["chapter-001", "chapter-002"]);
  });

  it("kind 隔离:同名不同 kind 不并(character:甲 ≠ prop:甲)", () => {
    let index = mergeChapterAppearances({}, "chapter-001", [rec("character", "甲")]);
    index = mergeChapterAppearances(index, "chapter-002", [rec("prop", "甲")]);
    expect(Object.keys(index).sort()).toEqual(["character:甲", "prop:甲"]);
  });
});

describe("entity-appearances · 晋升判定(AC7:三条件各一正一反)", () => {
  const single = mergeChapterAppearances({}, "chapter-001", [rec("character", "甲")])[
    "character:甲"
  ]!;

  it("条件一 chapterIds≥2:正=两章;反=单章无重要度不在库", () => {
    const twoChapters = mergeChapterAppearances(
      mergeChapterAppearances({}, "chapter-001", [rec("character", "乙")]),
      "chapter-002",
      [rec("character", "乙")],
    )["character:乙"]!;
    expect(isPromotedForLibrary(twoChapters)).toBe(true);
    expect(isPromotedForLibrary(single)).toBe(false);
  });

  it("条件二 importance=protagonist:正=protagonist;反=supporting", () => {
    const prot = mergeChapterAppearances({}, "chapter-009", [
      rec("character", "丙", [], "protagonist"),
    ])["character:丙"]!;
    const supp = mergeChapterAppearances({}, "chapter-009", [
      rec("character", "丁", [], "supporting"),
    ])["character:丁"]!;
    expect(isPromotedForLibrary(prot)).toBe(true);
    expect(isPromotedForLibrary(supp)).toBe(false);
  });

  it("条件三 已在三库:正=库键命中(名或别名);反=未命中", () => {
    const withAlias = mergeChapterAppearances({}, "chapter-001", [
      rec("character", "戊", ["老戊"]),
    ])["character:戊"]!;
    const libraryKeys = new Set(["character:老戊"]); // 库里以别名登记
    expect(isPromotedForLibrary(withAlias, { libraryKeys })).toBe(true);
    expect(isPromotedForLibrary(single, { libraryKeys })).toBe(false);
  });
});

describe("entity-appearances · 已知实体清单控长(AC5,D4/D23)", () => {
  function buildDenseIndex(): EntityAppearanceIndex {
    let index: EntityAppearanceIndex = {};
    // 第 990 章(近30章窗口内)出现 250 个角色(编号 padding 保证键唯一)
    for (let i = 1; i <= 250; i += 1) {
      index = mergeChapterAppearances(index, "chapter-990", [
        rec("character", `角色${String(i).padStart(3, "0")}`),
      ]);
    }
    return index;
  }

  it("默认窗口=近30章、上限=200(常量锚)", () => {
    expect(DEFAULT_KNOWN_LIST_RECENT_CHAPTERS).toBe(30);
    expect(DEFAULT_KNOWN_LIST_LIMIT).toBe(200);
  });

  it("250 条候选截至 200,按最近出场排序截断(AC5)", () => {
    let index = buildDenseIndex();
    // 角色001 最近一次出现在 chapter-995(更近),应排前并在截断存活;
    // 角色250 只在 chapter-990,最旧,应被 200 上限截掉
    index = mergeChapterAppearances(index, "chapter-995", [rec("character", "角色001")]);

    const list = buildKnownEntityList(index, { currentChapterNumber: 1000 });
    expect(list).toHaveLength(200);
    expect(list[0]?.name).toBe("角色001");
    expect(list.some((item) => item.name === "角色250")).toBe(false);
  });

  it("窗口外旧章实体不进清单,protagonist 例外(D23:importance 真源=索引非三库)", () => {
    let index: EntityAppearanceIndex = {};
    // 第 5 章(远超近30章窗口)出现的普通角色与主角
    index = mergeChapterAppearances(index, "chapter-005", [
      rec("character", "远古配角"),
      rec("character", "远古主角", [], "protagonist"),
    ]);
    // 第 990 章(窗口内)出现的普通角色
    index = mergeChapterAppearances(index, "chapter-990", [rec("character", "近期角色")]);

    const list = buildKnownEntityList(index, { currentChapterNumber: 1000 });
    const names = list.map((item) => item.name);
    expect(names).toContain("近期角色");
    expect(names).toContain("远古主角");
    expect(names).not.toContain("远古配角");
  });

  it("清单条目携带索引 aliases 并集(供 dedupeEntities 跨轮匹配面)", () => {
    let index: EntityAppearanceIndex = {};
    index = mergeChapterAppearances(index, "chapter-990", [
      rec("character", "赵四", ["监工赵四", "四哥"]),
    ]);
    const list = buildKnownEntityList(index, { currentChapterNumber: 1000 });
    expect(list).toEqual([
      { kind: "character", name: "赵四", aliases: ["监工赵四", "四哥"] },
    ]);
  });

  it("窗口内∪protagonist 按 key 去重(同一实体只一条)", () => {
    let index: EntityAppearanceIndex = {};
    index = mergeChapterAppearances(index, "chapter-995", [rec("character", "甲", [], "protagonist")]);
    const list = buildKnownEntityList(index, { currentChapterNumber: 1000 });
    expect(list.filter((item) => item.name === "甲")).toHaveLength(1);
  });
});

describe("entity-appearances · 序列化", () => {
  it("serialize→parse 往返全等;键排序稳定;非法 JSON→空索引", () => {
    let index = mergeChapterAppearances({}, "chapter-002", [
      rec("character", "陈九", ["九爷"], "protagonist"),
    ]);
    index = mergeChapterAppearances(index, "chapter-003", [rec("scene", "道口镇")]);

    const parsed = parseAppearanceIndex(serializeAppearanceIndex(index));
    expect(parsed).toEqual(index);
    expect(serializeAppearanceIndex(index)).toBe(serializeAppearanceIndex(parsed!));
    expect(parseAppearanceIndex("{oops")).toEqual({});
    expect(parseAppearanceIndex("")).toEqual({});
  });
});
