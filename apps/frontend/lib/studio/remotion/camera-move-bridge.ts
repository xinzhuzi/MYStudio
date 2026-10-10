// 分镜域 cameraMove → 渲染域 motion id 桥(10-10 video-shotcraft×Remotion 批C,
// design §2.3)。打通两套零映射词汇:分镜校准阶段的运镜枚举
// (lib/script/shot-calibration-stages.ts L197 cameraMovement 行)自动落
// 渲染域 SHOT_FX_MOTION_PRESETS 闭集,不再各说各话。
//
// 定位=**建议不是硬门**(design 原文):桥产出只作 shotFx.motion 初始建议,
// AI 摄影指导(selectShotFxMotions)可覆盖——AI 显式选择永远胜出;
// AI 漏选/不可用回落时,桥建议优先于关键词/镜序轮换(分镜域已定的运镜词
// 是比画面文本关键词更强的信号)。接入点=shot-fx-ai 决策链
// (ShotFxAiShotInput.cameraMove / heuristicShotFxMotions / AI 路径补位),
// 写入仍走既有 shotFx 自动决策链(决议 D3,装饰层不进 sourceFingerprint)。
//
// 映射纪律:
// - 确定性:纯查表,无随机/无时间依赖(铁律);同输入恒同输出。
// - 输出值域=legacy 18 闭集,不自动占用 vsc:*——vsc 配方是稀缺修辞
//   (dolly-zoom ≤1/crash-zoom ≤2 配额+「vsc 镜总数克制」指南),逐镜枚举
//   自动映射会系统性冲垮配额纪律;AI 摄影指导可显式选 vsc 覆盖。
// - 留空(=undefined):2D 静图渲染域无忠实近似的枚举(如 orbit 环绕),
//   交回 heuristic 兜底(design §2.3 明示口径)。
// - legacy 18 值不动(D2):桥只做分镜词→渲染词的翻译,不改渲染闭集本身。
//
// camera-dictionary 死代码前车之鉴:本桥的消费点=shot-fx-ai 决策链
// (heuristic 兜底+AI 路径补位+prompt 初始建议行),由
// camera-move-bridge.test.ts 的接线断言守护,禁止"只建映射表"。

import { isShotFxMotionId, type ShotFxMotionId } from "./shot-fx-decisions";

/**
 * 分镜域校准运镜闭集:shot-calibration-stages.ts L197 cameraMovement 枚举的
 * 17 个运动值(整行 18 token 减 "none"——none=未定运镜,不是运动,不入桥;
 * "static"=显式固定机位,是运动决策的反向表达,入桥映射 hold)。
 * 顺序=源枚举行顺序;camera-move-bridge.test.ts 有源文件同步锁
 * (枚举行增删值时测试红,防两套词汇再度漂移)。
 */
export const STORYBOARD_CAMERA_MOVE_IDS = [
  "static",
  "tracking",
  "orbit",
  "zoom-in",
  "zoom-out",
  "pan-left",
  "pan-right",
  "tilt-up",
  "tilt-down",
  "dolly-in",
  "dolly-out",
  "truck-left",
  "truck-right",
  "crane-up",
  "crane-down",
  "drone-aerial",
  "360-roll",
] as const;

export type StoryboardCameraMoveId = (typeof STORYBOARD_CAMERA_MOVE_IDS)[number];

/**
 * 17 值确定性映射表(undefined=留空,heuristic 兜底)。2D 静图 pan/zoom 域的
 * 近似口径逐条注明;多条枚举收敛同一 motion 是诚实行为(2D 下不可分)。
 */
export const CAMERA_MOVE_TO_MOTION: Readonly<
  Record<StoryboardCameraMoveId, ShotFxMotionId | undefined>
> = {
  // 固定机位=锁帧静止:hold(仅 AI 可选不进轮换;桥=AI 侧建议与之相容,
  // 刻意静止正是分镜域的显式决策,轮换运镜反而违背意图)。
  static: "hold",
  // 跟拍无方向信息:不虚构 pan 方向,drift=方向不可知的最轻漫游近似。
  tracking: "drift",
  // 环绕:2D 静图无环绕自由度(design §2.3 明示留空口径)→ heuristic 兜底。
  orbit: undefined,
  // 变焦推近/拉远:最直译的一对(design 示例 zoom-in→push-in)。
  "zoom-in": "push-in",
  "zoom-out": "pull-out",
  // 横摇/竖摇:渲染域同名直译。
  "pan-left": "pan-left",
  "pan-right": "pan-right",
  "tilt-up": "tilt-up",
  "tilt-down": "tilt-down",
  // 前移/后移:2D pan/zoom 下 dolly 与 zoom 不可分(同为本体缩放),
  // 收敛到推/拉的 legacy 工作马力,不占用 vsc:slow-push-in 等稀缺修辞。
  "dolly-in": "push-in",
  "dolly-out": "pull-out",
  // 横移:2D 静图读作同向横摇。
  "truck-left": "pan-left",
  "truck-right": "pan-right",
  // 摇臂升降:2D 读作竖摇同向。
  "crane-up": "tilt-up",
  "crane-down": "tilt-down",
  // 航拍漫游:drift 近似;vsc:drone-dive-landing 是「俯冲入题」的稀缺修辞
  // (章头定场专用),不作为逐镜枚举的自动落点——AI 摄影指导可显式选它覆盖。
  "drone-aerial": "drift",
  // 全周横滚:无 2D 配方(rotate 通道尚未被 LayeredVisualClip 消费,批A-1
  // 遗留)→ 留空 heuristic 兜底。
  "360-roll": undefined,
};

/**
 * 分镜域运镜词 → 渲染域 motion id(确定性查表,建议性)。
 * 归一化仅 trim/小写/空白折叠为连字符;未映射值(中文原词「推/摇/环绕」、
 * 校准行外的生词、"none")一律 undefined,调用方回落 keyword/轮换启发式。
 * fail-closed 兜底:映射值必须仍在渲染域闭集内,表被改坏时不发射非法 id。
 */
export function cameraMoveToMotionId(cameraMove?: string): ShotFxMotionId | undefined {
  const raw = cameraMove?.trim();
  if (!raw) return undefined;
  const normalized = raw.toLowerCase().replace(/\s+/g, "-");
  if (!(normalized in CAMERA_MOVE_TO_MOTION)) return undefined;
  const motion = CAMERA_MOVE_TO_MOTION[normalized as StoryboardCameraMoveId];
  return isShotFxMotionId(motion) ? motion : undefined;
}
