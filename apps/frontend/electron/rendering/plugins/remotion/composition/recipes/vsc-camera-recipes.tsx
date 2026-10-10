// vsc camera 配方分发(10-10 批B)——CompositionVisualClipProps.vsc 的渲染端
// 消费点:id→组件闭集映射 + fail-closed 分发(未知 id 渲染前拒,spec §3)。
// 本文件是 Remotion 能力矩阵对 vsc camera 五卡的真源(renderer-router 的
// vscMotion 登记以此为据):每个 id 都有组件、每个组件都有 id,同步由
// vsc-camera-recipes 同目录测试守护。
//
// 媒体=分镜静图(image)或 current shot MP4(video,章节装配路径的镜头素材):
// 组件按 kind 选 Img/OffthreadVideo(音轨透传同 VisualClip 纪律)。depth 两卡
// (parallax-glide/dolly-zoom)不经本文件——走 panZoom+layerStack 层系数通道。

import type {
  CompositionVscCameraRecipeId,
  CompositionVisualClipProps,
} from "../composition-props";
import {
  CrashZoomPunch,
  VSC_CRASH_ZOOM_PUNCH_ID,
  type CrashZoomPunchProps,
} from "./crash-zoom-punch";
import {
  DutchRollToLevel,
  VSC_DUTCH_ROLL_TO_LEVEL_ID,
  type DutchRollToLevelProps,
} from "./dutch-roll-to-level";
import {
  SlowPushIn,
  VSC_SLOW_PUSH_IN_ID,
  type SlowPushInProps,
} from "./slow-push-in";
import {
  PullBackIsolation,
  VSC_PULL_BACK_ISOLATION_ID,
  type PullBackIsolationProps,
} from "./pull-back-isolation";
import {
  DroneDiveLanding,
  VSC_DRONE_DIVE_LANDING_ID,
  type DroneDiveLandingProps,
} from "./drone-dive-landing";

/** camera 五卡 id 闭集(id 常量真源=各组件文件,此处只聚合不另造字符串)。 */
export const VSC_CAMERA_RECIPE_IDS: readonly CompositionVscCameraRecipeId[] = [
  VSC_CRASH_ZOOM_PUNCH_ID,
  VSC_DUTCH_ROLL_TO_LEVEL_ID,
  VSC_SLOW_PUSH_IN_ID,
  VSC_PULL_BACK_ISOLATION_ID,
  VSC_DRONE_DIVE_LANDING_ID,
];

export function isVscCameraRecipeId(value: unknown): value is CompositionVscCameraRecipeId {
  return typeof value === "string" && (VSC_CAMERA_RECIPE_IDS as readonly string[]).includes(value);
}

/** 五组件 props 的公共媒体子集(各组件自带配方参数,烧死卡片默认值=D4)。 */
type VscRecipeComponentProps = CrashZoomPunchProps &
  DutchRollToLevelProps &
  SlowPushInProps &
  PullBackIsolationProps &
  DroneDiveLandingProps;

const VSC_CAMERA_RECIPE_COMPONENTS: Readonly<
  Record<CompositionVscCameraRecipeId, (props: VscRecipeComponentProps) => React.ReactElement>
> = {
  [VSC_CRASH_ZOOM_PUNCH_ID]: CrashZoomPunch,
  [VSC_DUTCH_ROLL_TO_LEVEL_ID]: DutchRollToLevel,
  [VSC_SLOW_PUSH_IN_ID]: SlowPushIn,
  [VSC_PULL_BACK_ISOLATION_ID]: PullBackIsolation,
  [VSC_DRONE_DIVE_LANDING_ID]: DroneDiveLanding,
};

/**
 * vsc camera 配方片段渲染:吃 CompositionVisualClipProps 的媒体位
 * (src/kind/trim/playbackRate/muted/volume——与 VisualClip 同一口径),
 * 渲染形态由配方组件全权接管(panZoom/fx/grade 不叠加)。
 * 未知 id 在此 throw(fail-closed;props 校验是第一闸,这里是渲染前最后一闸)。
 */
export function VscCameraRecipeClip(
  props: Pick<
    CompositionVisualClipProps,
    "vsc" | "src" | "kind" | "trimStartFrames" | "playbackRate" | "muted"
  > & { volume?: number },
): React.ReactElement {
  const id = props.vsc?.id;
  const Recipe = id ? VSC_CAMERA_RECIPE_COMPONENTS[id] : undefined;
  if (!Recipe) {
    throw new Error(`未知 vsc camera 配方(渲染前拒,fail-closed): ${String(id)}`);
  }
  return (
    <Recipe
      src={props.src}
      kind={props.kind === "video" ? "video" : "image"}
      trimStartFrames={props.trimStartFrames}
      playbackRate={props.playbackRate}
      muted={props.muted}
      volume={props.volume}
    />
  );
}
