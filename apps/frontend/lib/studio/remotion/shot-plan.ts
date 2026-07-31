import type {
  EditingRenderSettings,
} from "@/types/editing";
import type {
  ProjectMediaReference,
  RemotionChapterManifestV2,
  RemotionShotHumanApprovalV1,
  RemotionShotDefinitionV2,
} from "@/types/remotion-workspace";
import type {
  ContinuityAssetVersion,
  StoryboardItem,
} from "@/types/studio";
import type {
  CompositionAudioClipProps,
  CompositionPanZoom,
  CompositionTransform,
  StoryboardShotCompositionProps,
} from "@/electron/rendering/plugins/remotion/composition/composition-props";
import {
  validateStoryboardShotCompositionProps,
} from "@/electron/rendering/plugins/remotion/composition/composition-props-validation";
import {
  clipDurationInFrames,
  usToFrames,
} from "@/electron/rendering/plugins/remotion/composition/timing";
import { sha256CanonicalJson } from "./canonical-json";
import { validateRemotionAudioBindingFingerprint } from "./remotion-audio-fingerprint";
import { validateRemotionChapterManifestV2 } from "./remotion-manifest-validation";
import {
  approvedVisualReviewIssues,
  storyboardContinuityStateIssues,
  visualReviewInputFingerprint,
} from "../visual-continuity";

/**
 * Renderer-neutral, persisted S3 input. It contains project-relative media
 * references only; capability URLs are created by the preview/render session.
 */
export interface RemotionShotPlanV1 {
  schemaVersion: 1;
  target: "shot";
  projectId: string;
  chapterId: string;
  chapterRevision: number;
  sourceSnapshotHash: string;
  renderSettings: EditingRenderSettings;
  visualKind: "image" | "video";
  shot: RemotionShotDefinitionV2;
  inputHash: string;
}

export interface CompileRemotionShotPlanInput {
  projectId: string;
  chapterId: string;
  chapterRevision: number;
  sourceSnapshotHash: string;
  renderSettings: EditingRenderSettings;
  shot: RemotionShotDefinitionV2;
  storyboard: StoryboardItem;
  /** The first project chapter uses this gate; later chapters can use AI gates. */
  requireHumanApproval?: boolean;
  /** Persisted first-chapter receipt bound to the current shot revision. */
  humanApproval?: RemotionShotHumanApprovalV1;
  continuityPolicy?: "required" | "if-present" | "skip";
  assetVersions?: ContinuityAssetVersion[];
}

export type ShotPlanIssue = {
  code: string;
  path: string;
  message: string;
};

export type ShotPlanResult<T> =
  | { success: true; value: T }
  | { success: false; issues: ShotPlanIssue[] };

export type ShotCapabilityResolver = (reference: ProjectMediaReference) => string;

export interface RemotionShotHumanApprovalExpectation {
  projectId: string;
  chapterId: string;
  shotId: string;
  shotRevision: number;
  inputFingerprint: string;
}

/** Validate the persisted approval receipt at the shot-plan boundary. */
export function validateRemotionShotHumanApproval(
  value: unknown,
  expected: RemotionShotHumanApprovalExpectation,
): ShotPlanResult<RemotionShotHumanApprovalV1> {
  const issues: ShotPlanIssue[] = [];
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [{ code: "review.human_required", path: "$.humanApproval", message: "缺少首章人工批准 receipt" }],
    };
  }
  if (value.schemaVersion !== 1) issue(issues, "$.humanApproval.schemaVersion", "人工批准 receipt schemaVersion 必须为 1", "review.invalid");
  if (value.projectId !== expected.projectId) issue(issues, "$.humanApproval.projectId", "人工批准 receipt projectId 不匹配", "review.scope");
  if (value.chapterId !== expected.chapterId) issue(issues, "$.humanApproval.chapterId", "人工批准 receipt chapterId 不匹配", "review.scope");
  if (value.shotId !== expected.shotId) issue(issues, "$.humanApproval.shotId", "人工批准 receipt shotId 不匹配", "review.scope");
  if (value.shotRevision !== expected.shotRevision) issue(issues, "$.humanApproval.shotRevision", "人工批准 receipt shotRevision 不匹配", "review.scope");
  if (value.inputFingerprint !== expected.inputFingerprint) issue(issues, "$.humanApproval.inputFingerprint", "人工批准 receipt inputFingerprint 已过期", "review.stale");
  if (value.reviewer !== "human") issue(issues, "$.humanApproval.reviewer", "人工批准 receipt 必须来自 human", "review.human_required");
  if (typeof value.inputFingerprint !== "string" || !value.inputFingerprint.trim()) issue(issues, "$.humanApproval.inputFingerprint", "人工批准 receipt inputFingerprint 不能为空", "review.invalid");
  if (!isPositiveInteger(value.approvedAt)) issue(issues, "$.humanApproval.approvedAt", "人工批准 receipt approvedAt 必须为正整数", "review.invalid");
  if (typeof value.evidencePath !== "string" || !value.evidencePath.trim()) issue(issues, "$.humanApproval.evidencePath", "人工批准 receipt 必须绑定 evidencePath", "review.invalid");
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as RemotionShotHumanApprovalV1 };
}

/** Compile one approved storyboard into a stable, renderer-neutral shot plan. */
export async function compileRemotionShotPlan(
  input: CompileRemotionShotPlanInput,
): Promise<ShotPlanResult<RemotionShotPlanV1>> {
  const issues: ShotPlanIssue[] = [];
  if (!isId(input.projectId)) issue(issues, "$.projectId", "项目 ID 无效");
  if (!isId(input.chapterId)) issue(issues, "$.chapterId", "章节 ID 无效");
  if (!isPositiveInteger(input.chapterRevision)) {
    issue(issues, "$.chapterRevision", "章节 revision 必须为正整数");
  }
  if (!isSha256(input.sourceSnapshotHash)) {
    issue(issues, "$.sourceSnapshotHash", "sourceSnapshotHash 必须是 SHA-256");
  }
  if (input.storyboard.episodeId !== input.chapterId) {
    issue(issues, "$.storyboard.episodeId", "分镜必须属于当前章节");
  }
  if (input.storyboard.id !== input.shot.storyboardId) {
    issue(issues, "$.shot.storyboardId", "shot 与 StoryboardItem 身份不一致");
  }
  if (input.storyboard.index !== input.shot.index) {
    issue(issues, "$.storyboard.index", "shot 与 StoryboardItem 顺序不一致");
  }
  if (input.storyboard.state !== "ready") {
    issue(issues, "$.storyboard.state", "分镜必须处于 ready 状态才能编译 Remotion shot plan");
  }

  const mediaRef = input.storyboard.mediaRef;
  const visualKind = mediaRef?.kind;
  if (visualKind !== "image" && visualKind !== "video") {
    issue(issues, "$.storyboard.mediaRef", "分镜必须有 image 或 video 视觉素材");
  } else if (!mediaRef || !mediaRef.path.trim()) {
    issue(issues, "$.storyboard.mediaRef.path", "视觉素材路径不能为空");
  }
  if (input.storyboard.stale) {
    issue(issues, "$.storyboard.stale", input.storyboard.staleReason || "分镜连续性已过期");
  }
  if (requiresDialogueAudio(input.storyboard) && !input.shot.audioBindings.some(
    (binding) => binding.renderScope === "shot" && binding.role === "voice",
  )) {
    issue(issues, "$.shot.audioBindings", "当前分镜包含台词，但没有 shot-scoped voice 音频");
  }
  const continuityPolicy = input.continuityPolicy ?? "required";
  if (continuityPolicy === "required" && !input.storyboard.continuityState) {
    issue(issues, "$.storyboard.continuityState", "缺少当前连续性状态");
  }
  if (continuityPolicy !== "skip" && input.storyboard.continuityState) {
    for (const continuityIssue of storyboardContinuityStateIssues(input.storyboard)) {
      issue(issues, "$.storyboard.continuityState", continuityIssue.message, continuityIssue.code);
    }
  }

  const review = input.storyboard.visualReview;
  if (review?.status === "rejected") {
    issue(issues, "$.storyboard.visualReview", review.reasons.join("；") || "视觉审核未通过", "review.rejected");
  }
  if (input.requireHumanApproval) {
    if (review?.status !== "approved" || review.reviewer !== "human") {
      issue(issues, "$.storyboard.visualReview", "首章进入 Remotion 队列前必须完成当前 revision 的人工批准", "review.human_required");
    } else {
      for (const reviewIssue of approvedVisualReviewIssues(input.storyboard, review, input.assetVersions ?? [])) {
        issue(issues, "$.storyboard.visualReview", reviewIssue.message, reviewIssue.code);
      }
    }
    const approval = validateRemotionShotHumanApproval(input.humanApproval, {
      projectId: input.projectId,
      chapterId: input.chapterId,
      shotId: input.shot.shotId,
      shotRevision: input.shot.revision,
      inputFingerprint: visualReviewInputFingerprint(input.storyboard),
    });
    if (!approval.success) {
      for (const approvalIssue of approval.issues) {
        issue(issues, approvalIssue.path, approvalIssue.message, approvalIssue.code);
      }
    }
  }

  const chapterValidation = validateRemotionChapterManifestV2(
    shotValidationManifest(input),
  );
  if (!chapterValidation.success) {
    for (const validationIssue of chapterValidation.issues) {
      issue(issues, validationIssue.path, validationIssue.message, validationIssue.code);
    }
  }
  for (let index = 0; index < input.shot.audioBindings.length; index += 1) {
    const fingerprint = await validateRemotionAudioBindingFingerprint(
      input.shot.audioBindings[index],
      `$.shot.audioBindings[${index}]`,
    );
    if (!fingerprint.success) {
      for (const fingerprintIssue of fingerprint.issues) {
        issue(issues, fingerprintIssue.path, fingerprintIssue.message, fingerprintIssue.code);
      }
    }
  }
  if (input.shot.visualSource.contentSha256 !== input.shot.sourceFingerprint) {
    issue(issues, "$.shot.sourceFingerprint", "visualSource contentSha256 必须与 shot sourceFingerprint 一致");
  }
  if (
    input.storyboard.mediaRef?.contentSha256
    && input.storyboard.mediaRef.contentSha256 !== input.shot.visualSource.contentSha256
  ) {
    issue(issues, "$.storyboard.mediaRef.contentSha256", "分镜素材 fingerprint 与 shot visualSource 不一致");
  }
  if (!input.storyboard.mediaRef?.contentSha256) {
    issue(issues, "$.storyboard.mediaRef.contentSha256", "当前分镜素材缺少内容 fingerprint");
  }
  validateStoryboardAudioReference(input.storyboard, input.shot, input.projectId, issues);
  validateStoryboardTtsBinding(input.storyboard, input.shot, input.projectId, input.chapterId, issues);
  if (issues.length > 0 || visualKind === undefined || visualKind === "audio") {
    return { success: false, issues };
  }

  const planWithoutHash = {
    schemaVersion: 1 as const,
    target: "shot" as const,
    projectId: input.projectId,
    chapterId: input.chapterId,
    chapterRevision: input.chapterRevision,
    sourceSnapshotHash: input.sourceSnapshotHash,
    renderSettings: input.renderSettings,
    visualKind,
    shot: input.shot,
  };
  const hashInput = {
    schemaVersion: 1 as const,
    target: "shot" as const,
    projectId: input.projectId,
    chapterId: input.chapterId,
    renderSettings: input.renderSettings,
    visualKind,
    shot: input.shot,
  };
  return {
    success: true,
    value: {
      ...planWithoutHash,
      inputHash: await sha256CanonicalJson(hashInput),
    },
  };
}

/** Project a validated shot plan into capability-only Remotion props. */
export function projectStoryboardShotCompositionProps(
  plan: RemotionShotPlanV1,
  resolveCapabilityUrl: ShotCapabilityResolver,
): ShotPlanResult<StoryboardShotCompositionProps> {
  const issues: ShotPlanIssue[] = [];
  const fps = plan.renderSettings.fps;
  const durationInFrames = clipDurationInFrames(plan.shot.durationUs, fps);
  const visualUrl = resolveUrl(plan.shot.visualSource, resolveCapabilityUrl, "$.shot.visualSource", issues);
  const audioClips: Array<CompositionAudioClipProps & { renderScope: "shot" }> = plan.shot.audioBindings
    .map((binding, index) => ({
      clipId: binding.bindingId,
      kind: binding.role,
      src: resolveUrl(binding.source, resolveCapabilityUrl, `$.shot.audioBindings[${index}].source`, issues),
      from: usToFrames(binding.shotStartUs, fps),
      durationInFrames: clipDurationInFrames(binding.durationUs, fps),
      volume: binding.volume,
      renderScope: "shot" as const,
      trimStartFrames: usToFrames(binding.sourceStartUs, fps),
      fade: {
        fadeInFrames: usToFrames(binding.fadeInUs, fps),
        fadeOutFrames: usToFrames(binding.fadeOutUs, fps),
      },
      envelope: binding.envelope.map((point) => ({
        frame: usToFrames(point.timeUs, fps),
        gain: point.gain,
      })),
    }));
  const props: StoryboardShotCompositionProps = {
    target: "shot",
    projectId: plan.projectId,
    chapterId: plan.chapterId,
    shotId: plan.shot.shotId,
    shotRevision: plan.shot.revision,
    width: plan.renderSettings.width,
    height: plan.renderSettings.height,
    fps,
    durationInFrames,
    visualClips: [{
      clipId: plan.shot.shotId,
      kind: plan.visualKind,
      src: visualUrl,
      from: 0,
      durationInFrames,
      transform: plan.shot.transform as CompositionTransform,
      panZoom: motionToPanZoom(plan.shot.motion),
      muted: true,
    }],
    transitions: [],
    audioClips,
    subtitles: plan.shot.subtitleText?.trim()
      ? [{ cueId: `${plan.shot.shotId}:subtitle`, text: plan.shot.subtitleText.trim(), from: 0, durationInFrames }]
      : [],
  };
  const validation = validateStoryboardShotCompositionProps(props);
  if (!validation.success) {
    for (const validationIssue of validation.issues) issue(issues, validationIssue.path, validationIssue.message, "composition.invalid");
  }
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: props };
}

/** Validate a persisted plan and recompute its canonical hash before use. */
export async function validateRemotionShotPlan(
  value: unknown,
): Promise<ShotPlanResult<RemotionShotPlanV1>> {
  const issues: ShotPlanIssue[] = [];
  if (!isRecord(value)) return { success: false, issues: [{ code: "shot-plan.invalid", path: "$", message: "shot plan 必须是对象" }] };
  if (value.schemaVersion !== 1) issue(issues, "$.schemaVersion", "shot plan schemaVersion 必须为 1");
  if (value.target !== "shot") issue(issues, "$.target", "shot plan target 必须为 shot");
  if (!isId(value.projectId)) issue(issues, "$.projectId", "项目 ID 无效");
  if (!isId(value.chapterId)) issue(issues, "$.chapterId", "章节 ID 无效");
  if (!isPositiveInteger(value.chapterRevision)) issue(issues, "$.chapterRevision", "章节 revision 必须为正整数");
  if (!isSha256(value.sourceSnapshotHash)) issue(issues, "$.sourceSnapshotHash", "sourceSnapshotHash 必须是 SHA-256");
  if (value.visualKind !== "image" && value.visualKind !== "video") issue(issues, "$.visualKind", "visualKind 无效");
  if (Object.prototype.hasOwnProperty.call(value, "sharedAudioTracks")) {
    issue(issues, "$.sharedAudioTracks", "StoryboardShot plan 禁止携带 chapter shared audio");
  }
  if (!isSha256(value.inputHash)) issue(issues, "$.inputHash", "inputHash 必须是 SHA-256");
  if (issues.length > 0) return { success: false, issues };
  const plan = value as unknown as RemotionShotPlanV1;
  const chapterValidation = validateRemotionChapterManifestV2({
    schemaVersion: 2,
    manifestFingerprint: "0".repeat(64),
    projectId: plan.projectId,
    chapterId: plan.chapterId,
    revision: plan.chapterRevision,
    sourceSnapshotHash: plan.sourceSnapshotHash,
    requiredShotIds: [plan.shot.shotId],
    sharedAudioBindings: [],
    shots: [plan.shot],
    renderSettings: plan.renderSettings,
    createdAt: 1,
    updatedAt: 1,
  });
  if (!chapterValidation.success) {
    for (const validationIssue of chapterValidation.issues) issue(issues, validationIssue.path, validationIssue.message, validationIssue.code);
  }
  for (let index = 0; index < plan.shot.audioBindings.length; index += 1) {
    const fingerprint = await validateRemotionAudioBindingFingerprint(
      plan.shot.audioBindings[index],
      `$.shot.audioBindings[${index}]`,
    );
    if (!fingerprint.success) {
      for (const fingerprintIssue of fingerprint.issues) {
        issue(issues, fingerprintIssue.path, fingerprintIssue.message, fingerprintIssue.code);
      }
    }
  }
  const expectedHash = await sha256CanonicalJson({
    schemaVersion: 1 as const,
    target: "shot" as const,
    projectId: plan.projectId,
    chapterId: plan.chapterId,
    renderSettings: plan.renderSettings,
    visualKind: plan.visualKind,
    shot: plan.shot,
  });
  if (expectedHash !== plan.inputHash) {
    issue(issues, "$.inputHash", "inputHash 与当前 shot plan 内容不一致");
  }
  return issues.length > 0 ? { success: false, issues } : { success: true, value: plan };
}

function resolveUrl(
  reference: ProjectMediaReference,
  resolver: ShotCapabilityResolver,
  path: string,
  issues: ShotPlanIssue[],
): string {
  try {
    const url = resolver(reference);
    if (typeof url !== "string" || url.trim().length === 0) throw new Error("resolver 返回空 URL");
    return url;
  } catch (error) {
    issue(issues, path, error instanceof Error ? error.message : String(error), "media.resolve");
    return "http://127.0.0.1:1/" + "0".repeat(64) + "/invalid";
  }
}

function motionToPanZoom(motion: RemotionShotDefinitionV2["motion"]): CompositionPanZoom | undefined {
  if (motion.kind !== "pan-zoom") return undefined;
  return {
    fromScale: motion.fromScale ?? 1,
    toScale: motion.toScale ?? motion.fromScale ?? 1.06,
    originX: motion.originX ?? 0.5,
    originY: motion.originY ?? 0.5,
  };
}

function issue(issues: ShotPlanIssue[], path: string, message: string, code = "shot-plan.invalid"): void {
  issues.push({ code, path, message });
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value !== "." && value !== ".." && !/[\\/\0]/.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function requiresDialogueAudio(storyboard: StoryboardItem): boolean {
  return [storyboard.ttsSpokenText, storyboard.line, storyboard.lines]
    .some((value) => {
      const text = value?.trim();
      return Boolean(text && !/^(无|无台词|无对白)$/i.test(text));
    });
}

function shotValidationManifest(
  input: Pick<
    CompileRemotionShotPlanInput,
    "projectId" | "chapterId" | "chapterRevision" | "sourceSnapshotHash" | "renderSettings" | "shot"
  >,
): RemotionChapterManifestV2 {
  return {
    schemaVersion: 2,
    manifestFingerprint: "0".repeat(64),
    projectId: input.projectId,
    chapterId: input.chapterId,
    revision: input.chapterRevision,
    sourceSnapshotHash: input.sourceSnapshotHash,
    requiredShotIds: [input.shot.shotId],
    sharedAudioBindings: [],
    shots: [input.shot],
    renderSettings: input.renderSettings,
    createdAt: 1,
    updatedAt: 1,
  };
}

function validateStoryboardAudioReference(
  storyboard: StoryboardItem,
  shot: RemotionShotDefinitionV2,
  projectId: string,
  issues: ShotPlanIssue[],
): void {
  const audioRef = storyboard.audioRef;
  const voices = shot.audioBindings.filter((binding) => binding.role === "voice");
  if (!audioRef) {
    if (voices.length > 0) {
      issue(issues, "$.storyboard.audioRef", "canonical voice binding 必须有一致的 audioRef 兼容镜像");
    }
    return;
  }
  if (audioRef.kind !== "audio" || !audioRef.path.trim()) {
    issue(issues, "$.storyboard.audioRef", "audioRef 必须是非空音频引用");
    return;
  }
  if (!audioRef.contentSha256) {
    issue(issues, "$.storyboard.audioRef.contentSha256", "当前口播素材缺少内容 fingerprint");
    return;
  }
  const voice = voices[0];
  if (!voice || voice.source.contentSha256 !== audioRef.contentSha256) {
    issue(issues, "$.storyboard.audioRef.contentSha256", "当前口播素材 fingerprint 与 shot voice binding 不一致");
    return;
  }
  const expectedPath = `project-file://${encodeURIComponent(projectId)}/${voice.source.relativePath
    .split("/").map((part) => encodeURIComponent(part)).join("/")}`;
  if (audioRef.path !== expectedPath) {
    issue(issues, "$.storyboard.audioRef.path", "audioRef 必须精确镜像 canonical voice binding source");
  }
}

function validateStoryboardTtsBinding(
  storyboard: StoryboardItem,
  shot: RemotionShotDefinitionV2,
  projectId: string,
  chapterId: string,
  issues: ShotPlanIssue[],
): void {
  const voices = shot.audioBindings.filter((binding) => binding.role === "voice");
  if (voices.length > 1) {
    issue(issues, "$.shot.audioBindings", "每个 StoryboardShot 最多只能有一个 canonical voice binding");
    return;
  }
  const voice = voices[0];
  if (!voice) return;
  const job = storyboard.ttsJob;
  if (!job || job.status !== "completed"
    || job.projectId !== projectId
    || job.chapterId !== chapterId
    || job.shotId !== shot.shotId
    || job.shotRevision !== shot.revision
    || job.inputFingerprint !== voice.ttsInputFingerprint) {
    issue(
      issues,
      "$.storyboard.ttsJob",
      "completed TTS job 必须与当前 project/chapter/shot revision 和 voice fingerprint 一致",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
