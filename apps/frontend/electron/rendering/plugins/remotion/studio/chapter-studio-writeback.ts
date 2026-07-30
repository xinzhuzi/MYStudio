import fs from "node:fs";
import type { EditingProjectV1, EditingTransition } from "@/types/editing";
import {
  parseChapterStudioProjection,
  type ChapterStudioProjectionIdentityExpectation,
  type ChapterStudioProjectionInput,
} from "./chapter-studio-projection";
import { validateEditingProject } from "@/lib/studio/editing/validation";

export type ChapterStudioWritebackResult =
  | { success: true; project: EditingProjectV1; changedFields: string[] }
  | { success: false; issues: Array<{ path: string; message: string }> };

export interface ApplyChapterStudioProjectionInput {
  project: EditingProjectV1;
  projection: ChapterStudioProjectionInput;
  now: number;
}

/**
 * Converts the small authored Studio projection back into the persisted
 * EditingProject contract. Media IDs, source paths and arbitrary code never
 * cross this boundary; only the documented editing whitelist is applied.
 */
export function applyChapterStudioProjectionToEditingProject(
  input: ApplyChapterStudioProjectionInput,
): ChapterStudioWritebackResult {
  const issues: Array<{ path: string; message: string }> = [];
  const { project, projection } = input;
  if (projection.projectId !== project.projectId || projection.chapterId !== project.episodeId) {
    issues.push({ path: "identity", message: "projection 不属于当前项目或章节" });
  }
  if (projection.editingProjectId !== project.id || projection.editingRevision !== project.revision) {
    issues.push({ path: "identity", message: "projection editing revision 已过期" });
  }
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    issues.push({ path: "now", message: "writeback 时间戳无效" });
  }
  const projectionIds = projection.clips.map((clip) => clip.shotId);
  const projectionIdSet = new Set<string>();
  projection.clips.forEach((clip, index) => {
    if (projectionIdSet.has(clip.shotId)) {
      issues.push({ path: `clips[${index}].shotId`, message: `Studio projection 重复绑定 shot: ${clip.shotId}` });
    }
    projectionIdSet.add(clip.shotId);
  });
  const clipByShotId = new Map(
    project.clips
      .filter((clip) => clip.source.kind === "storyboardVideo")
      .flatMap((clip) => {
        const shotId = clip.source.evidence.storyboardId;
        return typeof shotId === "string" && shotId.length > 0
          ? [[shotId, clip] as const]
          : [];
      }),
  );
  if (clipByShotId.size !== projection.clips.length) {
    issues.push({ path: "clips", message: "当前 editing 工程的 Remotion shot 集合与 Studio projection 不一致" });
  }
  if ([...clipByShotId.keys()].some((shotId) => !projectionIdSet.has(shotId))) {
    issues.push({ path: "clips", message: "Studio projection 未覆盖当前 editing 工程的全部 Remotion shot" });
  }
  projection.clips.forEach((clip, index) => {
    if (!clipByShotId.has(clip.shotId)) {
      issues.push({ path: `clips[${index}].shotId`, message: `找不到受控 shot: ${clip.shotId}` });
    }
    if (clip.crop.x !== 0
      || clip.crop.y !== 0
      || clip.crop.width !== project.renderSettings.width
      || clip.crop.height !== project.renderSettings.height) {
      issues.push({
        path: `clips[${index}].crop`,
        message: "EditingClip 尚无 crop 持久化语义，拒绝丢弃 Studio crop 修改",
      });
    }
  });
  const visualTrackSource = project.tracks.find((track) => projectionIds.every((id) => track.clipIds.includes(clipByShotId.get(id)?.id ?? "")));
  if (!visualTrackSource) {
    issues.push({ path: "tracks", message: "找不到承载全部 Remotion shot 的单一视觉轨道" });
  }
  if (issues.length > 0) return { success: false, issues };

  const nextClips = project.clips.map((clip) => ({ ...clip }));
  const nextById = new Map(nextClips.map((clip) => [clip.id, clip]));
  const trackKindById = new Map(project.tracks.map((track) => [track.id, track.kind]));
  const orderedClipIds: string[] = [];
  let startFrame = 0;
  const nextTransitions = project.transitions.filter((transition) => {
    const from = nextById.get(transition.fromClipId)?.source.evidence.storyboardId;
    const to = nextById.get(transition.toClipId)?.source.evidence.storyboardId;
    return !(typeof from === "string" && projectionIds.includes(from)
      && typeof to === "string" && projectionIds.includes(to));
  });
  const existingTransitions = new Map(
    project.transitions.map((transition) => [`${transition.fromClipId}->${transition.toClipId}`, transition]),
  );

  projection.clips.forEach((projectionClip, index) => {
    const original = clipByShotId.get(projectionClip.shotId);
    if (!original) return;
    const next = nextById.get(original.id);
    if (!next) return;
    const durationUs = framesToUs(projectionClip.durationInFrames, projection.fps);
    const trimStartUs = framesToUs(projectionClip.trimBeforeFrames, projection.fps);
    next.startUs = framesToUs(startFrame, projection.fps);
    next.durationUs = durationUs;
    next.trimStartUs = trimStartUs;
    next.volume = projectionClip.volume;
    next.muted = projectionClip.volume <= 0;
    next.transform = { ...projectionClip.transform };
    orderedClipIds.push(next.id);

    const subtitleClips = nextClips.filter((candidate) => candidate.trackId !== next.trackId
      && trackKindById.get(candidate.trackId) === "text"
      && candidate.source.evidence.storyboardId === projectionClip.shotId);
    if (subtitleClips.length > 1) {
      issues.push({ path: `clips[${index}].subtitle`, message: "一个 shot 只能绑定一个受控字幕片段" });
    } else if (projectionClip.subtitle && subtitleClips.length === 0) {
      issues.push({ path: `clips[${index}].subtitle`, message: "projection 字幕没有对应的持久化字幕片段" });
    } else if (subtitleClips[0]) {
      subtitleClips[0].source = { ...subtitleClips[0].source, text: projectionClip.subtitle };
      subtitleClips[0].startUs = next.startUs;
      subtitleClips[0].durationUs = durationUs;
    }

    const transition = projectionClip.transitionAfter;
    const nextProjection = projection.clips[index + 1];
    if (transition?.type === "fade" && nextProjection) {
      const nextOriginal = clipByShotId.get(nextProjection.shotId);
      if (!nextOriginal) return;
      const key = `${next.id}->${nextOriginal.id}`;
      const previous = existingTransitions.get(key);
      const value: EditingTransition = {
        ...(previous ?? {
          id: `studio-fade-${next.id}-${nextOriginal.id}`,
          params: {},
        }),
        fromClipId: next.id,
        toClipId: nextOriginal.id,
        effectId: "fade",
        durationUs: framesToUs(transition.durationInFrames, projection.fps),
      };
      nextTransitions.push(value);
      startFrame += projectionClip.durationInFrames - transition.durationInFrames;
    } else {
      startFrame += projectionClip.durationInFrames;
    }
  });

  let nextTracks = project.tracks;
  if (visualTrackSource) {
    const orderedSet = new Set(orderedClipIds);
    const firstVisual = visualTrackSource.clipIds.findIndex((id) => orderedSet.has(id));
    const remaining = visualTrackSource.clipIds.filter((id) => !orderedSet.has(id));
    const insertAt = firstVisual < 0 ? visualTrackSource.clipIds.length : firstVisual;
    const clipIds = [
      ...visualTrackSource.clipIds.slice(0, insertAt).filter((id) => !orderedSet.has(id)),
      ...orderedClipIds,
      ...remaining,
    ];
    nextTracks = project.tracks.map((track) => track.id === visualTrackSource.id ? { ...track, clipIds } : track);
  }

  const nextProject: EditingProjectV1 = {
    ...project,
    revision: project.revision + 1,
    manuallyEdited: true,
    stale: false,
    staleReason: undefined,
    clips: nextClips,
    tracks: nextTracks,
    transitions: nextTransitions,
    updatedAt: input.now,
  };
  const validation = validateEditingProject(nextProject);
  if (!validation.success) {
    return {
      success: false,
      issues: validation.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    };
  }
  return {
    success: true,
    project: validation.value,
    changedFields: ["shotOrder", "duration", "transform", "volume", "subtitle", "transition"],
  };
}

export interface WatchChapterStudioProjectionOptions {
  sourcePath: string;
  expectedIdentity: ChapterStudioProjectionIdentityExpectation;
  getCurrentProject: () => Promise<EditingProjectV1 | undefined>;
  onWriteback: (result: ChapterStudioWritebackResult & { success: true }) => Promise<void>;
  now?: () => number;
  debounceMs?: number;
}

export interface ChapterStudioProjectionWatcher {
  close: () => void;
}

/** Watches the native Studio projection and applies only valid authored edits. */
export function watchChapterStudioProjection(
  options: WatchChapterStudioProjectionOptions,
): ChapterStudioProjectionWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let running = false;
  const now = options.now ?? Date.now;
  const apply = async () => {
    if (closed || running) return;
    running = true;
    try {
      const source = await fs.promises.readFile(options.sourcePath, "utf8");
      const parsed = parseChapterStudioProjection(source, options.expectedIdentity);
      if (!parsed.success) return;
      const current = await options.getCurrentProject();
      if (!current) return;
      const result = applyChapterStudioProjectionToEditingProject({
        project: current,
        projection: parsed.value,
        now: now(),
      });
      if (result.success) await options.onWriteback(result);
    } finally {
      running = false;
    }
  };
  const watcher = fs.watch(options.sourcePath, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void apply(); }, options.debounceMs ?? 120);
  });
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}

function framesToUs(frames: number, fps: number): number {
  return Math.max(1, Math.round((frames * 1_000_000) / fps));
}
