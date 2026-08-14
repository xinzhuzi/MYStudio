import fs from "node:fs";
import path from "node:path";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { remotionCurrentSlotPaths } from "@/lib/studio/remotion/remotion-current-slot";
import { createProjectFileUrl } from "@/electron/storage/storage-paths";
import type {
  HyperFramesOverlayArtifactV1,
  VideoUseChapterArtifactV1,
} from "@rendering/contracts/video-workflow";
import type {
  RemotionChapterRenderRequest,
  RemotionChapterRenderResult,
} from "@rendering/plugins/remotion/renderer/remotion-chapter-renderer";

export interface FormalChapterRenderer {
  render(input: RemotionChapterRenderRequest): Promise<RemotionChapterRenderResult>;
}

export interface FormalFileIdentity {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
}

const VERIFIED_NON_TEXT_HYPERFRAMES_TEMPLATES = new Set([
  "film-grain",
  "highlight-box",
  "lens-flare",
  "letterbox-cinematic",
  "light-leak",
  "particle-dust",
  "vignette-pulse",
]);

export async function materializeIsolatedShotWorkspace(input: {
  sourceWorkspace: string;
  targetWorkspace: string;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
}): Promise<number> {
  if (!path.isAbsolute(input.sourceWorkspace) || !path.isAbsolute(input.targetWorkspace)) {
    throw new Error("source and target Remotion workspaces must be absolute");
  }
  if (path.resolve(input.sourceWorkspace) === path.resolve(input.targetWorkspace)) {
    throw new Error("isolated Remotion workspace must differ from production");
  }
  for (const slot of input.currentShotSlots) {
    if (slot.target.kind !== "shot") throw new Error("isolated workspace accepts shot slots only");
    const paths = remotionCurrentSlotPaths(slot.target);
    for (const relativePath of [paths.outputPath, paths.jobPath, paths.evidencePath]) {
      const sourcePath = path.resolve(input.sourceWorkspace, relativePath);
      const targetPath = path.resolve(input.targetWorkspace, relativePath);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.link(sourcePath, targetPath);
    }
  }
  return input.currentShotSlots.length;
}

export function assertAcceptedArtifactProjection(input: {
  plan: TimelineRenderPlan;
  videoUse: VideoUseChapterArtifactV1;
  hyperFrames: HyperFramesOverlayArtifactV1;
  productionRemotionRoot: string;
  expectedVisualCount: number;
}): { videoUseEdlCount: number; hyperFramesWindowCount: number } {
  const { plan, videoUse, hyperFrames } = input;
  if (videoUse.status !== "accepted" || videoUse.stage !== "ready" || videoUse.mode !== "editable-edl") {
    throw new Error("video-use artifact must be accepted/ready/editable-edl");
  }
  if (videoUse.projectId !== plan.projectId
    || videoUse.chapterId !== plan.episodeId
    || videoUse.revision !== plan.editingRevision) {
    throw new Error("video-use artifact identity mismatch");
  }
  const visualClips = plan.clips.filter(
    (clip) => clip.trackKind === "video" || clip.trackKind === "image",
  );
  if (visualClips.length !== input.expectedVisualCount || videoUse.edl.length !== input.expectedVisualCount) {
    throw new Error("video-use EDL and visual clip counts must match the accepted shot count");
  }
  visualClips.forEach((clip, index) => {
    const edl = videoUse.edl[index];
    const relativePath = clip.source.path;
    const expectedPath = relativePath ? path.resolve(input.productionRemotionRoot, relativePath) : "";
    if (!relativePath || path.resolve(edl.sourcePath) !== expectedPath) {
      throw new Error(`video-use EDL source mismatch at visual ${index}`);
    }
    if (edl.shotId !== clip.source.evidence.storyboardId) {
      throw new Error(`video-use EDL shot identity mismatch at visual ${index}`);
    }
    const actualTiming = [
      secondsToUs(edl.timelineStartS),
      secondsToUs(edl.durationS),
      secondsToUs(edl.sourceInS),
      secondsToUs(edl.sourceOutS - edl.sourceInS),
    ];
    const expectedTiming = [clip.startUs, clip.durationUs, clip.trimStartUs, clip.durationUs];
    if (actualTiming.some((value, timingIndex) => Math.abs(value - expectedTiming[timingIndex]) > 1)) {
      throw new Error(`video-use EDL timing mismatch at visual ${index}`);
    }
  });

  if (hyperFrames.status !== "accepted"
    || hyperFrames.projectId !== plan.projectId
    || hyperFrames.chapterId !== plan.episodeId
    || hyperFrames.revision !== plan.editingRevision
    || hyperFrames.sourceArtifactSha256 !== videoUse.evidence.artifactSha256
    || hyperFrames.inputSha256 !== videoUse.evidence.inputSha256
    || !hyperFrames.outputPath
    || !hyperFrames.outputSha256
    || hyperFrames.windows.length !== input.expectedVisualCount) {
    throw new Error("HyperFrames artifact is not the accepted overlay for this plan");
  }
  for (const window of hyperFrames.windows) {
    if (!VERIFIED_NON_TEXT_HYPERFRAMES_TEMPLATES.has(window.templateId)) {
      throw new Error(`HyperFrames template is not verified as non-text: ${window.templateId}`);
    }
    const textParameter = Object.keys(window.parameters).find((key) => /text|label/i.test(key));
    if (textParameter) throw new Error(`HyperFrames text parameter is forbidden: ${textParameter}`);
  }
  return {
    videoUseEdlCount: videoUse.edl.length,
    hyperFramesWindowCount: hyperFrames.windows.length,
  };
}

export function projectAcceptedTimelinePlan(
  plan: TimelineRenderPlan,
  expected: {
    projectId: string;
    chapterId: string;
    revision: number;
    expectedVisualCount: number;
  },
): TimelineRenderPlan {
  if (plan.projectId !== expected.projectId
    || plan.episodeId !== expected.chapterId
    || plan.editingRevision !== expected.revision) {
    throw new Error("accepted timeline plan identity mismatch");
  }
  if (plan.renderSettings.subtitleMode !== "none") {
    throw new Error("accepted timeline plan must disable the Remotion text subtitle layer");
  }
  const visualClips = plan.clips.filter(
    (clip) => clip.trackKind === "video" || clip.trackKind === "image",
  );
  if (visualClips.length !== expected.expectedVisualCount) {
    throw new Error(
      `expected ${expected.expectedVisualCount} visual clips, received ${visualClips.length}`,
    );
  }
  const textCount = plan.clips.filter((clip) => clip.trackKind === "text").length;
  if (textCount !== 0) throw new Error(`expected 0 text clips, received ${textCount}`);

  return {
    ...plan,
    clips: plan.clips.map((clip) => {
      if (clip.trackKind !== "video" && clip.trackKind !== "image") return clip;
      if (clip.source.evidence.subtitleAuthority?.mode !== "source-embedded") {
        throw new Error(`visual clip ${clip.id} does not use source-embedded subtitle authority`);
      }
      const relativePath = clip.source.path?.trim();
      if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("://")) {
        throw new Error(`visual clip ${clip.id} must use a relative accepted source path`);
      }
      return {
        ...clip,
        source: {
          ...clip.source,
          path: createProjectFileUrl(plan.projectId, relativePath),
        },
      };
    }),
  };
}

export async function invokeFormalChapterRenderer(input: {
  renderer: FormalChapterRenderer;
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  expectedVisualCount: number;
}): Promise<RemotionCurrentSlotV1> {
  const visualCount = input.plan.clips.filter(
    (clip) => clip.trackKind === "video" || clip.trackKind === "image",
  ).length;
  if (visualCount !== input.expectedVisualCount) {
    throw new Error(`expected ${input.expectedVisualCount} visual clips, received ${visualCount}`);
  }
  const textCount = input.plan.clips.filter((clip) => clip.trackKind === "text").length;
  if (textCount !== 0) {
    throw new Error(`expected 0 text clips, received ${textCount}`);
  }
  if (input.currentShotSlots.length !== input.expectedVisualCount) {
    throw new Error(
      `expected ${input.expectedVisualCount} current shot slots, received ${input.currentShotSlots.length}`,
    );
  }

  const result = await input.renderer.render({
    plan: input.plan,
    currentShotSlots: input.currentShotSlots,
  });
  if (!result.success) {
    throw new Error(`formal RemotionChapterRenderer render failed: ${result.error}`);
  }
  return result.slot;
}

export function assertFormalChapterSlotIdentity(
  slot: RemotionCurrentSlotV1,
  expected: {
    projectId: string;
    chapterId: string;
    editingProjectId: string;
    editingRevision: number;
  },
): void {
  const expectedTarget = {
    kind: "chapter" as const,
    chapterId: expected.chapterId,
    editingProjectId: expected.editingProjectId,
    editingRevision: expected.editingRevision,
  };
  const targets = [slot.target, slot.job.target, slot.evidence.target];
  if (targets.some((target) => JSON.stringify(target) !== JSON.stringify(expectedTarget))) {
    throw new Error("formal renderer target identity mismatch");
  }
  if (slot.projectId !== expected.projectId
    || slot.job.projectId !== expected.projectId
    || slot.evidence.projectId !== expected.projectId) {
    throw new Error("formal renderer project identity mismatch");
  }
  if (slot.job.inputHash !== slot.evidence.inputHash
    || slot.job.bundleContentHash !== slot.evidence.bundleContentHash
    || slot.job.renderSettingsHash !== slot.evidence.renderSettingsHash) {
    throw new Error("formal renderer job/evidence render identity mismatch");
  }
  if (slot.job.status !== "succeeded"
    || slot.job.progress !== 1
    || slot.job.jobId !== slot.evidence.jobId
    || slot.evidence.compositionId !== "ChapterVideo"
    || slot.evidence.renderer.requested !== "remotion"
    || slot.evidence.renderer.actual !== "remotion") {
    throw new Error("formal renderer job/evidence/current-slot identity mismatch");
  }
  if (slot.job.outputPath !== slot.outputPath
    || slot.job.evidencePath !== slot.evidencePath
    || slot.evidence.outputPath !== slot.outputPath) {
    throw new Error("formal renderer output identity mismatch");
  }
}

export function assertStableFileInventory(
  before: Readonly<Record<string, FormalFileIdentity>>,
  after: Readonly<Record<string, FormalFileIdentity>>,
  label: string,
): void {
  const beforePaths = Object.keys(before).sort();
  const afterPaths = Object.keys(after).sort();
  const stable = JSON.stringify(beforePaths) === JSON.stringify(afterPaths)
    && beforePaths.every((filePath) => {
      const left = before[filePath];
      const right = after[filePath];
      return Boolean(left && right
        && left.path === right.path
        && left.sizeBytes === right.sizeBytes
        && left.mtimeMs === right.mtimeMs
        && left.sha256 === right.sha256);
    });
  if (!stable) throw new Error(`${label} changed concurrently`);
}

function secondsToUs(value: number): number {
  return Math.round(value * 1_000_000);
}
