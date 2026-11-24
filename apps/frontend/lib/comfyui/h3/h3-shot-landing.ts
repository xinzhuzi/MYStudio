// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * H3 单镜视频落账共用真身(1115 fire F2③,零新语义——从
 * comfy-bridge-writeback-consumer defaultApplyVideoToStoryboard 抽出):
 * mediaRef=video + outputVersion+1 + h3DurationUs 共享守卫 + h3AudioPolicy +
 * policy=full 且未显式设混音自动 h3-baked + addVideoCandidate 台账
 * (id=h3-{镜id}-{该 track 现有 h3 候选数+1} 防撞)。
 * 消费面:①收件箱消费器(本地链);②远端 settings 批量直落(F2②);
 * ③1115 存量 19 片配对挂载(F2⑥,兜底工具)。三处同一真源,禁再各写一份副本。
 */
import { dialogueAudioPolicy } from "@/lib/comfyui/h3/h3-shot-prompt";
import { normalizeH3DurationUs } from "@/lib/studio/h3-duration-us";
import { parseProjectFileUrl } from "@/lib/upscale/project-file-url";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";

export interface LandH3ShotVideoInput {
  storyboardId: string;
  url: string;
  /** 引擎产物策略(full=台词烧镜内/ambient=音效床;窄化口径与消费器一致) */
  policy: string;
  /** ffprobe 实测微秒时长;缺失/非法由 normalizeH3DurationUs 拒为 undefined(清旧值) */
  h3DurationUs?: number;
  /** 台账溯源:收件箱条目数字 id / 远端直落标记 / backfill 标记 */
  bridgeItemId: string | number;
  originProjectId?: string;
}

/**
 * 落账正门(同步;镜像 consumer defaultApplyVideoToStoryboard 逐字段):
 * 返回新建候选 id;分镜不在 store(已删)=返回 null 零写(照消费器静默口径)。
 */
export function landH3ShotVideo(input: LandH3ShotVideoInput): string | null {
  const store = useStudioStore.getState();
  const storyboard = store.storyboards.find((entry) => entry.id === input.storyboardId);
  if (!storyboard) return null;
  const candidateNumber = store.videoCandidates.filter(
    (candidate) => candidate.provider === "h3-comfyui" && candidate.trackId === storyboard.trackId,
  ).length + 1;
  store.updateStoryboard(input.storyboardId, {
    mediaRef: { kind: "video", path: input.url },
    outputVersion: (storyboard.outputVersion ?? 0) + 1,
    // B1(09-29):时长一律过共享守卫;换片后未知时长清空旧值——旧片的实测时长
    // 不得冒充新片(残留会挡掉「探测失败静默降级名义时长」,排轨按假真源走)。
    h3DurationUs: normalizeH3DurationUs(input.h3DurationUs),
    // 10-11 音频分工 R3c:回写同步落音频政策(供 mediaRef 分支语义/混音分档/
    // 诊断;非 full 一律窄化 ambient)。候选侧 meta.policy 一直有,此为分镜字段。
    h3AudioPolicy: input.policy === "full" ? "full" : "ambient",
    // 10-27 H3 双通道 Q6:policy=full 纯对白镜烧了台词在片内,若停留默认混音
    // tts-stack(视频静音+成片链跳过其外挂 TTS)→整镜无声;落位时未显式设过
    // 混音(audioMix===undefined)自动 h3-baked 防无声;用户已设任意值不覆写,
    // ambient 不动(默认 tts-stack 由外挂 TTS 出声,语义不变)。
    ...(input.policy === "full" && storyboard.audioMix === undefined ? { audioMix: "h3-baked" as const } : {}),
  });
  const candidateId = `h3-${storyboard.id}-${candidateNumber}`;
  store.addVideoCandidate({
    id: candidateId,
    trackId: storyboard.trackId,
    provider: "h3-comfyui",
    filePath: input.url,
    meta: {
      policy: input.policy,
      bridgeItemId: input.bridgeItemId,
      originProjectId: input.originProjectId,
      storyboardId: storyboard.id,
    },
    state: "ready",
    createdAt: Date.now(),
  });
  return candidateId;
}

/** 主进程 ffprobe 时长探测(微秒)——桥不可用/探测失败/非正时长一律 null
 *  (照消费器默认 probeVideoDuration 同款降级,保留 v1 语义)。 */
export async function probeH3VideoDurationUs(url: string): Promise<number | null> {
  const probeMedia = typeof window !== "undefined" ? window.studioRenderer?.probeMedia : undefined;
  if (!probeMedia) return null;
  try {
    const evidence = await probeMedia(url);
    return Number.isFinite(evidence.duration) && evidence.duration > 0
      ? Math.round(evidence.duration * 1_000_000)
      : null;
  } catch {
    return null;
  }
}

// ── 1115 fire F2⑥:存量回流域配对挂载(兜底工具;P3 全量重出+直落达标则免) ───────

/** 媒体库回流条目最小形状(11-15 存量 19 片:name=full_00001__mp4_{ts}/ambient_…,url=project-file://)。 */
export interface FireArchiveMediaEntryInput {
  name: string;
  url: string;
}

export interface FireArchiveH3Pair {
  shotId: string;
  shotIndex: number;
  url: string;
  mediaName: string;
  policy: "full" | "ambient";
  /** 媒体名前缀与 dialogueAudioPolicy(shot.lines) 交叉核对不一致=true——
   *  宁缺勿错(配对证据链断),挂载工具跳过该对不入账。 */
  policyMismatch: boolean;
}

export interface FireArchiveH3Pairing {
  pairs: FireArchiveH3Pair[];
  /** 媒体条数与镜数不一致(1:1 证据链断)时=true:pairs 恒空,拒绝盲配。 */
  countMismatch: boolean;
  /** policyMismatch=true 的对数(报告用;这些对不挂载) */
  mismatchCount: number;
}

/** 媒体名尾部毫秒时间戳(入库序真源;11-15 实盘 mediaFiles 无 createdAt 字段,
 *  库名尾缀即 saveToMediaLibrary 落库时刻)。非数字尾缀=0(排序垫底,可被对拍剔除)。 */
function fireArchiveMediaTimestamp(name: string): number {
  const match = /(\d{10,})$/.exec(name.trim());
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

function fireArchiveMediaPolicy(name: string): "full" | "ambient" | null {
  const prefix = name.split("_")[0];
  return prefix === "full" || prefix === "ambient" ? prefix : null;
}

/**
 * 配对纯函数(1115 批存量 19 片;证据=diagnostics 失败序 S001→S019 ↔ 媒体库
 * 入库时间戳升序 1:1,每条失败恒=对应入库+60.3s 回收窗耗尽):镜按 index 升序、
 * 媒体按名尾时间戳升序,zip 1:1;policy=媒体名前缀,与 dialogueAudioPolicy
 * (shot.lines)交叉核对(不一致标记 mismatch 不挂,宁缺勿错)。条数不等=证据链
 * 断,恒返回空对(禁半配——缺失位在中段时升序对齐即错位盲配)。
 */
export function pairFireArchiveH3Videos(
  shots: StoryboardItem[],
  mediaEntries: FireArchiveMediaEntryInput[],
): FireArchiveH3Pairing {
  const orderedShots = [...shots].sort((a, b) => a.index - b.index);
  const orderedMedia = [...mediaEntries].sort(
    (a, b) => fireArchiveMediaTimestamp(a.name) - fireArchiveMediaTimestamp(b.name),
  );
  if (orderedShots.length === 0 || orderedShots.length !== orderedMedia.length) {
    return { pairs: [], countMismatch: true, mismatchCount: 0 };
  }
  let mismatchCount = 0;
  const pairs = orderedShots.map((shot, position) => {
    const media = orderedMedia[position]!;
    const mediaPolicy = fireArchiveMediaPolicy(media.name);
    const policy = mediaPolicy ?? dialogueAudioPolicy(shot.lines);
    const policyMismatch = mediaPolicy === null || mediaPolicy !== dialogueAudioPolicy(shot.lines);
    if (policyMismatch) mismatchCount += 1;
    return {
      shotId: shot.id,
      shotIndex: shot.index,
      url: media.url,
      mediaName: media.name,
      policy,
      policyMismatch,
    };
  });
  return { pairs, countMismatch: false, mismatchCount };
}

export interface LandFireArchiveH3VideosDeps {
  /** 时长探测 DI(缺省=probeH3VideoDurationUs 主进程桥;测试注入桩) */
  probeDurationUs?: (url: string) => Promise<number | null>;
}

export interface FireArchiveLandingReportEntry {
  shotId: string;
  status: "landed" | "already-video" | "policy-mismatch" | "missing";
  candidateId?: string;
}

/**
 * 存量配对挂载执行器(F2⑥):逐对走 landH3ShotVideo 正门(零裸写——与收件箱/
 * 远端直落同一落账真身;幂等键=mediaRef 已 video 即跳过,二次跑零写)。
 * originProjectId 取媒体 url 的项目归属(parseProjectFileUrl,跨项目条目拒挂);
 * bridgeItemId=backfill:{shotId}(与真收件箱数字 id/直落标记永不相撞)。
 */
export async function landFireArchiveH3Videos(
  pairs: FireArchiveH3Pair[],
  deps: LandFireArchiveH3VideosDeps = {},
): Promise<{ landed: number; report: FireArchiveLandingReportEntry[] }> {
  const probe = deps.probeDurationUs ?? probeH3VideoDurationUs;
  let landed = 0;
  const report: FireArchiveLandingReportEntry[] = [];
  for (const pair of [...pairs].sort((a, b) => a.shotIndex - b.shotIndex)) {
    const shot = useStudioStore.getState().storyboards.find((entry) => entry.id === pair.shotId);
    if (!shot) {
      report.push({ shotId: pair.shotId, status: "missing" });
      continue;
    }
    if (shot.mediaRef?.kind === "video") {
      report.push({ shotId: pair.shotId, status: "already-video" });
      continue;
    }
    if (pair.policyMismatch) {
      report.push({ shotId: pair.shotId, status: "policy-mismatch" });
      continue;
    }
    const originProjectId = parseProjectFileUrl(pair.url)?.projectId;
    if (!originProjectId) {
      report.push({ shotId: pair.shotId, status: "missing" });
      continue;
    }
    const h3DurationUs = await probe(pair.url).catch(() => null);
    const candidateId = landH3ShotVideo({
      storyboardId: pair.shotId,
      url: pair.url,
      policy: pair.policy,
      h3DurationUs: h3DurationUs ?? undefined,
      bridgeItemId: `backfill:${pair.shotId}`,
      originProjectId,
    });
    if (candidateId) {
      landed += 1;
      report.push({ shotId: pair.shotId, status: "landed", candidateId });
    } else {
      report.push({ shotId: pair.shotId, status: "missing" });
    }
  }
  return { landed, report };
}
