import { describe, expect, it } from "vitest";
import { parseNovelEventAnalysisLine } from "./event-analysis";
import { measureNarrativeChapter, scoreNarrativeBeat } from "./narrative-metrics";
import { parseStoryboardTable, toStoryboardItems } from "./storyboard-table";

const CHARACTERS = [
  { characterId: "char-dugu", name: "独孤剑尘", aliases: ["剑尘"] },
  { characterId: "char-keeper", name: "掌柜", aliases: ["老掌柜"] },
];

describe("narrative metrics", () => {
  it("maps existing event labels to explicit audit scores", () => {
    expect(
      scoreNarrativeBeat({
        mainlineRelation: "强（动机建立+系统激活）",
        informationDensity: "高",
        emotionTags: ["转折", "悬疑"],
      }),
    ).toEqual({ conflictScore: 2, densityScore: 3 });
    expect(
      scoreNarrativeBeat({
        mainlineRelation: "中（关系补充）",
        informationDensity: "低",
        emotionTags: ["冲突"],
      }),
    ).toEqual({ conflictScore: 2, densityScore: 1 });
  });

  it("measures a dynamic M-shot chapter without assuming a fixed shot count", () => {
    const event = parseNovelEventAnalysisLine(
      "| 第1章 道口镇客栈 | 独孤剑尘、掌柜 | 独孤剑尘冒雨进客栈，掌柜收住算盘并让出一盏灯 | 强（人物冲突推进） | 高 | 15秒 | 转折+悬疑 |",
    );
    const output = [
      "<storyboardTable>",
      "## 场1：道口镇客栈 ｜ 参演角色：独孤剑尘、掌柜",
      "**引用资产ID**：[role-001, role-002, scene-001]",
      "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID | 出镜语义JSON |",
      "|------|------|------|------|------|------|------|------|------|------|------|------|------|------|------|",
      '| 1 | 雨水压低客栈门檐。 | 道口镇客栈 | [客栈] | 5 | 中景 | 缓推 | 雨水落下 | — | 中景 | 压迫 | 旁白：雨声压低。 | 水声 | [scene-001] | {"sceneViewpointId":"inn-main","personFree":true,"visibleCharacters":[],"visibleProps":[{"name":"客栈","position":"中景","state":"雨湿"}],"actionIn":"雨水落下","actionOut":"雨声延续"} |',
      '| 2 | 掌柜收住算盘。 | 道口镇客栈 | [掌柜] | 5 | 近景 | 静止 | 抬眼收住算盘 | 正面 | 中景 | 谨慎 | 掌柜：客官，外头雨大。 | 算盘声 | [role-002] | {"sceneViewpointId":"inn-main","personFree":false,"visibleCharacters":[{"name":"掌柜","position":"中景","orientation":"正面","actionIn":"抬眼","actionOut":"收住算盘"}],"visibleProps":[],"actionIn":"掌柜抬眼","actionOut":"算盘停下"} |',
      '| 3 | 独孤剑尘压住怀中断剑。 | 道口镇客栈 | [独孤剑尘, 断剑] | 5 | 近景 | 缓推 | 压住剑包 | 侧身朝左 | 前景 | 隐忍 | 独孤剑尘：借一盏灯。 | 木梯声 | [role-001, prop-001] | {"sceneViewpointId":"inn-main","personFree":false,"visibleCharacters":[{"name":"独孤剑尘","position":"右中格","orientation":"侧身朝左","actionIn":"压住剑包","actionOut":"停在门侧"}],"visibleProps":[{"name":"断剑","position":"前景","state":"包裹中"}],"actionIn":"独孤压剑","actionOut":"剑包保持闭合"} |',
      "</storyboardTable>",
    ].join("\n");
    const parsed = parseStoryboardTable(output, "chapter-001", { requireShotSemantics: true });
    expect(parsed.errors).toEqual([]);
    const items = toStoryboardItems(parsed.rows, "chapter-001", CHARACTERS);
    const metrics = measureNarrativeChapter({
      beat: event,
      targetDurationSec: event.estimatedDurationSec,
      shots: items,
    });

    expect(metrics).toMatchObject({
      conflictScore: 2,
      densityScore: 3,
      targetDurationSec: 15,
      storyboardDurationSec: 15,
      durationDeltaSec: 0,
      dialogueShots: 2,
      narratorShots: 1,
      emotionTransitions: 2,
      executableShots: 3,
      totalShots: 3,
    });
    expect(metrics.dialogueRatio).toBeCloseTo(2 / 3);
    expect(metrics.narratorRatio).toBeCloseTo(1 / 3);
    expect(metrics.executableRatio).toBe(1);
  });
});
