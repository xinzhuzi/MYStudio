// 导演台 p3 成片导入器(1115 实弹 FR,App 侧):
// 引擎 GET /my_daoyan/chapter_videos?chapter={章} 拉本章 p3 清单(后端纯函数
// list_chapter_videos,seg 目录取 mtime 最新一枚)→按 id+episodeId 对拍在册
// 分镜(h3-orphan-importer 同口径)→逐镜 fetch /view 落项目 exports/{章}/{镜}/
// daoyan-p3.mp4 → probeMedia 一发取 sha256+duration(失败退 crypto.subtle.digest)
// →updateStoryboard 挂当前视频(H3 生产同构写法)。
//
// D-1 硬门:unmatched(镜不在册/镜属他章)只进报告不落库——章自动视频编译
// continuityPolicy="required"(useChapterAutoVideoActions.ts enqueueRemotionShots),
// store 默认新增分镜无 continuityState,自动 addStoryboard 会毒化整章编译。
// 换 mediaRef 不入 visualContinuityFingerprint(lib/studio/visual-continuity.ts
// :449 只取 prompt/references/continuity),连续性指纹零触碰。
// 全部副作用经 deps 注入,可无头测(样板=comfy-bridge-writeback-consumer)。

import { getComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { resolveEngineBaseUrl } from "@/lib/studio/engine-line/resolve-engine-base-url";
import { normalizeH3DurationUs } from "@/lib/studio/h3-duration-us";
import { buildProjectFileUrl } from "@/lib/upscale/project-file-url";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";

/** 清单 HTTP 超时(毫秒):小 JSON,照分镜批量队列通道量级放宽一档。 */
const LIST_HTTP_TIMEOUT_MS = 10_000;
/** 单镜视频下载超时(毫秒):p3 成片为整章最重载荷,给足 120s。 */
const VIDEO_HTTP_TIMEOUT_MS = 120_000;

/** 落盘文件名(项目内 exports/{章}/{镜}/ 下恒定名:重导覆盖,sha 对拍幂等)。 */
export const DAOYAN_P3_FILENAME = "daoyan-p3.mp4";

/** 清单条目(引擎应答归一;seg_id/url 必填,其余信息字段缺省容忍)。 */
export interface DaoyanChapterVideoEntry {
  /** 引擎侧 seg 目录名=分镜 id(导演台导入分镜表时逐镜同源)。 */
  segId: string;
  /** 引擎 /view 相对地址(形如 /view?filename=…&type=output&subfolder=…)。 */
  url: string;
  filename?: string;
  subfolder?: string;
  size?: number;
  mtime?: number;
}

/**
 * 引擎 GET /my_daoyan/chapter_videos 原始应答 → 清单(纯函数,容错:任何畸形
 * 输入都落空清单不抛错——纪律同 parseStoryboardBatchEngineQueueReply)。
 */
export function parseDaoyanChapterVideosReply(raw: unknown): DaoyanChapterVideoEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const videos = (raw as { videos?: unknown }).videos;
  if (!Array.isArray(videos)) return [];
  const entries: DaoyanChapterVideoEntry[] = [];
  for (const item of videos) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as {
      seg_id?: unknown;
      url?: unknown;
      filename?: unknown;
      subfolder?: unknown;
      size?: unknown;
      mtime?: unknown;
    };
    if (typeof candidate.seg_id !== "string" || !candidate.seg_id.trim()) continue;
    if (typeof candidate.url !== "string" || !candidate.url.trim()) continue;
    entries.push({
      segId: candidate.seg_id,
      url: candidate.url,
      ...(typeof candidate.filename === "string" ? { filename: candidate.filename } : {}),
      ...(typeof candidate.subfolder === "string" ? { subfolder: candidate.subfolder } : {}),
      ...(typeof candidate.size === "number" && Number.isFinite(candidate.size) ? { size: candidate.size } : {}),
      ...(typeof candidate.mtime === "number" && Number.isFinite(candidate.mtime) ? { mtime: candidate.mtime } : {}),
    });
  }
  return entries;
}

/** 导入结果:updated=实际写回镜数;unchanged=同 path 同 sha 幂等跳过(零写入)。 */
export interface DaoyanChapterVideoImportResult {
  updated: number;
  unchanged: number;
  /** D-1:对不上在册分镜的引擎片(seg 无此镜/镜属他章),只报告不落库。 */
  skippedUnmatched: Array<{ segId: string; reason: string }>;
  /** 单镜下载/落盘/探测失败行(其余镜继续)。 */
  failed: Array<{ segId: string; reason: string }>;
}

/** 全部副作用通道(生产默认实现;测试逐项注入)。 */
export interface DaoyanVideoImportDeps {
  /** 生效引擎 base(远端 settings url 优先,否则本机 127.0.0.1:port);解析失败抛可读错误。 */
  resolveBase: () => Promise<string>;
  /** 拉清单(默认引擎 HTTP;返回原始 JSON)。 */
  fetchListReply: (base: string, chapterId: string) => Promise<unknown>;
  /** 拉单镜视频字节(默认 `${base}${url}` arrayBuffer,120s 超时)。 */
  fetchVideoBytes: (base: string, video: DaoyanChapterVideoEntry) => Promise<ArrayBuffer>;
  /** 落项目文件(默认 projectFiles.writeBinary)。 */
  writeBinary: (
    projectId: string,
    relativePath: string,
    bytes: ArrayBuffer,
  ) => Promise<{ success: boolean; url?: string; error?: string }>;
  /** 主进程 ffprobe 一发取 sha256+duration;桥不可用/探测失败返回 null(走 sha 兜底)。 */
  probeMedia: (url: string) => Promise<{ sha256: string; duration: number } | null>;
  /** probe 失败时的 sha 兜底(默认 crypto.subtle.digest,先例 remotion-shot-plan-builder);失败返回 undefined。 */
  sha256Hex: (bytes: ArrayBuffer) => Promise<string | undefined>;
  /** 分镜写回(默认 useStudioStore.updateStoryboard)。 */
  updateStoryboard: (id: string, updates: Partial<StoryboardItem>) => void;
}

async function defaultResolveBase(): Promise<string> {
  const client = getComfyEngineClient();
  if (!client) throw new Error("引擎客户端不可用(仅桌面应用支持导入导演台视频)");
  const status = await client.getEngineStatus();
  const port = typeof status.port === "number" && Number.isFinite(status.port) && status.port > 0 ? status.port : null;
  const base = await resolveEngineBaseUrl(port);
  if (!base) throw new Error("引擎地址解析失败(本机引擎未运行且未配置远端引擎)");
  return base;
}

const defaultDeps: DaoyanVideoImportDeps = {
  resolveBase: defaultResolveBase,
  fetchListReply: async (base, chapterId) => {
    const response = await fetch(
      `${base}/my_daoyan/chapter_videos?chapter=${encodeURIComponent(chapterId)}`,
      { signal: AbortSignal.timeout(LIST_HTTP_TIMEOUT_MS) },
    );
    if (!response.ok) throw new Error(`导演台视频清单拉取失败(HTTP ${response.status})`);
    return response.json().catch(() => null);
  },
  fetchVideoBytes: async (base, video) => {
    const response = await fetch(`${base}${video.url}`, { signal: AbortSignal.timeout(VIDEO_HTTP_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`导演台视频下载失败(HTTP ${response.status})`);
    return response.arrayBuffer();
  },
  writeBinary: async (projectId, relativePath, bytes) => {
    const bridge = getProjectFilesBridge();
    if (!bridge) return { success: false, error: "项目文件桥不可用(仅桌面应用支持导入)" };
    return bridge.writeBinary({ projectId, relativePath, bytes });
  },
  probeMedia: async (url) => {
    const probe = typeof window !== "undefined" ? window.studioRenderer?.probeMedia : undefined;
    if (!probe) return null;
    try {
      const evidence = await probe(url);
      return { sha256: evidence.sha256, duration: evidence.duration };
    } catch {
      return null;
    }
  },
  sha256Hex: async (bytes) => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return undefined;
    try {
      const digest = await subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      return undefined;
    }
  },
  updateStoryboard: (id, updates) => {
    useStudioStore.getState().updateStoryboard(id, updates);
  },
};

/** 落盘相对路径段守卫(章/镜 id 进路径前过白名单,防注入段)。 */
function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/**
 * 导入导演台本章 p3 成片:清单→对拍→逐镜下载落项目→挂当前视频。
 * 只更新在册分镜(D-1:unmatched 不 addStoryboard 只报告);单镜失败不拦其余镜;
 * 同 path 且同 sha 幂等跳过(零写回,不动 outputVersion);sha 变才 outputVersion+1。
 * 引擎 base 解析失败/清单拉取失败抛可读错误(入口 toast)。
 */
export async function importDaoyanChapterVideos(input: {
  chapterId: string;
  projectId: string;
  storyboards: StoryboardItem[];
  deps?: Partial<DaoyanVideoImportDeps>;
}): Promise<DaoyanChapterVideoImportResult> {
  const deps: DaoyanVideoImportDeps = { ...defaultDeps, ...input.deps };
  const base = await deps.resolveBase();
  if (!base) throw new Error("引擎地址解析失败,无法拉取导演台视频清单");
  const videos = parseDaoyanChapterVideosReply(await deps.fetchListReply(base, input.chapterId));

  const result: DaoyanChapterVideoImportResult = { updated: 0, unchanged: 0, skippedUnmatched: [], failed: [] };
  for (const video of videos) {
    const storyboard = input.storyboards.find((item) => item.id === video.segId);
    if (!storyboard) {
      result.skippedUnmatched.push({ segId: video.segId, reason: "分镜不在册" });
      continue;
    }
    if (storyboard.episodeId !== input.chapterId) {
      result.skippedUnmatched.push({ segId: video.segId, reason: `分镜属他章(${storyboard.episodeId})` });
      continue;
    }
    try {
      if (!isSafePathSegment(input.chapterId) || !isSafePathSegment(storyboard.id)) {
        throw new Error("章/镜 id 不合法,拒绝落盘路径");
      }
      const bytes = await deps.fetchVideoBytes(base, video);
      const relativePath = `exports/${input.chapterId}/${storyboard.id}/${DAOYAN_P3_FILENAME}`;
      const written = await deps.writeBinary(input.projectId, relativePath, bytes);
      if (!written.success) throw new Error(written.error ?? "项目内落盘失败");
      const path = buildProjectFileUrl(input.projectId, relativePath);
      const probe = await deps.probeMedia(path);
      const sha = probe?.sha256 ?? (await deps.sha256Hex(bytes));
      const durationUs =
        probe && Number.isFinite(probe.duration) && probe.duration > 0
          ? Math.round(probe.duration * 1_000_000)
          : undefined;
      // 幂等:同 path 且同 sha(现值可比)→零写回,不动 outputVersion
      const shaUnchanged = sha !== undefined && storyboard.mediaRef?.contentSha256 === sha;
      if (shaUnchanged && storyboard.mediaRef?.path === path) {
        result.unchanged += 1;
        continue;
      }
      deps.updateStoryboard(storyboard.id, {
        mediaRef: { kind: "video", path, ...(sha !== undefined ? { contentSha256: sha } : {}) },
        // B1 同款守卫:仅正整数微秒放行;probe 失败无时长=undefined(显式清旧值,
        // 旧片实测时长不得冒充新片,口径同 comfy-bridge-writeback-consumer)
        h3DurationUs: normalizeH3DurationUs(durationUs),
        state: "ready",
        stale: false,
        ...(shaUnchanged ? {} : { outputVersion: (storyboard.outputVersion ?? 0) + 1 }),
      });
      result.updated += 1;
    } catch (error) {
      result.failed.push({ segId: video.segId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
