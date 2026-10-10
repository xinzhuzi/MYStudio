// camera-move-bridge 桥接测试(10-10 批C,design §2.3)——守护三件事:
// ① 17 值映射快照(确定性全表断言,改表必须过目);
// ② 源同步锁:分镜校准枚举行(shot-calibration-stages.ts L197)增删值时测试红,
//    防两套词汇再度漂移(camera-dictionary 死代码前车之鉴);
// ③ 未映射值兜底:留空枚举/中文原词/生词/"none" 一律 undefined 交回 heuristic。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAMERA_MOVE_TO_MOTION,
  STORYBOARD_CAMERA_MOVE_IDS,
  cameraMoveToMotionId,
} from "./camera-move-bridge";
import { SHOT_FX_MOTION_PRESETS, isShotFxMotionId } from "./shot-fx-decisions";
import { heuristicShotFxMotions } from "./shot-fx-ai";

describe("CAMERA_MOVE_TO_MOTION 17 值映射快照", () => {
  it("全表快照:17 枚举 → 确定性 motion id(或留空 undefined)", () => {
    expect({ ...CAMERA_MOVE_TO_MOTION }).toEqual({
      static: "hold",
      tracking: "drift",
      orbit: undefined,
      "zoom-in": "push-in",
      "zoom-out": "pull-out",
      "pan-left": "pan-left",
      "pan-right": "pan-right",
      "tilt-up": "tilt-up",
      "tilt-down": "tilt-down",
      "dolly-in": "push-in",
      "dolly-out": "pull-out",
      "truck-left": "pan-left",
      "truck-right": "pan-right",
      "crane-up": "tilt-up",
      "crane-down": "tilt-down",
      "drone-aerial": "drift",
      "360-roll": undefined,
    });
  });

  it("闭集守护:恰好 17 键、键序=源枚举行、映射值全在渲染域闭集内且全 legacy(不自动占用 vsc 稀缺修辞)", () => {
    expect(STORYBOARD_CAMERA_MOVE_IDS).toHaveLength(17);
    expect(Object.keys(CAMERA_MOVE_TO_MOTION)).toEqual([...STORYBOARD_CAMERA_MOVE_IDS]);
    for (const id of Object.values(CAMERA_MOVE_TO_MOTION)) {
      if (id === undefined) continue;
      expect(isShotFxMotionId(id)).toBe(true);
      expect(SHOT_FX_MOTION_PRESETS[id]).toBeDefined();
      expect(id.startsWith("vsc:")).toBe(false);
    }
  });
});

describe("源同步锁:分镜校准枚举行", () => {
  it("shot-calibration-stages.ts cameraMovement 行的枚举集 = 桥 17 值 + none(增删值须同步桥)", () => {
    const sourcePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "script",
      "shot-calibration-stages.ts",
    );
    const source = readFileSync(sourcePath, "utf8");
    const enumLine = source
      .split(/\r?\n/)
      .find((line) => line.includes("- cameraMovement:"));
    expect(enumLine).toBeDefined();
    const tokens = (enumLine ?? "")
      .split("- cameraMovement:")[1]!
      .trim()
      .split("/")
      .map((token) => token.trim())
      .filter(Boolean);
    // 整行 18 token:none(未定运镜,不入桥)+ 17 运动值。
    expect(tokens).toHaveLength(18);
    expect(tokens).toContain("none");
    expect(tokens.filter((token) => token !== "none")).toEqual([
      ...STORYBOARD_CAMERA_MOVE_IDS,
    ]);
  });
});

describe("cameraMoveToMotionId 未映射值兜底", () => {
  it("缺省/空白/none(未定运镜)→ undefined", () => {
    expect(cameraMoveToMotionId(undefined)).toBeUndefined();
    expect(cameraMoveToMotionId("")).toBeUndefined();
    expect(cameraMoveToMotionId("   ")).toBeUndefined();
    expect(cameraMoveToMotionId("none")).toBeUndefined();
  });

  it("留空枚举(orbit/360-roll:2D 渲染域无忠实近似)→ undefined 交回 heuristic", () => {
    expect(cameraMoveToMotionId("orbit")).toBeUndefined();
    expect(cameraMoveToMotionId("360-roll")).toBeUndefined();
  });

  it("中文原词与闭集外生词(分镜表「运镜」列自由文本)→ undefined", () => {
    expect(cameraMoveToMotionId("推")).toBeUndefined();
    expect(cameraMoveToMotionId("环绕")).toBeUndefined();
    expect(cameraMoveToMotionId("缓慢zoom-in")).toBeUndefined(); // 带修饰词不匹配=兜底
    expect(cameraMoveToMotionId("fly-through")).toBeUndefined();
  });

  it("归一化:trim/大小写/空白折叠为连字符后命中", () => {
    expect(cameraMoveToMotionId("  Zoom In ")).toBe("push-in");
    expect(cameraMoveToMotionId("DOLLY-OUT")).toBe("pull-out");
  });
});

describe("接线:heuristic 兜底路径消费桥(建议性,AI 摄影指导可覆盖)", () => {
  it("已映射 cameraMove 优先于关键词命中(zoom-in 镜即使带动作词也不 punch-in)", () => {
    const { motions } = heuristicShotFxMotions([
      { shotId: "a", description: "剑光劈落，轰鸣炸开", dialogue: "", cameraMove: "zoom-in" },
    ]);
    expect(motions.a).toBe("push-in");
  });

  it("未映射 cameraMove(中文原词/留空枚举)零影响,走原关键词/轮换链路", () => {
    const keyword = heuristicShotFxMotions([
      { shotId: "a", description: "剑光劈落，轰鸣炸开", dialogue: "" },
    ]);
    const withChineseWord = heuristicShotFxMotions([
      { shotId: "a", description: "剑光劈落，轰鸣炸开", dialogue: "", cameraMove: "环绕" },
    ]);
    const withBlankEnum = heuristicShotFxMotions([
      { shotId: "a", description: "剑光劈落，轰鸣炸开", dialogue: "", cameraMove: "orbit" },
    ]);
    expect(withChineseWord.motions.a).toBe(keyword.motions.a);
    expect(withBlankEnum.motions.a).toBe(keyword.motions.a);
    expect(keyword.motions.a).toBe("punch-in");
  });
});
