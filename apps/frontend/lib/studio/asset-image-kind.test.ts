import { describe, expect, it } from "vitest";

import {
  ASSET_IMAGE_KIND_ORDER,
  ASSET_IMAGE_KIND_SPECTRA,
  ASSET_IMAGE_KIND_ASPECTS,
  asAssetImageTrack,
  CORE_ASSET_IMAGE_KINDS,
  EXTENDED_ASSET_IMAGE_KINDS,
  classifyAssetImage,
  classifyAssetImageName,
  getAssetImageKindSpectrum,
  groupAssetImagesByKind,
} from "./asset-image-kind";

/** 命名分类表全 pattern(PRD Round 2 A 节逐字:含既有全部产物族)。 */
const NAME_TABLE_CASES: Array<[string, string]> = [
  // 高清人脸:_人脸_·_高清大脸_
  ["晏燎_练气期_人脸_2026年10月21日", "高清人脸"],
  ["晏燎_练气期_高清大脸_2026年10月21日", "高清人脸"],
  // 表情差分
  ["晏燎_表情差分_v1", "表情差分"],
  ["晏燎_练气期_表情差分_2026年10月24日", "表情差分"],
  // 人物多视图:_三视图_·_多视图_
  ["晏燎_练气期_三视图_v1", "人物多视图"],
  ["独孤剑尘_多视图_2026年10月21日", "人物多视图"],
  // 人物海报:_正视图_·_人物图_
  ["晏燎_练气期_正视图_v1", "人物海报"],
  ["独孤剑尘_人物图_2026年10月21日", "人物海报"],
  // 美宣:_海报_·_美宣_
  ["晏燎_练气期_海报_v1", "美宣"],
  ["主角_美宣_v2", "美宣"],
  // 全身定妆
  ["晏燎_全身定妆_v1", "全身定妆"],
  // 设定卡 / 人脸基准 / 自由 直认
  ["主角_设定卡_v1", "设定卡"],
  ["晏燎_人脸基准_v1", "人脸基准"],
  ["主角_自由_2026年10月24日", "自由"],
  // 画风转换产物名透传标记(原图名_中文日期,标记仍在名内)
  ["晏燎_练气期_正视图_v1_2026年10月21日", "人物海报"],
  ["晏燎_练气期_三视图_v1_2026年10月21日", "人物多视图"],
  // 批3(10-24) 按型出图产物命名回退标记(原图名_{型名}_中文日期;行级主图
  // kind 持久化候 Round 3 Q2,重载后靠命名派生归节——_人物海报_/_人物多视图_
  // 不含 _海报_/_多视图_ 子串(前接「物」字),须显式标记)
  ["晏燎_练气期_人物海报_2026年10月24日", "人物海报"],
  ["晏燎_练气期_人物多视图_2026年10月24日", "人物多视图"],
  ["晏燎_练气期_全身定妆_2026年10月24日", "全身定妆"],
  ["晏燎_练气期_人脸基准_2026年10月24日", "人脸基准"],
  ["晏燎_练气期_设定卡_2026年10月24日", "设定卡"],
  ["晏燎_练气期_美宣_2026年10月24日", "美宣"],
  ["晏燎_练气期_自由_2026年10月24日", "自由"],
  // Round 3 ⑤ scene/tool 直认标记(先专后泛:_3D剖面场景图_/_概念气氛图_ 在 _场景_ 前)
  ["山门_场景_2026年10月24日", "场景"],
  ["山门_3D剖面场景图_v1", "3D剖面场景图"],
  ["洞府_剖面场景图_v1", "3D剖面场景图"],
  ["山门_概念气氛图_v1", "概念气氛图"],
  ["山门_气氛图_v1", "概念气氛图"],
  ["玄铁剑_道具_2026年10月24日", "道具"],
  // 识别不出 → 早期未分类
  ["主图", "早期未分类"],
  ["姿态一", "早期未分类"],
  ["独孤剑尘_参考图", "早期未分类"],
  ["晏燎_基底_v1", "早期未分类"],
  ["晏燎_2026年07月03日", "早期未分类"],
];

describe("classifyAssetImageName · 命名分类表全 pattern(10-24 批2,PRD Round 2 A 节逐字)", () => {
  it.each(NAME_TABLE_CASES)("%s → %s", (name, expected) => {
    expect(classifyAssetImageName(name)).toBe(expected);
  });

  it("_人脸基准_ 不被 _人脸_ 前缀误吞(先专后泛)", () => {
    expect(classifyAssetImageName("晏燎_人脸基准_v1")).toBe("人脸基准");
  });
});

describe("classifyAssetImage · 三层解析(持久值→命名→早期未分类)", () => {
  it("持久值优先:kind 合法时压过命名派生(改名破规后的兜底值)", () => {
    expect(classifyAssetImage({ name: "随便改的名", kind: "美宣" })).toBe("美宣");
  });

  it("非法持久值(images[] 不可信边界)落命名派生路", () => {
    const rogue = { name: "晏燎_练气期_三视图_v1", kind: "野值" } as unknown as Parameters<typeof classifyAssetImage>[0];
    expect(classifyAssetImage(rogue)).toBe("人物多视图");
  });

  it("无 kind 无标记 → 早期未分类", () => {
    expect(classifyAssetImage({ name: "主图" })).toBe("早期未分类");
  });
});

/** 晏燎十境境名(与实盘 MA 库 role/晏燎 行 images[] 同款境名,10-24 实读)。 */
const YANLIAO_REALMS = ["练气", "筑基", "金丹", "元婴", "化神", "炼虚", "合体", "渡劫", "大乘", "共主"];

/** 实盘镜像 fixture(10-24 实读 MA 库 role/晏燎 行 images[] 全量 32 条逐字同构;
 *  联合收尾复核=sqlite 只读重查同款):三视图/正视图/海报 ×10 境 + 表情差分 1 +
 *  基底 1。库内现值高清人脸 0(盘上 files/role/晏燎/ 亦无该类文件);_基底_ 不在
 *  PRD A 节逐字命名表内 → 落早期未分类(无映射名落未分类=合法终态,禁虚构旧口径)。 */
const YANLIAO_DB_32_NAMES: string[] = [
  ...YANLIAO_REALMS.flatMap((realm) => [
    `晏燎_${realm}期_三视图_v1`,
    `晏燎_${realm}期_正视图_v1`,
    `晏燎_${realm}期_海报_v1`,
  ]),
  "晏燎_表情差分_v1",
  "晏燎_基底_v1",
];

describe("晏燎实盘镜像 fixture(库内 32 条实测:多视图10/海报10/美宣10/表情差分1/未分类1/人脸0)", () => {
  it("32 条按型归位:基底无映射沉早期未分类,库内无人脸图", () => {
    expect(YANLIAO_DB_32_NAMES).toHaveLength(32);
    const counts = { 人物多视图: 0, 人物海报: 0, 美宣: 0, 表情差分: 0, 高清人脸: 0, 早期未分类: 0 };
    for (const name of YANLIAO_DB_32_NAMES) {
      const kind = classifyAssetImageName(name);
      if (kind in counts) counts[kind as keyof typeof counts] += 1;
    }
    expect(counts).toEqual({
      人物多视图: 10, 人物海报: 10, 美宣: 10, 表情差分: 1, 高清人脸: 0, 早期未分类: 1,
    });
    // 完整度条实弹效果如实锁:高清人脸缺失红 chip 属真缺(库内确无),基底沉底未分类节
    expect(classifyAssetImageName("晏燎_基底_v1")).toBe("早期未分类");
  });
});

describe("独孤剑尘既有产物族命名归位(真库在档三件套+参考图)", () => {
  it("高清大脸/人物图/多视图按映射归位,参考图落未分类", () => {
    expect(classifyAssetImageName("独孤剑尘_高清大脸_2026年10月21日")).toBe("高清人脸");
    expect(classifyAssetImageName("独孤剑尘_人物图_2026年10月21日")).toBe("人物海报");
    expect(classifyAssetImageName("独孤剑尘_多视图_2026年10月21日")).toBe("人物多视图");
    expect(classifyAssetImageName("独孤剑尘_参考图")).toBe("早期未分类");
  });
});

describe("型谱节序与分级常量(grill Round 1 裁定1/2)", () => {
  it("节序=裁定2:身份链根→常规产物→重版式→工具型→兜底,早期未分类沉底", () => {
    expect(ASSET_IMAGE_KIND_ORDER).toEqual([
      "全身定妆", "人物海报", "人物多视图", "高清人脸", "表情差分",
      "设定卡", "美宣", "人脸基准", "自由", "早期未分类",
    ]);
  });

  it("核心五必备与扩展四型互斥且合为九型谱", () => {
    expect(CORE_ASSET_IMAGE_KINDS).toHaveLength(5);
    expect(EXTENDED_ASSET_IMAGE_KINDS).toHaveLength(4);
    const all = [...CORE_ASSET_IMAGE_KINDS, ...EXTENDED_ASSET_IMAGE_KINDS];
    expect(new Set(all).size).toBe(9);
    expect(all.every((kind) => ASSET_IMAGE_KIND_ORDER.includes(kind))).toBe(true);
  });
});

describe("三轨型谱表(Round 3 扩展令⑤:型谱从 role 专属推广图片三轨)", () => {
  it("scene 谱:三核心(场景/概念气氛图/3D剖面场景图)+扩展自由;tool 谱:核心道具+扩展自由", () => {
    expect(ASSET_IMAGE_KIND_SPECTRA.scene).toEqual({
      order: ["场景", "概念气氛图", "3D剖面场景图", "自由", "早期未分类"],
      core: ["场景", "概念气氛图", "3D剖面场景图"],
      extended: ["自由"],
    });
    expect(ASSET_IMAGE_KIND_SPECTRA.tool).toEqual({
      order: ["道具", "自由", "早期未分类"],
      core: ["道具"],
      extended: ["自由"],
    });
  });

  it("role 谱回归零变化:谱表 role 项≡既有常量(节序/核心/扩展逐字同源)", () => {
    expect(ASSET_IMAGE_KIND_SPECTRA.role).toEqual({
      order: ASSET_IMAGE_KIND_ORDER,
      core: CORE_ASSET_IMAGE_KINDS,
      extended: EXTENDED_ASSET_IMAGE_KINDS,
    });
    expect(getAssetImageKindSpectrum("role").core).toHaveLength(5);
  });

  it("asAssetImageTrack:图片三轨收敛,clip/audio 返回 undefined(调用方守卫)", () => {
    expect(asAssetImageTrack("role")).toBe("role");
    expect(asAssetImageTrack("scene")).toBe("scene");
    expect(asAssetImageTrack("tool")).toBe("tool");
    expect(asAssetImageTrack("clip")).toBeUndefined();
    expect(asAssetImageTrack("audio")).toBeUndefined();
  });

  it("画幅表覆盖全部十三型(Round 3 ⑤ 四型=真源 aspect_ratio 逐字)", () => {
    expect(ASSET_IMAGE_KIND_ASPECTS.场景).toBe("16:9");
    expect(ASSET_IMAGE_KIND_ASPECTS.概念气氛图).toBe("16:9");
    expect(ASSET_IMAGE_KIND_ASPECTS["3D剖面场景图"]).toBe("16:9");
    expect(ASSET_IMAGE_KIND_ASPECTS.道具).toBe("1:1");
    // 非未分类型全覆盖(节定义装配无空洞)
    for (const kind of ASSET_IMAGE_KIND_ORDER) {
      if (kind !== "早期未分类") expect(ASSET_IMAGE_KIND_ASPECTS[kind]).toBeTruthy();
    }
  });
});

describe("groupAssetImagesByKind · 按型谱节序分组", () => {
  it("归节保序且 index=原下标(全局单选图/预览回调契约)", () => {
    const images = [
      { name: "主图" },
      { name: "晏燎_练气期_三视图_v1", kind: undefined },
      { name: "随便改的名", kind: "美宣" as const },
      { name: "晏燎_练气期_正视图_v1" },
    ];
    const groups = groupAssetImagesByKind(images);
    expect(groups.get("人物多视图")).toEqual([{ image: images[1], index: 1 }]);
    expect(groups.get("美宣")).toEqual([{ image: images[2], index: 2 }]);
    expect(groups.get("人物海报")).toEqual([{ image: images[3], index: 3 }]);
    expect(groups.get("早期未分类")).toEqual([{ image: images[0], index: 0 }]);
    // 空节=空数组(占位卡渲染依据)
    expect(groups.get("全身定妆")).toEqual([]);
  });

  it("Round 3 ⑤ 轨道谱分组:scene 谱键=谱序;越谱型(如 _海报_ 命名)沉早期未分类防丢图", () => {
    const images = [
      { name: "山门_场景_v1" },
      { name: "随手_海报_v1" },
      { name: "随手_气氛图_v1" },
      { name: "剑穗_自由_v1" },
    ];
    const groups = groupAssetImagesByKind(images, ASSET_IMAGE_KIND_SPECTRA.scene.order);
    expect([...groups.keys()]).toEqual(["场景", "概念气氛图", "3D剖面场景图", "自由", "早期未分类"]);
    expect(groups.get("场景")).toEqual([{ image: images[0], index: 0 }]);
    // _海报_ 属 role 谱型,scene 谱无此节 → 沉早期未分类(不越谱丢图)
    expect(groups.get("早期未分类")).toEqual([{ image: images[1], index: 1 }]);
    expect(groups.get("概念气氛图")).toEqual([{ image: images[2], index: 2 }]);
    expect(groups.get("自由")).toEqual([{ image: images[3], index: 3 }]);
    expect(groups.get("道具")).toBeUndefined();
  });

  it("tool 谱分组:道具/自由/早期未分类三节", () => {
    const groups = groupAssetImagesByKind(
      [{ name: "玄铁剑_道具_v1" }, { name: "剑穗_自由_v1" }, { name: "随手图" }],
      ASSET_IMAGE_KIND_SPECTRA.tool.order,
    );
    expect([...groups.keys()]).toEqual(["道具", "自由", "早期未分类"]);
    expect(groups.get("道具")).toHaveLength(1);
    expect(groups.get("自由")).toHaveLength(1);
    expect(groups.get("早期未分类")).toHaveLength(1);
  });
});
