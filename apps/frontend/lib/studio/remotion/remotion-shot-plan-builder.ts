import type {
  ContinuityAssetVersion,
  StoryboardItem,
  StoryboardMediaRef,
} from "@/types/studio";
import type {
  EditingRenderSettings,
  SubtitleAuthority,
} from "@/types/editing";
import type {
  ProjectMediaReference,
  RemotionShotDefinitionV2,
  RemotionShotHumanApprovalV1,
} from "@/types/remotion-workspace";
import { sha256CanonicalJson } from "./canonical-json";
import {
  compileRemotionShotPlan,
  type RemotionShotPlanV1,
  type ShotPlanIssue,
} from "./shot-plan";
import { resolveSubtitleAuthority } from "../video-workflow/subtitle-authority";
import { buildProjectFileUrl } from "@/lib/upscale/project-file-url";

export interface BuildRemotionShotPlansInput {
  projectId: string;
  chapterId: string;
  chapterRevision: number;
  renderSettings: EditingRenderSettings;
  storyboards: StoryboardItem[];
  requireHumanApproval?: boolean;
  continuityPolicy?: "required" | "if-present" | "skip";
  assetVersions?: ContinuityAssetVersion[];
}

export type RemotionShotPlansResult =
  | { success: true; sourceSnapshotHash: string; plans: RemotionShotPlanV1[] }
  | {
      success: false;
      sourceSnapshotHash: string;
      plans: RemotionShotPlanV1[];
      blockedShotIds: string[];
      issues: ShotPlanIssue[];
    };

export async function buildRemotionShotPlans(
  input: BuildRemotionShotPlansInput,
): Promise<RemotionShotPlansResult> {
  const chapterStoryboards = input.storyboards
    .filter((storyboard) => storyboard.episodeId === input.chapterId)
    .slice()
    .sort((left, right) => left.index - right.index);
  const storyboards = await recoverMissingMediaFingerprints(chapterStoryboards, input.projectId);
  const sourceSnapshotHash = await sha256CanonicalJson({
    schemaVersion: 1,
    projectId: input.projectId,
    chapterId: input.chapterId,
    shots: storyboards.map((storyboard) => ({
      id: storyboard.id,
      index: storyboard.index,
      revision: storyboard.outputVersion ?? 1,
      state: storyboard.state,
      stale: storyboard.stale ?? false,
      ...(storyboard.mediaRef ? { media: storyboard.mediaRef } : {}),
      // C2:关键帧全量入章节内容哈希——换帧 2~4 必须产生新 revision
      ...(storyboard.keyframes?.length ? { keyframes: storyboard.keyframes } : {}),
      ...(storyboard.shotAudioBindings ? { shotAudioBindings: storyboard.shotAudioBindings } : {}),
      ...(storyboard.visualReview ? { visualReview: storyboard.visualReview } : {}),
      ...(storyboard.continuityState ? { continuity: storyboard.continuityState } : {}),
    })),
  });
  if (storyboards.length === 0) {
    return {
      success: false,
      sourceSnapshotHash,
      plans: [],
      blockedShotIds: [],
      issues: [{ code: "shot-plan.empty", path: "$.storyboards", message: "当前章节没有可编译的分镜" }],
    };
  }

  const plans: RemotionShotPlanV1[] = [];
  const issues: ShotPlanIssue[] = [];
  const subtitleAuthority = resolveSubtitleAuthority(storyboards.map((storyboard) => ({
    intervalId: storyboard.id,
    authority: (storyboard as StoryboardItem & { subtitleAuthority?: SubtitleAuthority }).subtitleAuthority,
    cues: [storyboard.ttsSpokenText, storyboard.line, storyboard.lines].find((text) => Boolean(text?.trim()))
      ? [{ cueId: `${storyboard.id}:subtitle`, text: [storyboard.ttsSpokenText, storyboard.line, storyboard.lines].find((text) => Boolean(text?.trim()))!.trim(), startUs: 0, durationUs: 1 }]
      : [],
  })));
  if (subtitleAuthority.blocked) {
    for (const issue of subtitleAuthority.issues) {
      const match = /visualIntervals\[(\d+)\]/.exec(issue.path);
      const storyboard = match ? storyboards[Number(match[1])] : undefined;
      issues.push({ code: "shot-plan.subtitle-authority", path: storyboard ? `shots.${storyboard.id}.subtitleAuthority` : "$.subtitleAuthority", message: issue.message });
    }
  }
  for (const storyboard of storyboards) {
    const shot = buildShotDefinition(input.projectId, storyboard, issues, subtitleAuthority.intervals.find((interval) => interval.intervalId === storyboard.id)?.cues[0]?.owner);
    if (!shot) continue;
    const humanApproval = buildHumanApproval(
      input.projectId,
      input.chapterId,
      storyboard,
      shot,
    );
    const result = await compileRemotionShotPlan({
      projectId: input.projectId,
      chapterId: input.chapterId,
      chapterRevision: input.chapterRevision,
      sourceSnapshotHash,
      renderSettings: { ...input.renderSettings, subtitleMode: subtitleAuthority.subtitleMode },
      shot,
      storyboard,
      requireHumanApproval: input.requireHumanApproval,
      humanApproval,
      continuityPolicy: input.continuityPolicy,
      assetVersions: input.assetVersions,
    });
    if (!result.success) {
      issues.push(...result.issues.map((issue) => ({
        ...issue,
        path: `shots.${storyboard.id}.${issue.path}`,
      })));
      continue;
    }
    plans.push(result.value);
  }
  return issues.length > 0
    ? {
        success: false,
        sourceSnapshotHash,
        plans,
        blockedShotIds: blockedShotIdsFromIssues(issues, storyboards.map((storyboard) => storyboard.id)),
        issues,
      }
    : { success: true, sourceSnapshotHash, plans };
}

function blockedShotIdsFromIssues(issues: ShotPlanIssue[], shotIds: string[]): string[] {
  const knownShotIds = new Set(shotIds);
  const blocked = new Set<string>();
  for (const issue of issues) {
    const match = /^shots\.([^.]+)(?:\.|$)/.exec(issue.path);
    if (match?.[1] && knownShotIds.has(match[1])) blocked.add(match[1]);
  }
  return blocked.size > 0 ? shotIds.filter((shotId) => blocked.has(shotId)) : [...shotIds];
}

function buildShotDefinition(
  projectId: string,
  storyboard: StoryboardItem,
  issues: ShotPlanIssue[],
  subtitleOwner?: "remotion-text" | "hyperframes-overlay" | "source-media",
): RemotionShotDefinitionV2 | undefined {
  const visualSource = toProjectMediaReference(
    projectId,
    storyboard.mediaRef,
    storyboard.id,
    "storyboard",
    issues,
    "mediaRef",
  );
  if (!visualSource) return undefined;
  const audioBindings = structuredClone(storyboard.shotAudioBindings ?? []);
  const requestedDurationUs = Math.round(
    (storyboard.durationTarget ?? storyboard.duration) * 1_000_000,
  );
  const audioEndUs = audioBindings.reduce(
    (maximum, binding) => Math.max(maximum, binding.shotStartUs + binding.durationUs),
    0,
  );
  const voiceEndUs = audioBindings
    .filter((binding) => binding.role === "voice")
    .reduce(
      (maximum, binding) => Math.max(maximum, binding.shotStartUs + binding.durationUs),
      0,
    );
  const durationUs = Math.max(
    1,
    requestedDurationUs,
    audioEndUs,
    voiceEndUs > 0 ? voiceEndUs + 400_000 : 0,
  );
  if (!Number.isSafeInteger(durationUs) || durationUs <= 0) {
    issues.push({ code: "shot-plan.duration", path: `shots.${storyboard.id}.duration`, message: "分镜时长必须是正数" });
    return undefined;
  }
  const subtitleText = subtitleOwner === "remotion-text"
    ? [storyboard.ttsSpokenText, storyboard.line, storyboard.lines].find((text) => Boolean(text?.trim()))?.trim()
    : undefined;
  const approvedContinuityVersion = storyboard.continuityState?.styleContractVersion;
  return {
    shotId: storyboard.id,
    storyboardId: storyboard.id,
    index: storyboard.index,
    revision: Math.max(1, storyboard.outputVersion ?? 1),
    sourceFingerprint: visualSource.contentSha256,
    durationUs,
    visualSource,
    ...(subtitleText ? { subtitleText } : {}),
    audioBindings,
    motion: { kind: "static" },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    ...(approvedContinuityVersion ? { approvedContinuityVersion } : {}),
  };
}

function toProjectMediaReference(
  projectId: string,
  media: StoryboardMediaRef | undefined,
  sourceId: string,
  sourceKind: ProjectMediaReference["provenance"]["sourceKind"],
  issues: ShotPlanIssue[],
  field: string,
): ProjectMediaReference | undefined {
  if (!media || !media.path.trim()) {
    issues.push({ code: "media.missing", path: `shots.${sourceId}.${field}`, message: `${field} 必须引用项目内媒体` });
    return undefined;
  }
  const contentSha256 = media.contentSha256 ?? "";
  if (!isValidSha256Hex(contentSha256)) {
    issues.push({ code: "media.fingerprint", path: `shots.${sourceId}.${field}.contentSha256`, message: `${field} 缺少有效 SHA-256 fingerprint` });
    return undefined;
  }
  const relativePath = parseProjectRelativePath(projectId, media.path);
  if (!relativePath) {
    issues.push({ code: "media.path", path: `shots.${sourceId}.${field}.path`, message: `${field} 必须是当前项目的 project-file 相对路径` });
    return undefined;
  }
  return {
    kind: "project-file",
    projectId,
    relativePath,
    contentSha256,
    provenance: {
      sourceKind,
      sourceId,
      sourceVersion: contentSha256,
    },
  };
}

function parseProjectRelativePath(projectId: string, value: string): string | undefined {
  if (value.startsWith("project-file://")) {
    const rest = value.slice("project-file://".length);
    const separator = rest.indexOf("/");
    if (separator <= 0) return undefined;
    const owner = decodePart(rest.slice(0, separator));
    if (owner !== projectId) return undefined;
    const relativePath = rest.slice(separator + 1).split("/").map(decodePart).join("/");
    return isSafeRelativePath(relativePath) ? relativePath : undefined;
  }
  return isSafeRelativePath(value) ? value : undefined;
}

export function buildHumanApproval(
  projectId: string,
  chapterId: string,
  storyboard: StoryboardItem,
  shot: RemotionShotDefinitionV2,
): RemotionShotHumanApprovalV1 | undefined {
  const review = storyboard.visualReview;
  if (review?.status !== "approved" || review.reviewer !== "human" || !review.evidencePaths[0]) return undefined;
  // C2 门禁收口:多帧镜的批准证据必须逐帧齐备且与当前帧序列精确一致,
  // 否则视为未批准(阻断编译)——防"批了首帧、换了后帧"沿用旧批准。
  const expectedFramePaths = (storyboard.keyframes ?? [])
    .map((frame) => frame.mediaRef?.path)
    .filter((path): path is string => Boolean(path));
  if (expectedFramePaths.length > 1) {
    const evidence = review.evidencePaths.map((path) => path.trim()).filter(Boolean);
    const mismatch =
      evidence.length !== expectedFramePaths.length
      || evidence.some((path, index) => path !== expectedFramePaths[index]);
    if (mismatch) return undefined;
  }
  return {
    schemaVersion: 1,
    projectId,
    chapterId,
    shotId: shot.shotId,
    shotRevision: shot.revision,
    inputFingerprint: review.inputFingerprint,
    reviewer: "human",
    approvedAt: review.reviewedAt ?? 0,
    evidencePath: review.evidencePaths[0],
    ...(expectedFramePaths.length > 1 ? { evidencePaths: expectedFramePaths } : {}),
  };
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function isValidSha256Hex(value: string | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/**
 * 旁路写入（如超分替换分镜图）会把 mediaRef.contentSha256 留空。与 CLI
 * render-shot-slots 的 normalizeMediaRef 同语义：构建前按实际文件补算
 * 缺失的 SHA-256；文件读不到则保持原样，由 toProjectMediaReference
 * 报 media.fingerprint 兜底。
 */
async function recoverMissingMediaFingerprints(
  storyboards: StoryboardItem[],
  projectId: string,
): Promise<StoryboardItem[]> {
  const bridge = typeof window === "undefined" ? undefined : window.projectFiles;
  if (!bridge?.readAsBase64) return storyboards;
  return Promise.all(storyboards.map(async (storyboard) => {
    const media = storyboard.mediaRef;
    if (!media?.path.trim() || isValidSha256Hex(media.contentSha256)) return storyboard;
    const relativePath = parseProjectRelativePath(projectId, media.path);
    if (!relativePath) return storyboard;
    const contentSha256 = await computeProjectFileSha256(bridge, buildProjectFileUrl(projectId, relativePath));
    return contentSha256
      ? { ...storyboard, mediaRef: { ...media, contentSha256 } }
      : storyboard;
  }));
}

async function computeProjectFileSha256(
  bridge: NonNullable<Window["projectFiles"]>,
  url: string,
): Promise<string | undefined> {
  try {
    const reply = await bridge.readAsBase64(url);
    if (!reply?.success || !reply.base64) return undefined;
    const binary = atob(reply.base64.slice(reply.base64.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").some((part) => part === "" || part === "." || part === "..");
}
