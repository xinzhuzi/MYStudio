import { describe, expect, it } from "vitest";

import type { AssetImage, AssetImageKind } from "@/types/studio-assets";
import { classifyAssetImageName } from "./asset-image-kind";
import {
  AGE_LADDER,
  DAO_STAGE_WHITELIST,
  REALM_LADDER,
  buildStageTypeShotImageName,
  clusterAssetStages,
  extractStageName,
  hasRenderableStageMatrix,
  stageSortKey,
  sortStageFirstThenInput,
} from "./asset-stage-prompts";

/**
 * 契约钉(10-25-asset-stage-prompt-matrix T1,PRD §四测试件):
 * ①晏燎 32 实名 fixture 全量聚类(10 阶段×3 型+基底/表情差分出组);
 * ②乱序入→阶梯序出(实库序元婴在前金丹殿后→输出练气…共主);
 * ③白名单/期形/年龄段命中与段级防误中(禁 substring);
 * ④重掷名 `_海报_v1_重掷_日期` 归组归型;
 * ⑤显示守卫 <2 恒 [];
 * ⑥命名器(§3.3)输出及 classifyAssetImageName 复验归型不变。
 *
 * fixture 真源(10-25 只读实测,禁造假设数据):
 * - 晏燎 32 名 = `sqlite3 -readonly …/store/assets/assets.db "SELECT images FROM assets
 *   WHERE name='晏燎'"` 逐字内嵌,保留实库序(元婴→共主→化神→合体→[全身定妆]→大乘→
 *   渡劫→炼虚→筑基→练气→[表情差分]→金丹殿后;1.3-1:images[]=战役批序非时间序);
 * - 独孤剑尘 4 名 = 同法 `WHERE name='独孤剑尘'`。
 */

/** 晏燎 32 实名(实库序逐字内嵌;条目无 kind 持久值=实库 JSON 原貌,归型走命名派生)。 */
const YANLIAO_IMAGES: AssetImage[] = [
  { name: "晏燎_元婴期_三视图_v1", filePath: "role/晏燎/晏燎_元婴期_三视图_v1.png" },
  { name: "晏燎_元婴期_正视图_v1", filePath: "role/晏燎/晏燎_元婴期_正视图_v1.png" },
  { name: "晏燎_元婴期_海报_v1", filePath: "role/晏燎/晏燎_元婴期_海报_v1.png" },
  { name: "晏燎_共主期_三视图_v1", filePath: "role/晏燎/晏燎_共主期_三视图_v1.png" },
  { name: "晏燎_共主期_正视图_v1", filePath: "role/晏燎/晏燎_共主期_正视图_v1.png" },
  { name: "晏燎_共主期_海报_v1", filePath: "role/晏燎/晏燎_共主期_海报_v1.png" },
  { name: "晏燎_化神期_三视图_v1", filePath: "role/晏燎/晏燎_化神期_三视图_v1.png" },
  { name: "晏燎_化神期_正视图_v1", filePath: "role/晏燎/晏燎_化神期_正视图_v1.png" },
  { name: "晏燎_化神期_海报_v1", filePath: "role/晏燎/晏燎_化神期_海报_v1.png" },
  { name: "晏燎_合体期_三视图_v1", filePath: "role/晏燎/晏燎_合体期_三视图_v1.png" },
  { name: "晏燎_合体期_正视图_v1", filePath: "role/晏燎/晏燎_合体期_正视图_v1.png" },
  { name: "晏燎_合体期_海报_v1", filePath: "role/晏燎/晏燎_合体期_海报_v1.png" },
  { name: "晏燎_全身定妆_v1", filePath: "role/晏燎/晏燎_全身定妆_v1.png" },
  { name: "晏燎_大乘期_三视图_v1", filePath: "role/晏燎/晏燎_大乘期_三视图_v1.png" },
  { name: "晏燎_大乘期_正视图_v1", filePath: "role/晏燎/晏燎_大乘期_正视图_v1.png" },
  { name: "晏燎_大乘期_海报_v1", filePath: "role/晏燎/晏燎_大乘期_海报_v1.png" },
  { name: "晏燎_渡劫期_三视图_v1", filePath: "role/晏燎/晏燎_渡劫期_三视图_v1.png" },
  { name: "晏燎_渡劫期_正视图_v1", filePath: "role/晏燎/晏燎_渡劫期_正视图_v1.png" },
  { name: "晏燎_渡劫期_海报_v1", filePath: "role/晏燎/晏燎_渡劫期_海报_v1.png" },
  { name: "晏燎_炼虚期_三视图_v1", filePath: "role/晏燎/晏燎_炼虚期_三视图_v1.png" },
  { name: "晏燎_炼虚期_正视图_v1", filePath: "role/晏燎/晏燎_炼虚期_正视图_v1.png" },
  { name: "晏燎_炼虚期_海报_v1", filePath: "role/晏燎/晏燎_炼虚期_海报_v1.png" },
  { name: "晏燎_筑基期_三视图_v1", filePath: "role/晏燎/晏燎_筑基期_三视图_v1.png" },
  { name: "晏燎_筑基期_正视图_v1", filePath: "role/晏燎/晏燎_筑基期_正视图_v1.png" },
  { name: "晏燎_筑基期_海报_v1", filePath: "role/晏燎/晏燎_筑基期_海报_v1.png" },
  { name: "晏燎_练气期_三视图_v1", filePath: "role/晏燎/晏燎_练气期_三视图_v1.png" },
  { name: "晏燎_练气期_正视图_v1", filePath: "role/晏燎/晏燎_练气期_正视图_v1.png" },
  { name: "晏燎_练气期_海报_v1", filePath: "role/晏燎/晏燎_练气期_海报_v1.png" },
  { name: "晏燎_表情差分_v1", filePath: "role/晏燎/晏燎_表情差分_v1.png" },
  { name: "晏燎_金丹期_三视图_v1", filePath: "role/晏燎/晏燎_金丹期_三视图_v1.png" },
  { name: "晏燎_金丹期_正视图_v1", filePath: "role/晏燎/晏燎_金丹期_正视图_v1.png" },
  { name: "晏燎_金丹期_海报_v1", filePath: "role/晏燎/晏燎_金丹期_海报_v1.png" },
];

/** 独孤剑尘 4 实名(配角零阶段段:高清大脸/人物图/多视图/参考图,均无命中段)。 */
const DUGU_IMAGES: AssetImage[] = [
  { name: "独孤剑尘_高清大脸_2026年10月21日", filePath: "role/独孤剑尘/独孤剑尘_高清大脸_2026年10月21日.png" },
  { name: "独孤剑尘_人物图_2026年10月21日", filePath: "role/独孤剑尘/独孤剑尘_人物图_2026年10月21日.png" },
  { name: "独孤剑尘_多视图_2026年10月21日", filePath: "role/独孤剑尘/独孤剑尘_多视图_2026年10月21日.png" },
  { name: "独孤剑尘_参考图", filePath: "role/独孤剑尘/1.独孤剑尘.png" },
];

describe("REALM_LADDER/AGE_LADDER/DAO_STAGE_WHITELIST 常量真源", () => {
  it("十境阶梯序=晏燎.json 键序,首境取实库写法「练气期」(json 键作「炼气期」,§六验收句=练气→共主)", () => {
    // 逐字钉(防常量被误改回 json 的「炼」写法致练气期散入未知档,违验收口径)
    expect(REALM_LADDER[0]).toBe("练气期");
    expect([...REALM_LADDER]).toEqual([
      "练气期", "筑基期", "金丹期", "元婴期", "化神期", "炼虚期", "合体期", "渡劫期", "大乘期", "共主期",
    ]);
  });

  it("年龄段阶梯=幼→老", () => {
    expect([...AGE_LADDER]).toEqual(["幼年", "青年", "成年", "中年", "老年"]);
  });

  it("道途白名单=MA 2.道途/ 71 件(剔 HTML/道途对照表),全名唯一且与境界/年龄段零重叠", () => {
    expect(DAO_STAGE_WHITELIST.length).toBe(71);
    expect(new Set(DAO_STAGE_WHITELIST).size).toBe(71);
    // 撞名防(§七风险表):与另两表零交集、无期形(期形属境界档,撞档即排序歧义)
    for (const name of DAO_STAGE_WHITELIST) {
      expect((REALM_LADDER as readonly string[]).includes(name)).toBe(false);
      expect((AGE_LADDER as readonly string[]).includes(name)).toBe(false);
      expect(name.endsWith("期")).toBe(false);
    }
  });

  it("真源锚点(10-25 复审逐名核对毕):数字前缀序首位=剑主男,擒龙女=第9位,末位=幻翎女(71)", () => {
    // 真源=…/7.道途境界/2.道途/ md 文件名数字前缀序;PRD §1.3-4「剑主男..擒龙女」系
    // 举例式表述,与真源端点不符(擒龙女非末位)——按 PRD 字面把末位改擒龙女即违真源,
    // 此处钉三锚防误改(逐名核对记录见常量注释)。
    expect(DAO_STAGE_WHITELIST[0]).toBe("剑主男");
    expect(DAO_STAGE_WHITELIST[8]).toBe("擒龙女");
    expect(DAO_STAGE_WHITELIST[70]).toBe("幻翎女");
  });
});

describe("extractStageName 段级提取(整段相等,禁 substring)", () => {
  it("命中表:期形通配(阶梯内/外)、道途全名、年龄段", () => {
    expect(extractStageName("晏燎_渡劫期_海报_v1")).toBe("渡劫期"); // 期形且在阶梯
    expect(extractStageName("晏燎_剑主期_海报_v1")).toBe("剑主期"); // 期形通配(阶梯外,未知档不丢)
    expect(extractStageName("晏燎_剑主男_海报_v1")).toBe("剑主男"); // 道途全名整段命中
    expect(extractStageName("晏燎_青年_海报_v1")).toBe("青年"); // 年龄段整段命中
  });

  it("防误中:衣物描述段/道途子串族/无阶段段产物 → null", () => {
    expect(extractStageName("晏燎_青灰长袍_三视图_v1")).toBeNull(); // 衣物描述段不命中
    expect(extractStageName("独孤剑尘_剑主_人物图_2026年10月21日")).toBeNull(); // 剑主≠剑主男,子串禁中
    expect(extractStageName("晏燎_基底_v1")).toBeNull(); // 基底无阶段段
    expect(extractStageName("晏燎_表情差分_v1")).toBeNull(); // 表情差分无阶段段
    for (const image of DUGU_IMAGES) {
      expect(extractStageName(image.name)).toBeNull(); // 配角 4 实名零命中
    }
  });
});

describe("stageSortKey 档序(境界<年龄段<道途字典序<未知 Infinity 首现序附尾)", () => {
  it("四档严格递增,未知档=Infinity", () => {
    expect(stageSortKey("练气期", 0)).toBeLessThan(stageSortKey("共主期", 0)); // 阶梯内序
    expect(stageSortKey("共主期", 0)).toBeLessThan(stageSortKey("幼年", 0)); // 境界档<年龄段档
    expect(stageSortKey("老年", 0)).toBeLessThan(stageSortKey("剑主男", 0)); // 年龄段档<道途档
    expect(stageSortKey("剑主男", 0)).toBeLessThan(stageSortKey("剑主期", 0)); // 道途档<未知档
    expect(stageSortKey("剑主期", 0)).toBe(Number.POSITIVE_INFINITY);
    expect(stageSortKey("自造境界", 7)).toBe(Number.POSITIVE_INFINITY);
  });

  it("道途档内=字典序", () => {
    expect(stageSortKey("剑主男", 0)).toBeLessThan(stageSortKey("擒龙女", 0));
  });
});

describe("clusterAssetStages 晏燎 32 实名全量聚类(乱序入→阶梯序出)", () => {
  it("返回前守卫放行(32 名全量入参非空),10 阶段阶梯序 练气→共主(实库序元婴在前金丹殿后)", () => {
    expect(YANLIAO_IMAGES.length).toBe(32);
    expect(hasRenderableStageMatrix(YANLIAO_IMAGES)).toBe(true);
    const clusters = clusterAssetStages(YANLIAO_IMAGES);
    expect(clusters.map((cluster) => cluster.stage)).toEqual([...REALM_LADDER]);
  });

  it("每阶段两节:人物海报 1 张 + 人物多视图 2 张(正视图与三视图归并),latest=输入序末位", () => {
    const clusters = clusterAssetStages(YANLIAO_IMAGES);
    expect(clusters).toHaveLength(10);
    const clusteredNames: string[] = [];
    for (const { stage, byKind } of clusters) {
      expect(byKind.size).toBe(2);
      const posters = byKind.get("人物海报");
      const views = byKind.get("人物多视图");
      expect(posters?.all).toEqual([{ name: `晏燎_${stage}_海报_v1` }]);
      expect(posters?.latest.name).toBe(`晏燎_${stage}_海报_v1`);
      // 正视图与三视图归并进人物多视图;实库序三视图在前正视图在后 → latest=正视图
      expect(views?.all).toEqual([{ name: `晏燎_${stage}_三视图_v1` }, { name: `晏燎_${stage}_正视图_v1` }]);
      expect(views?.latest.name).toBe(`晏燎_${stage}_正视图_v1`);
      expect(views?.latest.filePath).toBe(`role/晏燎/晏燎_${stage}_正视图_v1.png`);
      for (const group of byKind.values()) {
        for (const entry of group.all) clusteredNames.push(entry.name);
      }
    }
    // 30 张入组;基底/表情差分 2 张出组(天然无阶段段)
    expect(clusteredNames).toHaveLength(30);
    expect(clusteredNames).not.toContain("晏燎_全身定妆_v1");
    expect(clusteredNames).not.toContain("晏燎_表情差分_v1");
  });
});

describe("clusterAssetStages 重掷产物归组归型(1.3-2:重掷与阶段聚类天然兼容)", () => {
  it("重掷名归金丹期+人物海报组,all 计 2,latest=重掷名(append 到尾)", () => {
    const rerollName = "晏燎_金丹期_海报_v1_重掷_2026年10月25日";
    expect(extractStageName(rerollName)).toBe("金丹期");
    expect(classifyAssetImageName(rerollName)).toBe("人物海报"); // 右最标记:_海报_;「重掷」非型标记
    const clusters = clusterAssetStages([...YANLIAO_IMAGES, { name: rerollName, filePath: "role/晏燎/晏燎_金丹期_海报_v1_重掷_2026年10月25日.png" }]);
    const goldenCore = clusters.find((cluster) => cluster.stage === "金丹期");
    expect(goldenCore).toBeDefined();
    const posters = goldenCore!.byKind.get("人物海报");
    expect(posters?.all).toEqual([
      { name: "晏燎_金丹期_海报_v1" },
      { name: rerollName },
    ]);
    expect(posters?.all).toHaveLength(2);
    expect(posters?.latest.name).toBe(rerollName);
    expect(clusters).toHaveLength(10); // 重掷不新增阶段
  });
});

describe("clusterAssetStages 显示守卫(distinct 阶段 <2 → 空数组)", () => {
  it("零阶段(独孤剑尘 4 实名)→ [] 且守卫判定 false", () => {
    expect(clusterAssetStages(DUGU_IMAGES)).toEqual([]);
    expect(hasRenderableStageMatrix(DUGU_IMAGES)).toBe(false);
  });

  it("单阶段 → [] 且守卫判定 false(单阶段配角弹窗零变化)", () => {
    const singleStage: AssetImage[] = [
      { name: "晏燎_金丹期_三视图_v1", filePath: "role/晏燎/晏燎_金丹期_三视图_v1.png" },
      { name: "晏燎_金丹期_海报_v1", filePath: "role/晏燎/晏燎_金丹期_海报_v1.png" },
    ];
    expect(clusterAssetStages(singleStage)).toEqual([]);
    expect(hasRenderableStageMatrix(singleStage)).toBe(false);
  });

  it("未知档首现序附尾不丢(阶梯→年龄段→道途→未知按首现)", () => {
    const mixed: AssetImage[] = [
      { name: "晏燎_开光期_海报_v1", filePath: "role/晏燎/晏燎_开光期_海报_v1.png" },
      { name: "晏燎_剑主期_海报_v1", filePath: "role/晏燎/晏燎_剑主期_海报_v1.png" },
      { name: "晏燎_渡劫期_海报_v1", filePath: "role/晏燎/晏燎_渡劫期_海报_v1.png" },
      { name: "晏燎_青年_海报_v1", filePath: "role/晏燎/晏燎_青年_海报_v1.png" },
      { name: "晏燎_剑主男_海报_v1", filePath: "role/晏燎/晏燎_剑主男_海报_v1.png" },
    ];
    expect(clusterAssetStages(mixed).map((cluster) => cluster.stage)).toEqual([
      "渡劫期", // 境界档(阶梯内)
      "青年", // 年龄段档
      "剑主男", // 道途档(字典序)
      "开光期", // 未知档=首现序附尾(先见于剑主期)
      "剑主期",
    ]);
  });
});

describe("buildStageTypeShotImageName 命名器(§3.3:资产名_{阶段}_{型名}_中文日期)", () => {
  /** 按型出图型档案全型(=ASSET_TYPE_SHOT_PROFILES 11 型;高清人脸/表情差分走既有路不入档案)。 */
  const TYPE_SHOT_KINDS: Array<Exclude<AssetImageKind, "早期未分类">> = [
    "全身定妆", "人物海报", "人物多视图", "人脸基准", "自由", "设定卡", "美宣",
    "场景", "概念气氛图", "3D剖面场景图", "道具",
  ];

  it("输出形态逐字,classifyAssetImageName 复验归型不变,extractStageName 复验归组成立", () => {
    for (const kind of TYPE_SHOT_KINDS) {
      const name = buildStageTypeShotImageName("晏燎", "金丹期", kind, "2026年10月25日");
      expect(name).toBe(`晏燎_金丹期_${kind}_2026年10月25日`);
      expect(classifyAssetImageName(name)).toBe(kind); // 归型不变(型段直用 kind 成员)
      expect(extractStageName(name)).toBe("金丹期"); // 产物自动入组
    }
  });
});


describe("节内显示序排序(10-25 用户令:阶段序在前,无阶段按时间序在后)", () => {
  it("乱序入→阶梯序出(元婴在前金丹殿后的实库序→练气…共主);无阶段图整段排尾保输入序", () => {
    const ordered = sortStageFirstThenInput(
      [
        "晏燎_元婴期_海报_v1",
        "随手海报",
        "晏燎_共主期_海报_v1",
        "晏燎_练气期_海报_v1",
        "旧海报无阶段",
        "晏燎_金丹期_海报_v1",
      ],
      (name) => name,
    );
    expect(ordered).toEqual([
      "晏燎_练气期_海报_v1",
      "晏燎_金丹期_海报_v1",
      "晏燎_元婴期_海报_v1",
      "晏燎_共主期_海报_v1",
      "随手海报",
      "旧海报无阶段",
    ]);
  });

  it("整节无阶段=纯输入序零变化;同阶段多张保输入序(时间序);index 原值随行不重排", () => {
    const noStage = ["c图", "a图", "b图"];
    expect(sortStageFirstThenInput(noStage, (n) => n)).toEqual(noStage);
    // 输入序即时间序(追加序):fixture 故意让 重掷(idx7) 在前、v1(idx3) 在后,
    // 稳定排序须原样保留(时间序不倒置);无阶段 主图(idx0) 排尾
    const pairs = [
      { name: "晏燎_金丹期_海报_v1_重掷_2026年10月25日", index: 7 },
      { name: "晏燎_金丹期_海报_v1", index: 3 },
      { name: "主图", index: 0 },
    ];
    const sorted = sortStageFirstThenInput(pairs, (p2) => p2.name);
    expect(sorted.map((p2) => p2.index)).toEqual([7, 3, 0]);
  });
});