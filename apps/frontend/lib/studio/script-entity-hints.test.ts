import { describe, expect, it } from "vitest";
import {
  diffScriptEntityHints,
  extractScriptEntityHints,
  formatHintGapList,
} from "./script-entity-hints";
import type { ExtractedEntity } from "./entity-extraction";

// fixture=道劫第1章剧本正文完整骨架(场头×5、人物行×5、台词/OS/V.S. 行、改编追踪表格),
// 形态取自真实剧本(entity-extractions-001-214f7a80.json 内嵌 scriptText)
const DAOJIE_CH1_SCRIPT = `# 道劫 EP01：断剑为谁而鸣
# 范围与目标：全章改编（码头—当铺—夜课—测灵根—客栈夜） | 时长：3分钟
# 已确定要求：水墨国风修仙画风 / 16:9横屏 / 中文对白

---

## 剧情梗概

灰雾锁住金水河码头，矿奴扛着灵矿挨盐鞭。

---

[淡入]

**1-1 金水河码头 夜/外 ·约40秒**
人物：独孤剑尘 赵四 小杂役 苦力 众矿奴若干

SFX（阴冷）：铁链拖地声密集成拍

△灰墨般的浓雾压住金水河面

赵四：手脚麻利些。
小杂役：监工老爷开恩，小人捡完这个就搬……
苦力：滚开，瞎了眼么。
OS（独孤剑尘，压抑）：不是每一鞭，都该我挡。

---

[叠化]

**1-2 道口镇当铺前 晨/外 ·约45秒**
人物：独孤剑尘 钱掌柜 断臂散修

△断臂散修用独臂拍打柜台，半株凝血草摊在柜上

断臂散修：钱掌柜，这半株凝血草，
钱掌柜：半钱碎银，爱当不当。不当滚。

---

[硬切]

**1-3 金水塾馆 夜/内 ·约45秒**
人物：独孤剑尘 管事 晏燎 众孩子若干

管事：识字？
独孤剑尘：认几个。

---

[硬切]

**1-4 金水塾馆·测灵根 夜/内 ·约30秒**
人物：独孤剑尘 晏燎 管事 众孩子若干

△管事攥着碎灵石，从第一排开始搁在孩子掌心
管事：晏燎，到你了。
管事：灵根驳杂。

---

[硬切]

**1-5 客栈最里间 夜/内 ·约20秒**
人物：独孤剑尘 赵四 宗门弟子甲（画外音）

△赵四抱着青盐鞭立着，把他从头到脚打量了一遍

V.S.（宗门弟子甲，画外，轻佻）：这道口镇的灵矿产量又涨了，
OS（独孤剑尘，低沉）：可归元剑锋所指——正是晏燎。

[淡出]

---

## 改编追踪

| 原文位置 | 是否采用 | 视听表达 | 待确认 |
|----------|----------|----------|--------|
| 码头夜：矿奴/铁链计数/青盐鞭刑/赵四台词 | 采用 | 1-1场冷开场，鞭刑+威胁台词直入冲突 | |
| 苦力撞肩+倒刺矿石+草鞋滑半寸避开 | 采用 | 1-1场△4 | |
| 塾馆代课：管事问答/断笔/吐纳口诀 | 采用 | 1-3场；删「呼气时嘴微张」口诀 | |
`;

describe("extractScriptEntityHints", () => {
  it("collects scene titles with time/interior suffix stripped and · sub-areas merged", () => {
    const hints = extractScriptEntityHints(DAOJIE_CH1_SCRIPT);

    // 同主地点「金水塾馆·测灵根」归并为「金水塾馆」;「·约N秒」与「时间/内外」剥净;
    // 改编追踪表格行词(「码头夜」「塾馆代课」)不混入
    expect(hints.scenes).toEqual(["金水河码头", "道口镇当铺前", "金水塾馆", "客栈最里间"]);
  });

  it("collects named cast members, strips parentheticals, filters collective suffixes", () => {
    const hints = extractScriptEntityHints(DAOJIE_CH1_SCRIPT);

    // 9 具名者:「宗门弟子甲（画外音）」剥尾括注;「众矿奴若干/众孩子若干」被滤
    expect(hints.characters).toEqual([
      "独孤剑尘",
      "赵四",
      "小杂役",
      "苦力",
      "钱掌柜",
      "断臂散修",
      "管事",
      "晏燎",
      "宗门弟子甲",
    ]);
  });

  it("keeps the scene visible (with suffix intact) for the no-space time-suffix variant", () => {
    // 无空格尾标变体:剥空回退未剥 title,该场不静默消失
    const hints = extractScriptEntityHints("**1-1 金水河码头夜/外 ·约40秒**\n人物：独孤剑尘\n");
    expect(hints.scenes).toEqual(["金水河码头夜/外"]);
  });

  it("supports bare (non-bold) scene headers from the rewritten script format", () => {
    // 重写后剧本(镜头N:人话格式)场头无 ** 粗体包裹,形态取自真机实弹批次
    // (entity-extractions-001-86b61189.json 内嵌 scriptText):「1-1 金水河码头 晨/外 ·约50秒」
    const hints = extractScriptEntityHints("1-1 金水河码头 晨/外 ·约50秒\n人物：独孤剑尘 铁山 钱掌柜\n");
    expect(hints.scenes).toEqual(["金水河码头"]);
    expect(hints.characters).toEqual(["独孤剑尘", "铁山", "钱掌柜"]);
  });

  it("returns double-empty arrays for empty or non-scene text without throwing", () => {
    expect(extractScriptEntityHints("")).toEqual({ characters: [], scenes: [] });
    expect(extractScriptEntityHints("这是一段没有任何场次标注的小说正文。小红走进咖啡厅。")).toEqual({
      characters: [],
      scenes: [],
    });
  });
});

describe("diffScriptEntityHints", () => {
  const hints = extractScriptEntityHints(DAOJIE_CH1_SCRIPT);

  it("reports the revision-3 gap: 钱掌柜 covered by 掌柜 containment, all 4 scenes missing", () => {
    // revision-3 实况批次:角色 4(掌柜/断臂散修/铁山/独孤剑尘)+ 道具 1,场景 0
    const extracted: ExtractedEntity[] = [
      { kind: "character", name: "掌柜", aliases: [], episodeIds: ["ep1"] },
      { kind: "character", name: "断臂散修", aliases: [], episodeIds: ["ep1"] },
      { kind: "character", name: "铁山", aliases: [], episodeIds: ["ep1"] },
      { kind: "character", name: "独孤剑尘", aliases: [], episodeIds: ["ep1"] },
      { kind: "prop", name: "凝血草", aliases: [], episodeIds: ["ep1"] },
    ];

    const diff = diffScriptEntityHints(hints, extracted);

    // 「掌柜」⊂「钱掌柜」且较短一方 2 字 → 覆盖,不报缺
    expect(diff.missingCharacters).not.toContain("钱掌柜");
    for (const name of ["晏燎", "赵四", "管事", "小杂役", "苦力", "宗门弟子甲"]) {
      expect(diff.missingCharacters).toContain(name);
    }
    expect(diff.missingScenes).toEqual(["金水河码头", "道口镇当铺前", "金水塾馆", "客栈最里间"]);
  });

  it("returns double-empty diff against the full entity set (zero false alarms)", () => {
    const full: ExtractedEntity[] = [
      ...hints.characters.map(
        (name): ExtractedEntity => ({ kind: "character", name, aliases: [], episodeIds: ["ep1"] }),
      ),
      ...hints.scenes.map(
        (name): ExtractedEntity => ({ kind: "scene", name, aliases: [], episodeIds: ["ep1"] }),
      ),
    ];
    expect(diffScriptEntityHints(hints, full)).toEqual({
      missingCharacters: [],
      missingScenes: [],
      extraCharacters: [],
      extraScenes: [],
      suspectBorrowedNames: [],
      suspectVariantNames: [],
    });
  });

  it("still reports 晏燎 missing when only the single-char alias 晏 is output (≥2-char gate)", () => {
    // 单字别名不得覆盖:输出带别名「晏」时,提示「晏燎」仍报缺
    const extracted: ExtractedEntity[] = [
      { kind: "character", name: "神秘少年", aliases: ["晏"], episodeIds: ["ep1"] },
    ];
    const diff = diffScriptEntityHints({ characters: ["晏燎"], scenes: [] }, extracted);
    expect(diff.missingCharacters).toEqual(["晏燎"]);
  });

  it("flags 丫头 (装机复发) as extra: name and alias both miss the cast list", () => {
    // 1013 装机实弹:模型自撰「丫头(别名:小丫头)」行,人物行无她、零台词——负向断言抓出
    const extracted: ExtractedEntity[] = [
      ...hints.characters.map(
        (name): ExtractedEntity => ({ kind: "character", name, aliases: [], episodeIds: ["ep1"] }),
      ),
      { kind: "character", name: "丫头", aliases: ["小丫头"], episodeIds: ["ep1"] },
    ];
    const diff = diffScriptEntityHints(hints, extracted);
    expect(diff.extraCharacters).toEqual(["丫头"]);
    expect(diff.missingCharacters).toEqual([]);
  });

  it("passes merged rows both directions: 断臂散修(别名:铁山) and 铁山(别名:断臂散修)", () => {
    const byName: ExtractedEntity[] = [
      { kind: "character", name: "断臂散修", aliases: ["铁山"], episodeIds: ["ep1"] },
    ];
    const byAlias: ExtractedEntity[] = [
      { kind: "character", name: "铁山", aliases: ["断臂散修"], episodeIds: ["ep1"] },
    ];
    expect(diffScriptEntityHints(hints, byName).extraCharacters).toEqual([]);
    expect(diffScriptEntityHints(hints, byAlias).extraCharacters).toEqual([]);
  });

  it("enforces scene alias discipline: 悦来客栈 must carry 客栈最里间 as alias to pass", () => {
    // 钉b①要求场次标题全称写别名列——合规行过,裸清单名不写别名的行按疑似多提亮出
    const compliant: ExtractedEntity[] = [
      { kind: "scene", name: "悦来客栈", aliases: ["客栈最里间"], episodeIds: ["ep1"] },
    ];
    const sloppy: ExtractedEntity[] = [
      { kind: "scene", name: "悦来客栈", aliases: [], episodeIds: ["ep1"] },
    ];
    expect(diffScriptEntityHints(hints, compliant).extraScenes).toEqual([]);
    expect(diffScriptEntityHints(hints, sloppy).extraScenes).toEqual(["悦来客栈"]);
  });

  it("flags hallucinated/泛化 scenes (道口镇街巷) not present in any scene header", () => {
    const extracted: ExtractedEntity[] = [
      ...hints.scenes.map(
        (name): ExtractedEntity => ({ kind: "scene", name, aliases: [], episodeIds: ["ep1"] }),
      ),
      { kind: "scene", name: "道口镇街巷", aliases: [], episodeIds: ["ep1"] },
    ];
    expect(diffScriptEntityHints(hints, extracted).extraScenes).toEqual(["道口镇街巷"]);
  });

  it("never flags props (no mechanical declaration source) and stays silent without a cast list", () => {
    // 道具无机械基准(判据归提示词钉),小说体(清单空)不判多防全量误报
    const props: ExtractedEntity[] = [
      { kind: "prop", name: "竹筹", aliases: [], episodeIds: ["ep1"] },
      { kind: "prop", name: "灵矿藤筐", aliases: [], episodeIds: ["ep1"] },
    ];
    expect(diffScriptEntityHints(hints, props).extraCharacters).toEqual([]);
    expect(diffScriptEntityHints(hints, props).extraScenes).toEqual([]);
    const novelDiff = diffScriptEntityHints({ characters: [], scenes: [] }, [
      { kind: "character", name: "丫头", aliases: ["小丫头"], episodeIds: ["ep1"] },
    ]);
    expect(novelDiff.extraCharacters).toEqual([]);
  });

  it("documents intended signal: compliant mention-only rows (台词说话人漏写人物行/已故亲属单列) also light up", () => {
    // 拷问官 A1 钉板:亮灯+人裁是设计行为,不是 bug——锁死防后人误「修」。
    // 手册允许提及型单列(entity_extractor.md §三)与说话人必列(:43),机械清单只认人物行,
    // 两者会被亮「角色多」;用户按 toast 提示对照剧本核对即可。
    const speakers: ExtractedEntity[] = [
      { kind: "character", name: "酒客乙", aliases: [], episodeIds: ["ep1"] },
    ];
    const mentioned: ExtractedEntity[] = [
      { kind: "character", name: "林父", aliases: [], episodeIds: ["ep1"] },
    ];
    expect(diffScriptEntityHints(hints, speakers).extraCharacters).toEqual(["酒客乙"]);
    expect(diffScriptEntityHints(hints, mentioned).extraCharacters).toEqual(["林父"]);
  });

  it("documents known blind spot: containment variants of a declared name stay silent", () => {
    // 拷问官 A2 钉板:清单有名「丫头」时,模型撰互含变体「丫头甲」因互含≥2字判覆盖——
    // 与 missing 方向同 matcher 的对称宽松,装机复发形态(清单无名)不在此盲区
    const declared: ExtractedEntity[] = [
      { kind: "character", name: "丫头甲", aliases: ["小丫头"], episodeIds: ["ep1"] },
    ];
    expect(diffScriptEntityHints({ characters: ["丫头"], scenes: [] }, declared).extraCharacters).toEqual([]);
  });

  it("guards per-kind on half-empty hints (scenes declared, cast list absent)", () => {
    // 拷问官 C4 钉板:半空清单只关对应方向的负向,另一方向照常工作
    const halfHints = { characters: [] as string[], scenes: ["客栈最里间"] };
    const extracted: ExtractedEntity[] = [
      { kind: "character", name: "丫头", aliases: [], episodeIds: ["ep1"] },
      { kind: "scene", name: "道口镇街巷", aliases: [], episodeIds: ["ep1"] },
    ];
    const diff = diffScriptEntityHints(halfHints, extracted);
    expect(diff.extraCharacters).toEqual([]);
    expect(diff.extraScenes).toEqual(["道口镇街巷"]);
  });

  it("dedupes extra names (two fabricated 丫头 rows report once)", () => {
    const dupes: ExtractedEntity[] = [
      { kind: "character", name: "丫头", aliases: [], episodeIds: ["ep1"] },
      { kind: "character", name: "丫头", aliases: ["小丫头"], episodeIds: ["ep1"] },
    ];
    expect(diffScriptEntityHints(hints, dupes).extraCharacters).toEqual(["丫头"]);
  });

  it("1013 防线①:借名夹带亮灯(神秘少女[赵四]),合法归并不误伤", () => {
    // name 杂物+别名精确=清单名 → suspectBorrowedNames;合法归并(name=赵四)不触发
    const borrowed: ExtractedEntity[] = [
      { kind: "character", name: "神秘少女", aliases: ["赵四"], episodeIds: ["ep1"] },
    ];
    const legal: ExtractedEntity[] = [
      { kind: "character", name: "赵四", aliases: ["监工赵四"], episodeIds: ["ep1"] },
    ];
    const diff = diffScriptEntityHints(hints, borrowed);
    expect(diff.suspectBorrowedNames).toEqual(["神秘少女"]);
    expect(diffScriptEntityHints(hints, legal).suspectBorrowedNames).toEqual([]);
  });

  it("1013 防线②:互含变体亮灯(晏燎甲),别名精确命中则豁免", () => {
    const variant: ExtractedEntity[] = [
      { kind: "character", name: "晏燎甲", aliases: [], episodeIds: ["ep1"] },
    ];
    const withExactAlias: ExtractedEntity[] = [
      { kind: "character", name: "晏燎儿", aliases: ["晏燎"], episodeIds: ["ep1"] },
    ];
    expect(diffScriptEntityHints(hints, variant).suspectVariantNames).toEqual(["晏燎甲"]);
    expect(diffScriptEntityHints(hints, withExactAlias).suspectVariantNames).toEqual([]);
  });
});

describe("formatHintGapList", () => {
  it("keeps at most 4 names per kind and appends 等共N项 beyond that", () => {
    const nine = ["赵四", "小杂役", "苦力", "钱掌柜", "管事", "晏燎", "宗门弟子甲", "铁山", "断臂散修"];
    expect(formatHintGapList(nine)).toBe(`赵四、小杂役、苦力、钱掌柜等共${nine.length}项`);
    // 恰好 4 项全显,无截断尾
    expect(formatHintGapList(["金水河码头", "道口镇当铺前", "金水塾馆", "客栈最里间"])).toBe(
      "金水河码头、道口镇当铺前、金水塾馆、客栈最里间",
    );
  });
});
