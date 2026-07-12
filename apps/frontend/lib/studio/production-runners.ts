import {
  createEpisodeMergePlan,
  createTrackRenderPlan,
} from "@/lib/studio/production";
import type {
  ProductionTrack,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";

interface StudioRendererApi {
  renderTrackCandidate: (
    plan: ReturnType<typeof createTrackRenderPlan>,
  ) => Promise<{ success: boolean; filePath?: string; previewUrl?: string; error?: string }>;
  mergeEpisode: (
    plan: ReturnType<typeof createEpisodeMergePlan>,
  ) => Promise<{ success: boolean; filePath?: string; previewUrl?: string; error?: string }>;
  probeMedia: (filePath: string) => Promise<{
    path: string;
    sizeBytes: number;
    mtimeMs: number;
    sha256: string;
    duration: number;
    streams: string[];
  }>;
}

function resolveStudioRenderer(renderer?: Partial<StudioRendererApi>) {
  const value = renderer ?? window.studioRenderer;
  if (!value) throw new Error("本地 FFmpeg renderer 仅在桌面应用中可用");
  return value;
}

export async function runProductionTrackRender({
  track,
  storyboards,
  renderer,
}: {
  track: ProductionTrack;
  storyboards: StoryboardItem[];
  renderer?: Pick<StudioRendererApi, "renderTrackCandidate">;
}) {
  const api = resolveStudioRenderer(renderer);
  if (!api.renderTrackCandidate) {
    throw new Error("本地 FFmpeg 轨道渲染接口不可用");
  }
  const plan = createTrackRenderPlan(track, storyboards);
  const result = await api.renderTrackCandidate(plan);
  if (!result?.success || !result.filePath) {
    throw new Error(result?.error || "本地 FFmpeg 合成失败");
  }
  return { ...result, filePath: result.filePath };
}

export async function runProductionEpisodeMerge({
  candidates,
  renderer,
}: {
  candidates: VideoCandidate[];
  renderer?: Pick<StudioRendererApi, "mergeEpisode">;
}) {
  const api = resolveStudioRenderer(renderer);
  if (!api.mergeEpisode) {
    throw new Error("本地 FFmpeg 成片拼接接口不可用");
  }
  const plan = createEpisodeMergePlan(candidates);
  const result = await api.mergeEpisode(plan);
  if (!result?.success || !result.filePath) {
    throw new Error(result?.error || "成片拼接失败");
  }
  return { ...result, filePath: result.filePath };
}

export async function probeProductionMedia({
  filePath,
  renderer,
}: {
  filePath: string;
  renderer?: Pick<StudioRendererApi, "probeMedia">;
}) {
  const api = resolveStudioRenderer(renderer);
  if (!api.probeMedia) {
    throw new Error("本地媒体证据探测接口不可用");
  }
  const evidence = await api.probeMedia(filePath);
  if (evidence.path !== filePath) {
    throw new Error(`最终媒体证据路径不匹配: ${evidence.path || "(空)"}`);
  }
  if (!(evidence.sizeBytes > 0)) throw new Error("最终媒体文件为空");
  if (!(evidence.mtimeMs > 0)) throw new Error("最终媒体修改时间证据非法");
  if (!(evidence.duration > 0) || evidence.duration > 180) {
    throw new Error(`最终媒体时长不符合 180 秒上限: ${evidence.duration}`);
  }
  if (!/^[a-f0-9]{64}$/.test(evidence.sha256)) {
    throw new Error("最终媒体 SHA-256 证据非法");
  }
  if (!evidence.streams.includes("video") || !evidence.streams.includes("audio")) {
    throw new Error(`最终媒体缺少音视频流: ${evidence.streams.join(",")}`);
  }
  return evidence;
}
