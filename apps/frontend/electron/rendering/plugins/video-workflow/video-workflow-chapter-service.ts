import path from "node:path";
import {
  type HyperFramesOverlayRequestV1,
  type HyperFramesAlphaFormat,
  type RemotionChapterGateInputV1,
  type RemotionChapterGateResult,
  type VideoUseChapterRunV1,
  validateVideoUseChapterArtifact,
} from "@rendering/contracts/video-workflow";
import { evaluateRemotionChapterGate } from "@/lib/studio/video-workflow/chapter-gate";
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
    const overlayWindows = checked.value.overlaySlots.map((slot) => {
      const subtitle = checked.value.subtitles.find((cue) => cue.shotId === slot.slotId || (cue.startUs < slot.startUs + slot.durationUs && cue.startUs + cue.durationUs > slot.startUs));
      return {
        slotId: slot.slotId,
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
