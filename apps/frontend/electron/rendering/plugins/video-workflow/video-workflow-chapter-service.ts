import path from "node:path";
import fs from "node:fs";
import type { EditingProjectV1 } from "@/types/editing";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
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
import { defaultCleanRemotionSubtitleAuthority, projectVideoUseArtifactToEditingProject } from "@/lib/studio/video-workflow/editing-project-projection";
import {
  readVideoWorkflowChapterArtifacts,
  type VideoWorkflowChapterArtifacts,
  type VideoWorkflowArtifactReadResult,
} from "./video-workflow-artifact-store";
import type { HyperFramesAdapterResult } from "../hyperframes/hyperframes-adapter";
import type { VideoUseAdapterResult } from "../video-use/video-use-adapter";

const FALLBACK_DECORATIVE_TEMPLATES = [
  "light-leak",
  "film-grain",
  "lens-flare",
  "vignette-pulse",
  "particle-dust",
  "letterbox-cinematic",
  "highlight-box",
] as const;
const FALLBACK_WINDOW_MAX_US = 1_100_000;

/**
 * Deterministic CLI-rotation decorative windows built from the accepted EDL.
 * Mirrors run-full-pipeline's legacy rotation (same template order, parameters
 * and 1.1s clamp) so the App apply path — which passes no hyperFramesWindows —
 * still produces the same decorative layer the CLI fallback provides.
 */
function buildRotationFallbackWindows(
  edl: ReadonlyArray<{
    shotId: string;
    timelineStartS: number;
    durationS: number;
    transitionToNext?: { effectId: string; durationUs: number };
  }>,
): HyperFramesOverlayWindowV1[] {
  let shiftUs = 0;
  return edl.map((entry, index) => {
    const templateId = FALLBACK_DECORATIVE_TEMPLATES[index % FALLBACK_DECORATIVE_TEMPLATES.length]!;
    // Transition overlaps pull the laid-out timeline earlier than the raw EDL;
    // windows are EDL-anchored, so shift by the cumulative overlap before this shot.
    const startUs = Math.max(0, Math.round(entry.timelineStartS * 1_000_000) - shiftUs);
    const durationUs = Math.max(1, Math.min(Math.round(entry.durationS * 1_000_000), FALLBACK_WINDOW_MAX_US));
    const parameters: Record<string, string | number | boolean> = templateId === "light-leak"
      ? { intensity: 0.42, hue: (index * 31) % 360 }
      : templateId === "film-grain"
        ? { opacity: 0.2 }
        : templateId === "lens-flare"
          ? { x: 18 + ((index * 13) % 64), y: 24 + ((index * 7) % 34), size: 260 }
          : templateId === "vignette-pulse"
            ? { darkness: 0.42, speed: 2.4 }
            : templateId === "particle-dust"
              ? { count: 40, speed: 7 }
              : templateId === "letterbox-cinematic"
                ? { barHeight: 12, fadeIn: 0.25 }
                : { x: 50, y: 50, color: "#f4d06f" };
    if (entry.transitionToNext && entry.transitionToNext.effectId !== "cut") {
      shiftUs += entry.transitionToNext.durationUs;
    }
    return {
      slotId: `effect-${entry.shotId}`,
      cueId: `decorative-effect-${index + 1}`,
      startUs,
      durationUs,
      templateId,
      parameters,
    };
  });
}

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
  /** 当前章节 Remotion shot 输出槽（可选注入）。提供时投影写入剪辑身份证据
   * 与槽位相对路径，渲染门禁按构造通过；缺失时投影保持旧行为。 */
  readCurrentShotSlots?: (identity: { projectId: string; chapterId: string }) => Promise<RemotionCurrentSlotV1[]>;
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
      /** 投影用过的当前 shot 槽位（渲染层二次投影喂同一份，保证两写者产物一致）。 */
      currentShotSlots?: RemotionCurrentSlotV1[];
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
    // 缺口修复（08-18）：① 产物缺 subtitleAuthority 时补产品默认（clean-remotion）
    // 并回写产物文件，后续重投影不再依赖运行时回退；② 注入当前 shot 槽位，
    // 投影写入身份证据与槽位相对路径。
    const appliedArtifact = { ...checked.value };
    if (!appliedArtifact.subtitleAuthority) {
      appliedArtifact.subtitleAuthority = defaultCleanRemotionSubtitleAuthority(appliedArtifact, now());
      try {
        fs.writeFileSync(
          artifacts.value.paths.videoUsePath,
          `${JSON.stringify(appliedArtifact, null, 2)}\n`,
          "utf8",
        );
      } catch (error) {
        return {
          success: false,
          code: "video-use-artifact-authority-persist-failed",
          message: `产物 subtitleAuthority 回写失败: ${error instanceof Error ? error.message : String(error)}`,
          videoUseArtifactPath: artifacts.value.paths.videoUsePath,
        };
      }
    }
    let shotSlots: RemotionCurrentSlotV1[] = [];
    if (options.readCurrentShotSlots) {
      try {
        shotSlots = await options.readCurrentShotSlots({ projectId: input.projectId, chapterId: input.chapterId });
      } catch {
        shotSlots = [];
      }
    }
    const projection = projectVideoUseArtifactToEditingProject({
      project: currentEditingProject,
      artifact: appliedArtifact,
      now: now(),
      shotSlots,
    });
    if (!projection.success) {
      return {
        success: false,
        code: "editing-project-projection-invalid",
        message: projection.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"),
        videoUseArtifactPath: artifacts.value.paths.videoUsePath,
      };
    }
    const subtitleOverlayWindows = checked.value.overlaySlots.filter((slot) => !slot.templateId).map((slot) => {
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
    const decorativeOverlayWindows = checked.value.overlaySlots.filter((slot) => slot.templateId).map((slot) => ({
      slotId: slot.slotId,
      cueId: slot.cueId,
      startUs: slot.startUs,
      durationUs: slot.durationUs,
      templateId: slot.templateId!,
      parameters: slot.parameters!,
    }));
    // MYSTUDIO_OVERLAY_MODE=legacy 与 run-full-pipeline 同口径：强制走 CLI 轮换装饰窗，
    // 忽略 artifact 氛围词装饰决策（43 窗单 composition 命中 heavy-overlay lint 熔断）。
    const artifactHasDecorativeWindows = process.env.MYSTUDIO_OVERLAY_MODE !== "legacy" && decorativeOverlayWindows.length > 0;
    // App apply 路径不传 hyperFramesWindows：legacy/无装饰槽时由服务自建轮换兜底，
    // 与 CLI fallback 逐字同参（模板序/参数/1.1s 钳制），两路径装饰窗计数一致。
    const fallbackWindows = input.hyperFramesWindows?.length
      ? input.hyperFramesWindows
      : buildRotationFallbackWindows(checked.value.edl);
    if (!artifactHasDecorativeWindows) {
      console.warn(
        `[video-workflow] no decorative overlay decisions in use; fallback windows: ${fallbackWindows.length}`
          + (input.hyperFramesWindows?.length ? " (caller-provided)" : " (service rotation)"),
      );
    }
    const overlayWindows = [
      ...subtitleOverlayWindows,
      ...(artifactHasDecorativeWindows ? decorativeOverlayWindows : fallbackWindows),
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
      videoUseArtifact: appliedArtifact,
      hyperFramesArtifact: rendered.artifact,
      videoUseArtifactPath: artifacts.value.paths.videoUsePath,
      hyperFramesArtifactPath: rendered.artifactPath ?? artifacts.value.paths.hyperFramesPath,
      currentShotSlots: shotSlots,
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
