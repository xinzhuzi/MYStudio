// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { parseStoryboardPreviewRows } from "./storyboard-preview-model";

/** 真实源文件回归(截取自 IP/MA agent-work-data 第一代 15 列全格式分镜表):
 * 解析后动态列渲染所需字段(情绪/资产/音效/出镜语义)必须全部抽出;
 * 源表「角色动作」与「画面描述」逐字重复、「朝向/空间关系」全为"—"占位——
 * 渲染层按去重/占位判空规则隐藏这些列。 */
const FIXTURE_15COL = [
  "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID | 出镜语义JSON |",
  "|------|------|------|------|------|------|------|------|------|------|------|------|------|------|------|",
  '| 1 | 赤练蛇皮鞭撕开河雾，青盐水挂在鞭梢，朱红火印压在藤筐侧面。 | 金水河码头 | [监工赵四, 小杂役, 赤练蛇皮鞭] | 4.2 | 中景 | 缓推 | 赤练蛇皮鞭撕开河雾，青盐水挂在鞭梢，朱红火印压在藤筐侧面。 | — | — | 压迫紧张 | 旁白：傍晚，金水河码头被太一宗火印压醒。 | 河雾低涌、鞭梢破风 | [scene_x, char_a, char_b] | {"sceneViewpointId":"dock-main-axis","personFree":false,"visibleCharacters":[{"name":"监工赵四","position":"左中景","orientation":"侧身朝右下","actionIn":"抬臂蓄鞭","actionOut":"鞭梢斜劈向右下"}],"visibleProps":[],"actionIn":"鞭举起","actionOut":"鞭落下","transitionToNext":{"styleWord":"同场景硬切","moodWord":"压迫"}} |',
  '| 2 | 抱矿跪倒的小杂役缩肩护头，灵矿倒刺扎破指缝。 | 金水河码头 | [监工赵四, 小杂役] | 3.8 | 中景 | 缓推 | 抱矿跪倒的小杂役缩肩护头，灵矿倒刺扎破指缝。 | — | — | 压迫紧张 | 赵四：偷懒？找死！ | 矿石摩擦、孩童抽气 | [scene_x, char_b] | {"sceneViewpointId":"dock-main-axis","personFree":false,"visibleCharacters":[{"name":"小杂役","position":"右下前景","orientation":"蜷身朝左","actionIn":"跪抱灵矿缩肩护头","actionOut":"指缝被矿刺扎破仍护住头脸"}],"visibleProps":[{"name":"灵矿藤筐","position":"小杂役身侧","state":"盛放带倒刺灵矿"}],"actionIn":"跪倒","actionOut":"扎破"} |',
].join("\n");

afterEach(cleanup);

describe("15 列全格式分镜表解析(真实源文件节选)", () => {
  it("extracts every detailed column; duplicate/placeholder columns are detectable for hiding", () => {
    const rows = parseStoryboardPreviewRows(FIXTURE_15COL);
    expect(rows.length).toBe(2);
    expect(rows[0].emotion).toBe("压迫紧张");
    expect(rows[0].sound).toBe("河雾低涌、鞭梢破风");
    expect(rows[0].associateAssetsNames.length).toBe(3);
    expect(rows[0].shotSemantics?.visibleCharacters[0]).toMatchObject({ name: "监工赵四", position: "左中景" });
    expect(rows[0].shotSemantics?.transitionToNext?.styleWord).toBe("同场景硬切");
    // 「角色动作」与「画面描述」逐字重复 → 渲染层去重隐藏
    expect(rows.filter((r) => r.action === r.description)).toHaveLength(2);
    // 「朝向/空间关系」全为"—"占位 → 渲染层判空隐藏
    expect(rows.every((r) => r.orientation === "—" || !r.orientation)).toBe(true);
    expect(rows.every((r) => r.spatialRelation === "—" || !r.spatialRelation)).toBe(true);
  });

  it("parses the new manual contract: scene/segment headings + 15-col rows, no per-segment asset lines", () => {
    const md = [
      "## 场1：道口镇院子 ｜ 参演角色：林志强、林刚",
      "### 片段一（约10s）",
      "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID | 出镜语义JSON |",
      "|------|------|------|------|------|------|------|------|------|------|------|------|------|------|------|",
      '| 1 | 西瓜筐腾空炸裂，红瓤四溅。 | 道口镇院子 | [林志强, 西瓜筐] | 5 | 近景 | 缓推 | 林志强侧身避开碎瓤 | 林志强正面三分之四朝左 | 筐左前景，人右中格 | 突发紧张 | 旁白：西瓜炸裂。 | 音效：炸裂闷响 | [char_101, prop_301] | {"sceneViewpointId":"yard-axis","personFree":false,"visibleCharacters":[{"name":"林志强","position":"右中格","orientation":"正面三分之四朝左","actionIn":"低头看筐","actionOut":"侧身避开"}],"visibleProps":[],"actionIn":"筐腾空","actionOut":"碎瓤落地"} |',
    ].join("\n");
    const rows = parseStoryboardPreviewRows(md);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.scene).toBe("道口镇院子");
    expect(row.associateAssetsNames).toEqual(["林志强", "西瓜筐"]);
    expect(row.action).toBe("林志强侧身避开碎瓤");
    expect(row.action).not.toBe(row.description);
    expect(row.orientation).toBe("林志强正面三分之四朝左");
    expect(row.spatialRelation).toBe("筐左前景，人右中格");
    expect(row.emotion).toBe("突发紧张");
    expect(row.associateAssetsIds).toEqual(["char_101", "prop_301"]);
    expect(row.shotSemantics?.sceneViewpointId).toBe("yard-axis");
  });
});
