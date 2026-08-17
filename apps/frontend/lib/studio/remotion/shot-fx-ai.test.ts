import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  heuristicShotFxMotions,
  parseShotFxMotionResponse,
  selectShotFxMotions,
} from "./shot-fx-ai";

const textMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    text: textMock,
  },
}));

const SHOTS = [
  { shotId: "s1", description: "剑光劈落，轰鸣炸开", dialogue: "看招！" },
  // 注意避开「影」等暗夜词：此处专测退场词奇偶镜行为
  { shotId: "s2", description: "他挥手告别，渐行渐远", dialogue: "" },
  { shotId: "s3", description: "庭院喝茶", dialogue: "今日风平。" },
];

beforeEach(() => {
  textMock.mockReset();
});

describe("parseShotFxMotionResponse", () => {
  const shotIds = new Set(["s1", "s2", "s3"]);

  it("解析 shots schema：motion + fx 插件数组", () => {
    const parsed = parseShotFxMotionResponse(
      '{"shots": [{"shotId": "s1", "motion": "punch-in", "fx": ["shake-hard", "chroma"]}, {"shotId": "s2", "motion": "drift", "fx": []}]}',
      shotIds,
    );
    expect(parsed.motions).toEqual({ s1: "punch-in", s2: "drift" });
    expect(parsed.addons).toEqual({ s1: ["shake-hard", "chroma"], s2: [] });
  });

  it("兼容旧 motions schema（无 fx 字段 → 不产 addons 条目）", () => {
    const parsed = parseShotFxMotionResponse(
      '{"motions": [{"shotId": "s1", "motion": "drift"}]}',
      shotIds,
    );
    expect(parsed.motions).toEqual({ s1: "drift" });
    expect(parsed.addons).toEqual({});
  });

  it("插件校验：非法丢弃、同种互斥取首、上限 2 个", () => {
    const parsed = parseShotFxMotionResponse(
      '{"shots": [{"shotId": "s1", "motion": "push-in", "fx": ["shake-soft", "shake-hard", "glow-warm", "chroma", "bogus"]}]}',
      shotIds,
    );
    expect(parsed.addons.s1).toEqual(["shake-soft", "glow-warm"]);
  });

  it("容忍 markdown 代码块与前后杂文；丢弃非法模式与未知 shotId", () => {
    const parsed = parseShotFxMotionResponse(
      '好的：\n```json\n{"shots": [{"shotId": "s1", "motion": "hold", "fx": ["glow-dim"]}, {"shotId": "unknown", "motion": "drift"}, {"shotId": "s2", "motion": "spin"}]}\n```\n以上。',
      shotIds,
    );
    expect(parsed.motions).toEqual({ s1: "hold" });
    expect(parsed.addons).toEqual({ s1: ["glow-dim"] });
  });
});

describe("heuristicShotFxMotions", () => {
  it("与渲染侧规则运镜一致：动作 punch、退场奇数镜走轮换、其余轮换", () => {
    const { motions } = heuristicShotFxMotions(SHOTS);
    expect(motions.s1).toBe("punch-in");
    // s2 含退场词但在奇数镜位（index 1）→ leave-pull 仅偶数镜启用，回落轮换表第 2 项
    expect(motions.s2).toBe(SHOT_FX_MOTION_ROTATION_AT(1));
    expect(motions.s3).toBe(SHOT_FX_MOTION_ROTATION_AT(2));
  });
});

describe("selectShotFxMotions", () => {
  it("空分镜返回 empty", async () => {
    const result = await selectShotFxMotions([]);
    expect(result).toEqual({ motions: {}, addons: {}, source: "empty" });
  });

  it("AI 成功时返回 ai 来源的运镜+插件组合", async () => {
    textMock.mockResolvedValue({
      success: true,
      text: '{"shots": [{"shotId": "s1", "motion": "punch-in", "fx": ["shake-hard", "chroma"]}, {"shotId": "s2", "motion": "drift"}, {"shotId": "s3", "motion": "tilt-up", "fx": ["glow-warm"]}]}',
    });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("ai");
    expect(result.motions).toEqual({ s1: "punch-in", s2: "drift", s3: "tilt-up" });
    expect(result.addons).toEqual({ s1: ["shake-hard", "chroma"], s3: ["glow-warm"] });
    expect(textMock).toHaveBeenCalledOnce();
  });

  it("AI 失败时回落启发式（source=heuristic，不抛错，无插件配置走配方默认）", async () => {
    textMock.mockResolvedValue({ success: false, error: "未配置 AI" });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("heuristic");
    expect(result.motions).toEqual(heuristicShotFxMotions(SHOTS).motions);
    expect(result.addons).toEqual({});
  });

  it("AI 全量非法时同样回落启发式", async () => {
    textMock.mockResolvedValue({ success: true, text: '{"shots": [{"shotId": "s1", "motion": "nope"}]}' });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("heuristic");
  });
});

function SHOT_FX_MOTION_ROTATION_AT(index: number): string {
  // 与 shot-fx-decisions 的轮换表保持同步的最小镜像（避免测试导入实现细节常量导致断言同义反复）
  const rotation = ["push-in", "pull-out", "pan-right", "pan-left", "tilt-down", "tilt-up", "drift"] as const;
  return rotation[index % rotation.length];
}
