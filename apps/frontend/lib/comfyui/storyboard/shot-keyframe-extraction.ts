// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 单镜视频截帧回灌(09-15 teman-absorption P1a,renderer 侧):
 * 单镜视频(H3 出片,mediaRef=video)→ 主进程 ffmpeg 抽帧(桥=window.shotKeyframes)
 * → 帧图(项目数据区 project-file://)合并进该镜 keyframes → 既有双帧回接
 * (storyboard-overview-comfy 的 shotPreview2* 命名契约不变,keyframes[1] 即帧2)。
 *
 * 纯函数(合并/请求构造)与桥调用编排分层:合并逻辑零 IO,单测直调;
 * 桥/存储可注入(默认=window.shotKeyframes + useStudioStore 现势读)。
 */

import {
  KEYFRAME_MAX,
  buildKeyframeId,
  normalizeStoryboardKeyframes,
  validateStoryboardKeyframes,
} from "@/lib/studio/keyframes";
import { parseProjectFileUrl } from "@/lib/upscale/project-file-url";
import type { ShotKeyframeExtractReplyV1, ShotKeyframeExtractRequestV1 } from "@/electron/ipc/studio/shot-keyframe-ipc";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem, StoryboardKeyframe } from "@/types/studio";

/** 自动抽帧档位(与主进程通道同口径:3/5/9) */
export type ShotSampleCount = 3 | 5 | 9;

export type ShotKeyframeExtractMode =
  | { kind: "single"; timestampS: number }
  | { kind: "uniform"; count: ShotSampleCount };

export interface ShotKeyframesBridge {
  extract: (payload: ShotKeyframeExtractRequestV1) => Promise<ShotKeyframeExtractReplyV1>;
}

/** 帧输出目录(项目根相对;主进程侧同路径解析,store 布局收口一致) */
export function keyframeOutputDir(storyboard: Pick<StoryboardItem, "episodeId" | "id">): string {
  return `media/storyboard-keyframes/${sanitizePathSegment(storyboard.episodeId)}/${sanitizePathSegment(storyboard.id)}`;
}

/** 镜 id/章 id → 文件名安全段(与主进程 isSafeFileStem 同口径) */
export function sanitizePathSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 64);
  return safe || "shot";
}

/**
 * 抽帧请求构造:视频必须是本项目 project-file://(引擎 userdata/绝对路径零可能);
 * 不满足返回 null——调用方走禁用态而非报错(PRD 风险表裁定)。
 */
export function buildShotKeyframeExtractRequest(input: {
  projectId: string | null | undefined;
  storyboard: Pick<StoryboardItem, "id" | "episodeId" | "mediaRef">;
  mode: ShotKeyframeExtractMode;
}): ShotKeyframeExtractRequestV1 | null {
  const { projectId, storyboard, mode } = input;
  if (!projectId) return null;
  const mediaRef = storyboard.mediaRef;
  if (mediaRef?.kind !== "video" || !mediaRef.path) return null;
  const parsed = parseProjectFileUrl(mediaRef.path);
  if (!parsed || parsed.projectId !== projectId) return null;
  return {
    schemaVersion: 1,
    projectId,
    videoUrl: mediaRef.path,
    relativeOutDir: keyframeOutputDir(storyboard),
    fileStem: sanitizePathSegment(storyboard.id),
    mode,
  };
}

export function getShotKeyframesBridge(): ShotKeyframesBridge | null {
  return typeof window !== "undefined" ? window.shotKeyframes ?? null : null;
}

/** 镜内下一个可用 frameId(`${storyboardId}-kf-N`,N=现有最大后缀+1) */
export function nextKeyframeFrameId(existing: StoryboardKeyframe[], storyboardId: string): string {
  let max = 0;
  for (const frame of existing) {
    const match = /-kf-(\d+)$/.exec(frame.frameId);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return buildKeyframeId(storyboardId, max + 1);
}

/** µs 钳位:严格大于 prevUs(最小步进 1ms)且小于 limitUs;越界返回 null(跳过该帧) */
function clampInUs(valueUs: number, prevUs: number, limitUs?: number): number | null {
  let clamped = Math.max(0, Math.round(valueUs));
  if (clamped <= prevUs) clamped = prevUs + 1_000;
  if (limitUs !== undefined && clamped >= limitUs) return null;
  return clamped;
}

/**
 * 均匀挑 ≤keep 项:首尾必含,中间等距取(items.length≤keep 时全量)。
 * 3 帧档抽 3=全进;5/9 帧档抽出的批次是候选,进 keyframes 的帧数受 1..4
 * 不变式约束(PRD AC2「写入 keyframes」+ store KEYFRAME_MAX 同守)。
 */
export function pickEvenly<T>(items: T[], keep: number): T[] {
  if (items.length <= keep) return items;
  return Array.from({ length: keep }, (_, index) => {
    const position = (index * (items.length - 1)) / (keep - 1);
    return items[Math.round(position)]!;
  });
}

export interface MergeExtractedKeyframesInput {
  storyboardId: string;
  /** 现有关键帧(store 现势;空=视频镜尚无帧序列) */
  existing: StoryboardKeyframe[];
  /** 本批抽帧产物(顺序不限,内部按 timestampS 升序) */
  extracted: Array<{ url: string; timestampS: number }>;
  /** 镜时长上限(秒) */
  durationLimitS?: number;
  /** true=整批替换(自动抽帧);false=尾部追加(存为关键帧) */
  replace: boolean;
}

export interface MergeExtractedKeyframesResult {
  frames: StoryboardKeyframe[];
  /** 被丢弃的候选帧数(满了/越界/碰撞) */
  skipped: number;
  /** 关键帧已满(追加模式下调用方据此禁用按钮) */
  full: boolean;
}

/**
 * 抽帧产物 → 合法 keyframes 序列(纯函数):
 * - 首帧 inUs 恒 0(I2);时间戳升序映射,严格递增(最小步进 1ms);
 * - 末帧 inUs < 镜时长;帧数 1..4;追加模式现有帧原样保留;
 * - 追加产物经 validateStoryboardKeyframes 终检,异常保旧拒新(宁缺勿坏)。
 */
export function mergeExtractedKeyframes(input: MergeExtractedKeyframesInput): MergeExtractedKeyframesResult {
  const { storyboardId, extracted, replace } = input;
  const sortedExtracted = extracted.slice().sort((left, right) => left.timestampS - right.timestampS);
  const existingFull = input.existing.length >= KEYFRAME_MAX;
  if (sortedExtracted.length === 0) {
    return { frames: input.existing, skipped: 0, full: existingFull };
  }
  const limitUs = input.durationLimitS !== undefined ? Math.round(input.durationLimitS * 1_000_000) : undefined;

  if (replace) {
    // 整批重建:首帧 0,其余按时间戳;候选均匀挑 ≤4;越界/塌缩的尾帧丢弃
    const candidates = pickEvenly(sortedExtracted, KEYFRAME_MAX);
    const built: StoryboardKeyframe[] = [];
    let skipped = sortedExtracted.length - candidates.length;
    for (const frame of candidates) {
      const inUs = built.length === 0
        ? 0
        : clampInUs(frame.timestampS * 1_000_000, built[built.length - 1]!.inUs, limitUs);
      if (inUs === null) {
        skipped += 1;
        continue;
      }
      built.push({
        frameId: buildKeyframeId(storyboardId, built.length + 1),
        mediaRef: { kind: "image", path: frame.url },
        inUs,
        origin: { kind: "generated" },
      });
    }
    return { frames: built, skipped, full: false };
  }

  // 追加:现有帧保序保留,新帧按时间戳顺序接尾
  const merged = input.existing.slice();
  let skipped = 0;
  for (let index = 0; index < sortedExtracted.length; index += 1) {
    if (merged.length >= KEYFRAME_MAX) {
      skipped += sortedExtracted.length - index;
      break;
    }
    const frame = sortedExtracted[index]!;
    const prevUs = merged.length ? merged[merged.length - 1]!.inUs : 0;
    const inUs = merged.length === 0 ? 0 : clampInUs(frame.timestampS * 1_000_000, prevUs, limitUs);
    if (inUs === null) {
      skipped += 1;
      continue;
    }
    merged.push({
      frameId: nextKeyframeFrameId(merged, storyboardId),
      mediaRef: { kind: "image", path: frame.url },
      inUs,
      origin: { kind: "generated" },
    });
  }
  if (merged.length === input.existing.length) {
    return { frames: input.existing, skipped, full: existingFull };
  }
  const normalized = normalizeStoryboardKeyframes(merged);
  const issues = validateStoryboardKeyframes(
    normalized,
    input.durationLimitS !== undefined ? { shotDurationUs: limitUs } : {},
  );
  if (issues.length) {
    return { frames: input.existing, skipped: skipped + sortedExtracted.length, full: existingFull };
  }
  return { frames: normalized, skipped, full: normalized.length >= KEYFRAME_MAX };
}

export interface SaveVideoFramesAsKeyframesInput {
  projectId: string | null | undefined;
  storyboard: StoryboardItem;
  mode: ShotKeyframeExtractMode;
}

export interface SaveVideoFramesAsKeyframesResult {
  ok: boolean;
  /** 本批进入 keyframes 的净增帧数(替换模式=新序列长) */
  added: number;
  /** 失败/禁用原因(大白话;调用方 toast 一条,不弹窗) */
  message?: string;
}

/** 依赖注入面(测试用;默认=window 桥 + store 现势) */
export interface SaveVideoFramesDeps {
  bridge?: ShotKeyframesBridge | null;
  getStoryboard?: (id: string) => StoryboardItem | undefined;
  setKeyframes?: (id: string, frames: StoryboardKeyframe[], reason: "edit") => void;
}

/**
 * 截帧回灌编排:抽帧(主进程 ffmpeg)→ 与 store 现势 keyframes 合并 →
 * setStoryboardKeyframes(reason="edit")落库(视频镜不动 mediaRef——H3 时代
 * 裁定:成片即当前视觉资产)。失败返回 ok:false+大白话 message,不抛出
 * (UI 层 toast 一条,禁错误弹窗轰炸)。
 */
export async function saveVideoFramesAsKeyframes(
  input: SaveVideoFramesAsKeyframesInput,
  deps: SaveVideoFramesDeps = {},
): Promise<SaveVideoFramesAsKeyframesResult> {
  const bridge = deps.bridge !== undefined ? deps.bridge : getShotKeyframesBridge();
  const getStoryboard =
    deps.getStoryboard ?? ((id: string) => useStudioStore.getState().storyboards.find((item) => item.id === id));
  const setKeyframes =
    deps.setKeyframes ?? ((id, frames) => useStudioStore.getState().setStoryboardKeyframes(id, frames, "edit"));
  const request = buildShotKeyframeExtractRequest(input);
  if (!request || !bridge) {
    return { ok: false, added: 0, message: "当前视频不在项目内或抽帧通道不可用" };
  }
  let reply: ShotKeyframeExtractReplyV1;
  try {
    reply = await bridge.extract(request);
  } catch (error) {
    return { ok: false, added: 0, message: error instanceof Error ? error.message : String(error) };
  }
  if (!reply.success || reply.frames.length === 0) {
    return { ok: false, added: 0, message: reply.message ?? "抽帧失败,视频可能已失效" };
  }
  const live = getStoryboard(input.storyboard.id) ?? input.storyboard;
  const durationLimitS = (live.durationTarget ?? live.duration) > 0
    ? (live.durationTarget ?? live.duration)
    : reply.durationS;
  const merged = mergeExtractedKeyframes({
    storyboardId: live.id,
    existing: live.keyframes ?? [],
    extracted: reply.frames,
    durationLimitS,
    replace: input.mode.kind === "uniform",
  });
  if (input.mode.kind === "single" && merged.frames.length === (live.keyframes ?? []).length) {
    return { ok: false, added: 0, message: merged.full ? "本镜关键帧已满(最多 4 帧)" : "这一帧没能加入关键帧" };
  }
  if (merged.frames.length === 0) {
    return { ok: false, added: 0, message: reply.message ?? "抽帧失败" };
  }
  try {
    setKeyframes(live.id, merged.frames, "edit");
  } catch (error) {
    return { ok: false, added: 0, message: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, added: merged.frames.length - (live.keyframes ?? []).length };
}
