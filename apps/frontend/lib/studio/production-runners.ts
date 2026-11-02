import { isDaojieAdaptation } from "./daojie-generation-audit";
import { DAOJIE_STRICT_DURATION_SECONDS } from "./daojie-duration-policy";

interface StudioRendererApi {
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
  if (!value) throw new Error("媒体证据探测接口仅在桌面应用中可用");
  return value;
}

export async function probeProductionMedia({
  filePath,
  renderer,
  directorManualId,
  sourceText,
}: {
  filePath: string;
  directorManualId?: string;
  sourceText?: string;
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
  const durationLimit = isDaojieAdaptation(directorManualId, sourceText) ? DAOJIE_STRICT_DURATION_SECONDS : 180;
  if (!Number.isFinite(evidence.duration) || !(evidence.duration > 0) || evidence.duration > durationLimit) {
    throw new Error(`最终媒体时长不符合 ${durationLimit} 秒上限: ${evidence.duration}`);
  }
  if (!/^[a-f0-9]{64}$/.test(evidence.sha256)) {
    throw new Error("最终媒体 SHA-256 证据非法");
  }
  if (!evidence.streams.includes("video") || !evidence.streams.includes("audio")) {
    throw new Error(`最终媒体缺少音视频流: ${evidence.streams.join(",")}`);
  }
  return evidence;
}
