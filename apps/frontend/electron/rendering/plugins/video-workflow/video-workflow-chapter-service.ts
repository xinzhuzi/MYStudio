import path from "node:path";
import type { EditingProjectV1 } from "@/types/editing";
import type {
  RemotionChapterManifestV2,
} from "@/types/remotion-workspace";
import { createRemotionChapterManifestFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import {
  type HyperFramesOverlayRequestV1,
  type HyperFramesAlphaFormat,
  type HyperFramesOverlayWindowV1,
  type RemotionChapterGateInputV1,
  type RemotionChapterGateResult,
  type VideoUseChapterRunV1,
  isSubtitleCueOwnedByOverlay,
  validateVideoUseChapterArtifact,
} from "@rendering/contracts/video-workflow";
import { evaluateRemotionChapterGate } from "@/lib/studio/video-workflow/chapter-gate";
import { projectVideoUseArtifactToEditingProject } from "@/lib/studio/video-workflow/editing-project-projection";
import {
  readVideoWorkflowChapterArtifacts,
  type VideoWorkflowChapterArtifacts,
  type VideoWorkflowArtifactReadResult,
} from "./video-workflow-artifact-store";
import type { HyperFramesAdapterResult } from "../hyperframes/hyperframes-adapter";
import type { VideoUseAdapterResult } from "../video-use/video-use-adapter";

export interface VideoWorkflowChapterServiceOptions {
  workspaceRootForProject: (projectId: string) => string;
  runVideoUse: (run: VideoUseChapterRunV1) => Promise<VideoUseAdapterResult>;
  renderHyperFrames: (request: HyperFramesOverlayRequestV1) => Promise<HyperFramesAdapterResult>;
  readArtifacts?: (
    identity: Pick<RemotionChapterGateInputV1, "projectId" | "chapterId" | "revision">,
  ) => Promise<VideoWorkflowArtifactReadResult>;
  /** Main-process persistence boundary. Both callbacks are required to apply an
   * accepted artifact, so a successful sidecar output cannot be reported as a
   * successful EditingProject hand-off without a durable revision write. */
  getCurrentEditingProject?: (identity: {
    projectId: string;
    chapterId: string;
  }) => Promise<EditingProjectV1 | undefined>;
  persistEditingProject?: (project: EditingProjectV1) => Promise<void>;
  /** The chapter manifest is part of the same hand-off. When the editable
   * project snapshot changes during video-use projection, update it through
   * the manifest's CAS boundary before publishing the EditingProject. */
  readChapterManifest?: (projectId: string, chapterId: string) => Promise<RemotionChapterManifestV2 | undefined>;
  writeChapterManifest?: (request: {
    projectId: string;
    chapterId: string;
    expectedRevision: number;
    manifest: RemotionChapterManifestV2;
  }) => Promise<unknown>;
  now?: () => number;
}

export interface VideoWorkflowChapterApplyInput {
  projectId: string;
  chapterId: string;
  revision: number;
  inputSha256: string;
  width: number;
  height: number;
  fps: number;
  alphaFormat: HyperFramesAlphaFormat;
  /** Optional non-text effects derived from the accepted EDL timeline. */
  hyperFramesWindows?: readonly HyperFramesOverlayWindowV1[];
}

export type VideoWorkflowChapterApplyResult =
  | {
      success: true;
      videoUseArtifact: NonNullable<VideoWorkflowChapterArtifacts["videoUseArtifact"]>;
      hyperFramesArtifact: NonNullable<VideoWorkflowChapterArtifacts["hyperFramesArtifact"]>;
      videoUseArtifactPath: string;
      hyperFramesArtifactPath: string;
    }
  | { success: false; code: string; message: string; videoUseArtifactPath?: string; hyperFramesArtifactPath?: string };

/**
 * Owns the chapter hand-off between the two sidecar adapters and Remotion.
 * It deliberately does not invent alignment, EDL, review, or overlay output;
 * those must be produced by the pinned workers and persisted before the gate
 * can accept a formal ChapterVideo render.
 */
export function createVideoWorkflowChapterService(options: VideoWorkflowChapterServiceOptions) {
  const readArtifacts = options.readArtifacts ?? ((identity) => readVideoWorkflowChapterArtifacts(
    options.workspaceRootForProject,
    identity,
  ));
  const now = options.now ?? Date.now;

  async function evaluateGate(input: RemotionChapterGateInputV1): Promise<RemotionChapterGateResult> {
    const artifacts = await readArtifacts(input);
    if (!artifacts.success) {
      return {
        accepted: false,
        state: "blocked",
        code: "video-use-artifact-invalid",
        message: artifacts.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"),
      };
    }
    return evaluateRemotionChapterGate({
      ...input,
      videoUseArtifact: artifacts.value.videoUseArtifact,
      hyperFramesArtifact: artifacts.value.hyperFramesArtifact,
    });
  }

  async function applyAcceptedArtifact(input: VideoWorkflowChapterApplyInput): Promise<VideoWorkflowChapterApplyResult> {
    const artifacts = await readArtifacts(input);
    if (!artifacts.success) {
      return { success: false, code: "video-use-artifact-invalid", message: artifacts.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；") };
    }
    const videoUseArtifact = artifacts.value.videoUseArtifact;
    if (!videoUseArtifact) return { success: false, code: "video-use-missing", message: "确认后缺少 video-use artifact" };
    const checked = validateVideoUseChapterArtifact(videoUseArtifact);
    if (!checked.success) return { success: false, code: "video-use-artifact-invalid", message: checked.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"), videoUseArtifactPath: artifacts.value.paths.videoUsePath };
    if (checked.value.status !== "accepted" || checked.value.stage !== "ready" || !checked.value.review) {
      return { success: false, code: "video-use-not-accepted", message: "必须先完成当前 revision 的用户确认", videoUseArtifactPath: artifacts.value.paths.videoUsePath };
    }
    if (checked.value.projectId !== input.projectId || checked.value.chapterId !== input.chapterId || checked.value.revision !== input.revision) {
      return { success: false, code: "video-use-identity-mismatch", message: "video-use artifact identity 与当前章节不一致", videoUseArtifactPath: artifacts.value.paths.videoUsePath };
    }
    if (checked.value.evidence.inputSha256 !== input.inputSha256) {
      return { success: false, code: "video-use-input-drift", message: "video-use artifact 输入指纹已漂移", videoUseArtifactPath: artifacts.value.paths.videoUsePath };
    }
    if (!options.getCurrentEditingProject || !options.persistEditingProject) {
      return {
        success: false,
        code: "editing-project-unavailable",
        message: "当前应用未接入 EditingProject 读取/持久化服务，拒绝把 artifact 视为已应用",
        videoUseArtifactPath: artifacts.value.paths.videoUsePath,
      };
    }
    let currentEditingProject: EditingProjectV1 | undefined;
    try {
      currentEditingProject = await options.getCurrentEditingProject(input);
    } catch (error) {
      return {
        success: false,
        code: "editing-project-read-failed",
        message: `读取当前 EditingProject 失败: ${error instanceof Error ? error.message : String(error)}`,
        videoUseArtifactPath: artifacts.value.paths.videoUsePath,
      };
    }
    if (!currentEditingProject) {
      return {
        success: false,
        code: "editing-project-missing",
        message: "当前章节缺少可投影的 EditingProject",
        videoUseArtifactPath: artifacts.value.paths.videoUsePath,
      };
    }
    const projection = projectVideoUseArtifactToEditingProject({
      project: currentEditingProject,
      artifact: checked.value,
      now: now(),
    });
    if (!projection.success) {
      return {
        success: false,
        code: "editing-project-projection-invalid",
        message: projection.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"),
        videoUseArtifactPath: artifacts.value.paths.videoUsePath,
      };
    }
    const subtitleOverlayWindows = checked.value.overlaySlots.map((slot) => {
      const subtitle = checked.value.subtitles.find((cue) => isSubtitleCueOwnedByOverlay(cue, [slot]));
      return {
        slotId: slot.slotId,
        cueId: slot.cueId,
        startUs: slot.startUs,
        durationUs: slot.durationUs,
        templateId: "kinetic-caption" as const,
        parameters: {
          text: subtitle?.text ?? slot.slotId,
          x: 50,
          y: 82,
          fontSize: 64,
          color: "#ffffff",
        },
      };
    });
    const overlayWindows = [
      ...subtitleOverlayWindows,
      ...(input.hyperFramesWindows ?? []),
    ].sort((left, right) => left.startUs - right.startUs || left.durationUs - right.durationUs);
    const extension = input.alphaFormat === "prores-4444-mov" ? "mov" : input.alphaFormat === "webm-vp9-alpha" ? "webm" : "png";
    const request: HyperFramesOverlayRequestV1 = {
      schemaVersion: 1,
      projectId: input.projectId,
      chapterId: input.chapterId,
      revision: input.revision,
      sourceArtifactSha256: checked.value.evidence.artifactSha256,
      inputSha256: input.inputSha256,
      width: input.width,
      height: input.height,
      fps: input.fps,
      alphaFormat: input.alphaFormat,
      outputPath: path.join(artifacts.value.paths.revisionDir, `hyperframes-overlay.${extension}`),
      windows: overlayWindows,
    };
    const rendered = await options.renderHyperFrames(request);
    if (rendered.state !== "ready") {
      return { success: false, code: rendered.code, message: rendered.message, videoUseArtifactPath: artifacts.value.paths.videoUsePath, hyperFramesArtifactPath: rendered.artifactPath };
    }
    try {
      await synchronizeChapterManifestSourceSnapshot({
        projectId: input.projectId,
        chapterId: input.chapterId,
        project: projection.project,
        readChapterManifest: options.readChapterManifest,
        writeChapterManifest: options.writeChapterManifest,
        now: now(),
      });
    } catch (error) {
      return {
        success: false,
        code: "chapter-manifest-sync-failed",
        message: `章节 manifest 同步失败: ${error instanceof Error ? error.message : String(error)}`,
        videoUseArtifactPath: artifacts.value.paths.videoUsePath,
        hyperFramesArtifactPath: rendered.artifactPath ?? artifacts.value.paths.hyperFramesPath,
      };
    }
    try {
      await options.persistEditingProject(projection.project);
    } catch (error) {
      return {
        success: false,
        code: "editing-project-persist-failed",
        message: `EditingProject 持久化失败: ${error instanceof Error ? error.message : String(error)}`,
        videoUseArtifactPath: artifacts.value.paths.videoUsePath,
        hyperFramesArtifactPath: rendered.artifactPath ?? artifacts.value.paths.hyperFramesPath,
      };
    }
    return {
      success: true,
      videoUseArtifact: checked.value,
      hyperFramesArtifact: rendered.artifact,
      videoUseArtifactPath: artifacts.value.paths.videoUsePath,
      hyperFramesArtifactPath: rendered.artifactPath ?? artifacts.value.paths.hyperFramesPath,
    };
  }

  return {
    runVideoUse: options.runVideoUse,
    renderHyperFrames: options.renderHyperFrames,
    readArtifacts,
    evaluateGate,
    applyAcceptedArtifact,
  };
}

async function synchronizeChapterManifestSourceSnapshot(input: {
  projectId: string;
  chapterId: string;
  project: EditingProjectV1;
  readChapterManifest?: VideoWorkflowChapterServiceOptions["readChapterManifest"];
  writeChapterManifest?: VideoWorkflowChapterServiceOptions["writeChapterManifest"];
  now: number;
}): Promise<void> {
  if (!input.readChapterManifest || !input.writeChapterManifest) return;
  const current = await input.readChapterManifest(input.projectId, input.chapterId);
  if (!current) throw new Error("当前章节缺少 Remotion chapter manifest");
  if (current.sourceSnapshotHash === input.project.sourceSnapshotHash) return;
  const next: RemotionChapterManifestV2 = {
    ...current,
    revision: current.revision + 1,
    sourceSnapshotHash: input.project.sourceSnapshotHash,
    updatedAt: input.now,
    manifestFingerprint: "",
  };
  next.manifestFingerprint = await createRemotionChapterManifestFingerprint(next);
  await input.writeChapterManifest({
    projectId: input.projectId,
    chapterId: input.chapterId,
    expectedRevision: current.revision,
    manifest: next,
  });
}
