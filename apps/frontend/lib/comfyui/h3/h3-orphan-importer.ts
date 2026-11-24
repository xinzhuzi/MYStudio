// 孤儿导入器(PRD 10-27-storyboard-h3-dual-channel §14.3 件三;候 Q3 兑现+一期偏离补账):
// 盘上 remotion/outputs/shots/{章}/{镜}/h3/*.mp4 里「没有对应 videoCandidates 挂载」的片=孤儿
// (消费器半途崩/writeback 未回收等残留)——扫描→对拍→导入为候选(只挂候选,不动 mediaRef)。
// 幂等=文件名即指纹(filePath 含原文件名不可变,二次扫描对已挂文件零导入)。
// 「设为当前」(写 mediaRef=video+probeMedia)为 §14.3.3 候令边界,本件不做。
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { buildProjectFileUrl, parseProjectFileUrl } from "@/lib/upscale/project-file-url";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";

/** 消费器落盘根(comfy-bridge-writeback-consumer relativePath 前三段)。 */
const H3_SHOTS_ROOT = "remotion/outputs/shots";
/** 落盘文件名白名单:对齐消费器命名 `{policy}_v{version}_{timestamp}.mp4`(consumer safePathSegment+policy 白名单)。 */
const ORPHAN_FILENAME_RE = /^([A-Za-z0-9._-]+)_v(\d+)_(\d+)\.mp4$/;

export interface H3OrphanFile {
  /** 项目根相对全路径(remotion/outputs/shots/{章}/{镜}/h3/{文件名})——导入时 buildProjectFileUrl 的入参。 */
  relativePath: string;
  filename: string;
  policy: string;
  version: number;
  timestamp: number;
}

export interface H3OrphanScanReport {
  shotId: string;
  episodeId: string;
  orphans: H3OrphanFile[];
}

export interface H3OrphanScanResult {
  reports: H3OrphanScanReport[];
  /** 分组在 storyboards 之外(分镜已删/异类残留/他章),报告行禁静默——由入口决定如何提示。 */
  unmatched: Array<{ episodeId: string; shotId: string; files: number }>;
  /** h3/ 目录内文件名不合规被白名单挡掉的数量(异名跳过计数)。 */
  skippedFilenames: number;
}

/** 列举路径(相对 shots 根)拆 `{章}/{镜}/h3/{文件名}`;其余形状=非 H3 片域,整条忽略。 */
function parseOrphanListedPath(listed: string): { episodeId: string; shotId: string; filename: string } | null {
  const segments = listed.replace(/\\/g, "/").split("/");
  if (segments.length !== 4 || segments[2] !== "h3") return null;
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return { episodeId: segments[0]!, shotId: segments[1]!, filename: segments[3]! };
}

function parseOrphanFilename(filename: string): { policy: string; version: number; timestamp: number } | null {
  const match = ORPHAN_FILENAME_RE.exec(filename);
  if (!match) return null;
  return {
    policy: match[1]!,
    version: Number.parseInt(match[2], 10),
    timestamp: Number.parseInt(match[3], 10),
  };
}

/** 该镜已挂候选的项目内 relativePath 集合(对拍基准;跨项目候选不算已挂,照消费器 alreadyApplied 口径)。 */
function mountedRelativePaths(projectId: string, shotId: string): Set<string> {
  const set = new Set<string>();
  for (const candidate of useStudioStore.getState().videoCandidates) {
    if (candidate.provider !== "h3-comfyui" || candidate.meta?.storyboardId !== shotId) continue;
    if (typeof candidate.filePath !== "string") continue;
    const parsed = parseProjectFileUrl(candidate.filePath);
    if (parsed && parsed.projectId === projectId) set.add(parsed.relativePath);
  }
  return set;
}

/**
 * 扫描盘上 H3 孤儿片:一次递归 IPC(project-file-list,主进程上限 2000 文件/4000 目录)
 * 拿全树→按 `{章}/{镜}/h3/` 分组→文件名白名单解析→对拍已挂候选。
 * 桥不可用/列举失败抛错(入口自行决定降级或提示)。
 */
export async function scanH3OrphanVideos(input: {
  projectId: string;
  storyboards: StoryboardItem[];
}): Promise<H3OrphanScanResult> {
  const bridge = getProjectFilesBridge();
  if (!bridge) throw new Error("项目文件桥不可用(仅桌面应用支持扫描盘上 H3 片)");
  const reply = await bridge.list({ projectId: input.projectId, relativePath: H3_SHOTS_ROOT });
  if (!reply.success) throw new Error(reply.error ?? "盘上 H3 片目录列举失败");
  const groups = new Map<string, { episodeId: string; shotId: string; files: H3OrphanFile[] }>();
  let skippedFilenames = 0;
  for (const listed of reply.files ?? []) {
    const parsed = parseOrphanListedPath(listed);
    if (!parsed) continue;
    const match = parseOrphanFilename(parsed.filename);
    if (!match) {
      skippedFilenames += 1;
      continue;
    }
    const key = `${parsed.episodeId}/${parsed.shotId}`;
    const group = groups.get(key) ?? { episodeId: parsed.episodeId, shotId: parsed.shotId, files: [] };
    group.files.push({
      relativePath: `${H3_SHOTS_ROOT}/${listed}`,
      filename: parsed.filename,
      policy: match.policy,
      version: match.version,
      timestamp: match.timestamp,
    });
    groups.set(key, group);
  }
  const reports: H3OrphanScanReport[] = [];
  const unmatched: H3OrphanScanResult["unmatched"] = [];
  for (const group of groups.values()) {
    const storyboard = input.storyboards.find((item) => item.id === group.shotId && item.episodeId === group.episodeId);
    if (!storyboard) {
      unmatched.push({ episodeId: group.episodeId, shotId: group.shotId, files: group.files.length });
      continue;
    }
    const mounted = mountedRelativePaths(input.projectId, storyboard.id);
    const orphans = group.files.filter((file) => !mounted.has(file.relativePath));
    if (orphans.length > 0) reports.push({ shotId: storyboard.id, episodeId: storyboard.episodeId, orphans });
  }
  return { reports, unmatched, skippedFilenames };
}

/**
 * 导入孤儿片为候选(逐字段同构 defaultApplyVideoToStoryboard,仅候选侧):
 * id=`h3-{镜id}-{n}`(n=该 trackId 现有 h3-comfyui 候选数+1,逐片重数)/provider/state/filePath=
 * buildProjectFileUrl/meta 四键(bridgeItemId=`orphan:{文件名}`——与真收件箱数字 id 永不冲突,
 * 真 writeback 重放写新时间戳文件自成新候选,二者并存不误吞消费器幂等键)/createdAt=文件名时间戳。
 * 不动 mediaRef/h3DurationUs/h3AudioPolicy/audioMix(§14.3.3「设为当前」候令);不验内容(极简)。
 * 幂等:同 relativePath 候选已挂→skipped;坏文件名/镜不在册→skipped,零抛错。
 */
export async function importH3OrphanVideos(input: {
  projectId: string;
  storyboards: StoryboardItem[];
  files: H3OrphanFile[];
}): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  // 升序导入(镜→版本→时间戳):候选尾号随版本升,留档顺序=产物时间线
  const ordered = [...input.files].sort(
    (a, b) => a.relativePath.localeCompare(b.relativePath) || a.version - b.version || a.timestamp - b.timestamp,
  );
  const prefix = `${H3_SHOTS_ROOT}/`;
  for (const file of ordered) {
    const listed = file.relativePath.startsWith(prefix) ? file.relativePath.slice(prefix.length) : null;
    const parsed = listed !== null ? parseOrphanListedPath(listed) : null;
    const match = parseOrphanFilename(file.filename);
    if (!parsed || !match || parsed.filename !== file.filename) {
      skipped += 1;
      continue;
    }
    const storyboard = input.storyboards.find((item) => item.id === parsed.shotId && item.episodeId === parsed.episodeId);
    if (!storyboard) {
      skipped += 1;
      continue;
    }
    if (mountedRelativePaths(input.projectId, storyboard.id).has(file.relativePath)) {
      skipped += 1;
      continue;
    }
    const store = useStudioStore.getState();
    const candidateNumber = store.videoCandidates.filter(
      (candidate) => candidate.provider === "h3-comfyui" && candidate.trackId === storyboard.trackId,
    ).length + 1;
    store.addVideoCandidate({
      id: `h3-${storyboard.id}-${candidateNumber}`,
      trackId: storyboard.trackId,
      provider: "h3-comfyui",
      state: "ready",
      filePath: buildProjectFileUrl(input.projectId, file.relativePath),
      meta: {
        policy: match.policy,
        bridgeItemId: `orphan:${file.filename}`,
        originProjectId: input.projectId,
        storyboardId: storyboard.id,
      },
      createdAt: Number.isFinite(file.timestamp) && file.timestamp > 0 ? file.timestamp : Date.now(),
    });
    imported += 1;
  }
  return { imported, skipped };
}
