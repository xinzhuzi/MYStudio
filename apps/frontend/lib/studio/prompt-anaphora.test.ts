import { describe, expect, it } from "vitest";
import { findPromptAnaphora, PROMPT_ANAPHORA_TERMS } from "./prompt-anaphora";

// 规范 §三禁指代词清单(18 词)——测试自持抄录自
// docs/comfyui-kb/跨镜连续性规范.md:89,不复用实现导出的常量,
// 防"实现漏词 + 测试同漏"的自证绿。
const SPEC_TERMS = [
  "上一镜",
  "上一镜头",
  "前一镜",
  "刚才",
  "此前",
  "如前",
  "接上文",
  "见前文",
  "同上",
  "照旧",
  "依旧",
  "仍保持",
  "保持原样",
  "继续",
  "接着",
  "和前面一样",
  "与前镜一致",
  "沿袭上镜",
] as const;

describe("prompt-anaphora:P3 禁指代词机检", () => {
  it("冻结常量与规范 §三清单一致(18 词,冻结)", () => {
    expect(PROMPT_ANAPHORA_TERMS).toHaveLength(SPEC_TERMS.length);
    expect([...PROMPT_ANAPHORA_TERMS].sort()).toEqual([...SPEC_TERMS].sort());
    expect(Object.isFrozen(PROMPT_ANAPHORA_TERMS)).toBe(true);
  });

  it.each([...SPEC_TERMS])("清单词「%s」各一全部命中,term/index/excerpt 正确", (term) => {
    // 前后缀均不含清单词,命中词后紧跟逗号,不会把短词延长成长清单词(如「上一镜」→「上一镜头」)
    const text = `少年提灯走过石阶,${term},画面稳定。`;
    const violations = findPromptAnaphora(text);
    const hit = violations.find((v) => v.term === term);
    expect(hit, `term=${term} 应命中`).toBeDefined();
    expect(hit?.index).toBe(text.indexOf(term));
    expect(hit?.excerpt).toContain(term);
  });

  it("完整正向描述(全量重述型)零命中", () => {
    const fullRestatement = [
      "沈砚立于紫檀书案南侧,背朝西窗,左手提一盏未点燃的铜灯,灯罩朝向案头;",
      "身着月白长衫,袖口沾墨,发束半松;西窗外夜雨初歇,案上摊开半卷信笺,墨迹未干;",
      "他启唇道:「如今信还在,人却回不来了。」镜头自书案正面偏东中景缓推,沈砚双目低垂,吐字后换气收住。",
    ].join("");
    expect(findPromptAnaphora(fullRestatement)).toEqual([]);
  });

  it("双层规则边界:模块无层别概念,同文本两读结果一致,层别豁免由调用方负责", () => {
    // 规范 §三双层规则:计划文件/分镜表内部可以记缩写,编译产物必须展开为完整正向描述。
    // 本模块是纯文本→违规项,不知道也不判断层别——把同一段文本当编译产物还是当
    // 计划层备注输入,命中结果完全相同;豁免逻辑留给未来接线拍板时的调用方。
    const planNote = "计划备注:首帧源自 SH07 尾帧,构图与前镜一致。";
    const asProduct = findPromptAnaphora(planNote);
    const asPlanLayer = findPromptAnaphora(planNote);
    expect(asProduct).toHaveLength(1);
    expect(asProduct[0]?.term).toBe("与前镜一致");
    expect(asPlanLayer).toEqual(asProduct);
  });

  it("重叠合并:「上一镜头」只报最长词一次,不重复报「上一镜」", () => {
    const violations = findPromptAnaphora("动作承接上一镜头的姿态");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.term).toBe("上一镜头");
  });

  it("重叠合并:「仍保持原样」交叠命中合并,只报最长词「保持原样」", () => {
    const violations = findPromptAnaphora("人物姿态仍保持原样");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.term).toBe("保持原样");
  });

  it("多命中按出现位置升序,excerpt 前后各约 8 字", () => {
    const violations = findPromptAnaphora("他接着说,灯照旧未点。");
    expect(violations.map((v) => v.term)).toEqual(["接着", "照旧"]);

    const padded = "一二三四五六七八九继续一二三四五六七八九";
    const [hit] = findPromptAnaphora(padded);
    expect(hit?.term).toBe("继续");
    expect(hit?.index).toBe(9);
    expect(hit?.excerpt).toBe("二三四五六七八九继续一二三四五六七八");
  });

  it("命中在句首时 excerpt 不越界且含命中词", () => {
    const [hit] = findPromptAnaphora("继续前行");
    expect(hit?.index).toBe(0);
    expect(hit?.excerpt).toBe("继续前行");
  });

  it("空串与非中文输入返回空数组", () => {
    expect(findPromptAnaphora("")).toEqual([]);
    expect(findPromptAnaphora("A quiet dock at dawn. Waves keep rolling.")).toEqual([]);
  });
});
