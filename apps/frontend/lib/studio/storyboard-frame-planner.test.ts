import { describe, expect, it } from "vitest";
import {
  DIALOGUE_CHARS_PER_SECOND,
  dialogueBoundaryPointsUs,
  planStoryboardKeyframes,
  splitDialogueLines,
} from "./storyboard-frame-planner";
import { validateStoryboardKeyframes } from "./keyframes";

describe("帧规划器", () => {
  it("≤10s 两帧(开场/收尾);>10s 三帧(含中段);空槽可过 plan 校验", () => {
    const short = planStoryboardKeyframes({ id: "s1", durationUs: 8_000_000, videoDesc: "码头拖筐。" });
    expect(short).toHaveLength(2);
    expect(short[0].inUs).toBe(0);
    expect(short[0].momentDescription).toContain("开场站位:");
    expect(short[1].momentDescription).toContain("收尾态:");
    expect(validateStoryboardKeyframes(short, { shotDurationUs: 8_000_000, allowEmptySlots: true })).toEqual([]);

    const long = planStoryboardKeyframes({
      id: "s2", durationUs: 12_000_000, videoDesc: "船桩压住前景，铁链横穿石板，苦力弯腰搬运灵矿。",
    });
    expect(long).toHaveLength(3);
    expect(long[1].momentDescription).toContain("中段:");
    expect(validateStoryboardKeyframes(long, { shotDurationUs: 12_000_000, allowEmptySlots: true })).toEqual([]);
  });

  it("出镜语义驱动帧时刻描述(角色 actionIn/actionOut)", () => {
    const frames = planStoryboardKeyframes({
      id: "s3", durationUs: 10_000_000,
      shotSemantics: {
        visibleCharacters: [
          { name: "老苦力", position: "左中格", orientation: "侧面朝右", actionIn: "弯腰拖筐", actionOut: "扛筐前行" },
        ],
      } as never,
    });
    expect(frames[0].momentDescription).toContain("老苦力弯腰拖筐");
    expect(frames[1].momentDescription).toContain("老苦力扛筐前行");
  });

  it("台词句拆分:剥说话人前缀,<br>/；分隔", () => {
    expect(
      splitDialogueLines("旁白：铁链一节接一节。<br>赵四：都给我快些！；管事：下一个"),
    ).toEqual(["铁链一节接一节。", "都给我快些！", "下一个"]);
  });

  it("句边界点=逐句累计(字数/4字每秒),首点 0", () => {
    const points = dialogueBoundaryPointsUs("赵四：1234");
    expect(points).toEqual([0, 1_000_000]);
    expect(DIALOGUE_CHARS_PER_SECOND).toBe(4);
  });

  it("中段换帧点吸附句边界(±0.5s 内);远离窗口保持等分;偏空镜退回等分", () => {
    const snapped = planStoryboardKeyframes({
      id: "s4", durationUs: 12_000_000,
      lines: "旁白：一二三四五六七八九十一二三四五六七",
    });
    expect(snapped[1].inUs).toBe(4_250_000);

    const unsnapped = planStoryboardKeyframes({
      id: "s5", durationUs: 12_000_000,
      lines: "旁白：1234",
    });
    expect(unsnapped[1].inUs).toBe(4_000_000);

    const silent = planStoryboardKeyframes({ id: "s6", durationUs: 12_000_000, videoDesc: "空镜。" });
    expect(silent[1].inUs).toBe(4_000_000);
  });
});
