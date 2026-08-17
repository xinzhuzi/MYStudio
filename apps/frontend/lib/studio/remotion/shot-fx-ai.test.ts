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
  { shotId: "s2", description: "他挥手告别，身影远去", dialogue: "" },
  { shotId: "s3", description: "庭院喝茶", dialogue: "今日风平。" },
];

beforeEach(() => {
  textMock.mockReset();
});

describe("parseShotFxMotionResponse", () => {
  const shotIds = new Set(["s1", "s2", "s3"]);

  it("解析裸 JSON 并保留合法条目", () => {
    const parsed = parseShotFxMotionResponse(
      '{"motions": [{"shotId": "s1", "motion": "punch-in"}, {"shotId": "s2", "motion": "leave-pull"}]}',
      shotIds,
    );
    expect(parsed.motions).toEqual({ s1: "punch-in", s2: "leave-pull" });
  });

  it("容忍 markdown 代码块与前后杂文", () => {
    const parsed = parseShotFxMotionResponse(
      '好的，如下：\n```json\n{"motions": [{"shotId": "s1", "motion": "drift"}]}\n```\n以上。',
      shotIds,
    );
    expect(parsed.motions).toEqual({ s1: "drift" });
  });

  it("丢弃非法模式值与未知 shotId", () => {
    const parsed = parseShotFxMotionResponse(
      '{"motions": [{"shotId": "s1", "motion": "orbit-camera"}, {"shotId": "unknown", "motion": "drift"}, {"shotId": "s3", "motion": "tilt-up"}]}',
      shotIds,
    );
    expect(parsed.motions).toEqual({ s3: "tilt-up" });
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
    expect(result).toEqual({ motions: {}, source: "empty" });
  });

  it("AI 成功时返回 ai 来源的合法选择", async () => {
    textMock.mockResolvedValue({
      success: true,
      text: '{"motions": [{"shotId": "s1", "motion": "punch-in"}, {"shotId": "s2", "motion": "leave-pull"}, {"shotId": "s3", "motion": "drift"}]}',
    });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("ai");
    expect(result.motions).toEqual({ s1: "punch-in", s2: "leave-pull", s3: "drift" });
    expect(textMock).toHaveBeenCalledOnce();
  });

  it("AI 失败时回落启发式（source=heuristic，不抛错）", async () => {
    textMock.mockResolvedValue({ success: false, error: "未配置 AI" });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("heuristic");
    expect(result.motions).toEqual(heuristicShotFxMotions(SHOTS).motions);
  });

  it("AI 全量非法时同样回落启发式", async () => {
    textMock.mockResolvedValue({ success: true, text: '{"motions": [{"shotId": "s1", "motion": "nope"}]}' });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("heuristic");
  });
});

function SHOT_FX_MOTION_ROTATION_AT(index: number): string {
  // 与 shot-fx-decisions 的轮换表保持同步的最小镜像（避免测试导入实现细节常量导致断言同义反复）
  const rotation = ["push-in", "pull-out", "pan-right", "pan-left", "tilt-down", "tilt-up", "drift"] as const;
  return rotation[index % rotation.length];
}
