import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionChapterManifestV2, RemotionCurrentSlotV1, RemotionRenderJobV1 } from "@/types/remotion-workspace";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import { mapEditedVoiceIntervals } from "../composition/build-composition-props";
import type { RemotionChapterGateAcceptedV1 } from "@rendering/contracts/video-workflow";

import type {
  RemotionChapterRenderIdentity, RemotionChapterSceneRenderIdentity,
  RemotionChapterSceneSegmentSpec,
  ChapterVisualInputResolution,
} from "./remotion-chapter-renderer-types";

/**
 * 章节渲染身份与输入解析(三期·函数级迁移):
 * 分层资产发现/identity 核心构造/create*Identity/createReady*Job。
 * 体逐字保留;契约类型从 types 模块导入。
 */



export function pathsEquivalent(left: string, right: string): boolean {
  const resolveReal = (value: string) => {
    const macAlias = value.replace(/^\/private\/var(?:\/|$)/, "/var/");
    try {
      return fs.realpathSync.native(macAlias);
    } catch {
      return path.resolve(macAlias);
    }
  };
  return resolveReal(left) === resolveReal(right);
}

/** Selects the byte-verified source for an editable EDL visual clip. */
export function resolveEditableChapterVisualInput(input: {
  requestedSourcePath?: string;
  currentSlotPath: string;
  currentSlotSha256: string;
  sourceFingerprint?: string;
  gate?: RemotionChapterGateAcceptedV1;
}): ChapterVisualInputResolution {
  const sourcePath = input.requestedSourcePath?.trim() || input.currentSlotPath;
  if (pathsEquivalent(sourcePath, input.currentSlotPath)) {
    return { sourcePath, expectedSha256: input.currentSlotSha256, label: "shot_slot" };
  }
  if (!input.gate || input.gate.mode !== "editable-edl") {
    throw new Error("EDL 派生输入未通过 video-use gate");
  }
  if (input.sourceFingerprint !== input.gate.videoUseArtifactSha256) {
    throw new Error("EDL 派生输入未绑定当前 video-use artifact");
  }
  const derived = input.gate.videoUseDerivedInputs?.find((entry) => pathsEquivalent(entry.derivedPath, sourcePath));
  if (!derived) throw new Error("缺少 EDL 派生输入 SHA-256 证据");
  return { sourcePath, expectedSha256: derived.derivedSha256, label: "derived_input" };
}

interface ChapterLayerAsset {
  clipId: string;
  backgroundPath: string;
  subjectPath: string;
  backgroundSha256: string;
  subjectSha256: string;
}

/**
 * 分层资产发现（08-19 multilayer-composition Child1）：
 * `<workspaceRoot>/layers/<chapterId>/<clipId>/{background,subject}.png` 两文件
 * 齐 → 收录（含 SHA-256，进身份哈希+渲染注册）。缺层=该镜单层，静默跳过。
 * app 内不做按需 separator 调用（build 侧 standalone 脚本职责）；Child3 原生
 * 分层生图产物落同目录同约定，渲染侧零特殊分支。
 */
export async function discoverChapterLayerAssets(
  plan: TimelineRenderPlan,
  workspaceRoot: string,
): Promise<ChapterLayerAsset[]> {
  const found: ChapterLayerAsset[] = [];
  for (const clip of plan.clips) {
    if (clip.trackKind !== "image") continue;
    const dir = path.join(workspaceRoot, "layers", plan.episodeId, clip.id);
    const backgroundPath = path.join(dir, "background.png");
    const subjectPath = path.join(dir, "subject.png");
    try {
      await assertReadableFile(backgroundPath, `${clip.id}-layer-bg`);
      await assertReadableFile(subjectPath, `${clip.id}-layer-subj`);
      found.push({
        clipId: clip.id,
        backgroundPath,
        subjectPath,
        backgroundSha256: await hashFile(backgroundPath),
        subjectSha256: await hashFile(subjectPath),
      });
    } catch {
      // 层产物缺失 → 单层渲染（不是错误）
    }
  }
  return found;
}

interface ChapterIdentityCoreInput {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  chapterManifest: RemotionChapterManifestV2;
  bundleContentHash: string;
  /**
   * 分层资产发现根（08-19 multilayer-composition Child1）：
   * `<layerWorkspaceRoot>/layers/<chapterId>/<clipId>/{background,subject}.png`
   * 两文件齐 → 层 SHA-256 进 inputHash。capability URL 是会话级随机、不区分
   * 内容，层 PNG 内容变更必须经此失效缓存。**无层章节不进哈希键**（字节级
   * 不变，零缓存误伤）。job 创建（main step4/craft）与渲染必须传同款根，
   * 否则 expectedJobId 失配。
   */
  layerWorkspaceRoot?: string;
}

export async function buildChapterIdentityCore(input: ChapterIdentityCoreInput): Promise<{
  renderSettingsHash: string;
  /** 进 inputHash 的核心对象（未哈希；调用方可追加维度后一次性哈希）。 */
  coreObject: Record<string, unknown>;
  target: { chapterId: string; editingProjectId: string; editingRevision: number };
}> {
  const voiceIntervals = mapEditedVoiceIntervals(input);
  if (!voiceIntervals.success) {
    throw new Error(voiceIntervals.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
  }
  const layerAssets = input.layerWorkspaceRoot
    ? await discoverChapterLayerAssets(input.plan, input.layerWorkspaceRoot)
    : [];
  const renderSettingsHash = await sha256CanonicalJson(input.plan.renderSettings);
  const coreObject = jsonValueWithoutUndefined({
    schemaVersion: 1,
    target: "chapter",
    projectId: input.plan.projectId,
    chapterId: input.plan.episodeId,
    plan: {
      schemaVersion: input.plan.schemaVersion,
      projectId: input.plan.projectId,
      episodeId: input.plan.episodeId,
      editingProjectId: input.plan.editingProjectId,
      editingRevision: input.plan.editingRevision,
      sourceSnapshotHash: input.plan.sourceSnapshotHash,
      renderSettings: input.plan.renderSettings,
      clips: input.plan.clips,
      transitions: input.plan.transitions,
      effects: input.plan.effects,
    },
    chapterManifest: input.chapterManifest,
    mappedVoiceIntervals: voiceIntervals.value,
    ...(layerAssets.length > 0
      ? { layerAssets: layerAssets.map((asset) => ({ clipId: asset.clipId, backgroundSha256: asset.backgroundSha256, subjectSha256: asset.subjectSha256 })) }
      : {}),
    shotSlots: [...input.currentShotSlots].sort(compareShotSlots).map((slot) => ({
      target: slot.target,
      job: {
        jobId: slot.job.jobId,
        inputHash: slot.job.inputHash,
        bundleContentHash: slot.job.bundleContentHash,
        renderSettingsHash: slot.job.renderSettingsHash,
      },
      evidence: {
        jobId: slot.evidence.jobId,
        inputHash: slot.evidence.inputHash,
        bundleContentHash: slot.evidence.bundleContentHash,
        renderSettingsHash: slot.evidence.renderSettingsHash,
        outputPath: slot.evidence.outputPath,
        outputSha256: slot.evidence.sha256,
      },
    })),
  }) as Record<string, unknown>;
  return {
    renderSettingsHash,
    coreObject,
    target: {
      chapterId: input.plan.episodeId,
      editingProjectId: input.plan.editingProjectId,
      editingRevision: input.plan.editingRevision,
    },
  };
}

export async function createRemotionChapterRenderIdentity(
  input: ChapterIdentityCoreInput,
): Promise<RemotionChapterRenderIdentity> {
  const { renderSettingsHash, coreObject, target } = await buildChapterIdentityCore(input);
  const inputHash = await sha256CanonicalJson(coreObject);
  const identity = {
    projectId: input.plan.projectId,
    target: { kind: "chapter" as const, ...target },
    inputHash,
    bundleContentHash: input.bundleContentHash,
    renderSettingsHash,
  };
  return { ...identity, jobId: await createRemotionRenderJobId(identity) };
}

export async function createRemotionChapterSceneRenderIdentity(input: {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  chapterManifest: RemotionChapterManifestV2;
  bundleContentHash: string;
  layerWorkspaceRoot?: string;
  sceneSegment: RemotionChapterSceneSegmentSpec;
}): Promise<RemotionChapterSceneRenderIdentity> {
  const { renderSettingsHash, coreObject, target } = await buildChapterIdentityCore(input);
  // 分段维度进哈希：帧窗口 + 场景边界集 + 产物相对路径（改名重导出可去重）。
  coreObject.sceneSegment = jsonValueWithoutUndefined({
    sceneNo: input.sceneSegment.sceneNo,
    frameRange: [input.sceneSegment.frameRange[0], input.sceneSegment.frameRange[1]],
    storyboardIds: [...input.sceneSegment.storyboardIds],
    outputRelativePath: input.sceneSegment.outputRelativePath,
  });
  const inputHash = await sha256CanonicalJson(coreObject);
  const identity = {
    projectId: input.plan.projectId,
    target: { kind: "chapter-scene" as const, ...target, sceneNo: input.sceneSegment.sceneNo },
    inputHash,
    bundleContentHash: input.bundleContentHash,
    renderSettingsHash,
  };
  return { ...identity, jobId: await createRemotionRenderJobId(identity) };
}

export async function createReadyRemotionChapterJob(input: {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  chapterManifest: RemotionChapterManifestV2;
  bundleContentHash: string;
  templateVersion: string;
  remotionVersion: string;
  now?: number;
  /** 与渲染入口同款分层发现根（见 createRemotionChapterRenderIdentity），缺省=无层身份。 */
  layerWorkspaceRoot?: string;
}): Promise<RemotionRenderJobV1> {
  const identity = await createRemotionChapterRenderIdentity(input);
  return {
    schemaVersion: 1,
    ...identity,
    templateVersion: input.templateVersion,
    remotionVersion: input.remotionVersion,
    status: "ready",
    attempt: 0,
    progress: 0,
    createdAt: input.now ?? Date.now(),
  };
}

export async function createReadyRemotionChapterSceneJob(input: {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  chapterManifest: RemotionChapterManifestV2;
  bundleContentHash: string;
  templateVersion: string;
  remotionVersion: string;
  now?: number;
  layerWorkspaceRoot?: string;
  sceneSegment: RemotionChapterSceneSegmentSpec;
}): Promise<RemotionRenderJobV1> {
  const identity = await createRemotionChapterSceneRenderIdentity(input);
  return {
    schemaVersion: 1,
    ...identity,
    templateVersion: input.templateVersion,
    remotionVersion: input.remotionVersion,
    status: "ready",
    attempt: 0,
    progress: 0,
    createdAt: input.now ?? Date.now(),
  };
}

export type { ChapterLayerAsset, ChapterIdentityCoreInput };

export async function assertReadableFile(filePath: string, clipId: string): Promise<void> {
  if (!path.isAbsolute(filePath)) throw new Error(`chapter 素材不是绝对路径: ${clipId}`);
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`chapter 素材不可读或为空: ${clipId}`);
  await fs.promises.access(filePath, fs.constants.R_OK);
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

export function jsonValueWithoutUndefined(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export function compareShotSlots(left: RemotionCurrentSlotV1, right: RemotionCurrentSlotV1): number {
  const leftShotId = left.target.kind === "shot" ? left.target.shotId : "";
  const rightShotId = right.target.kind === "shot" ? right.target.shotId : "";
  return leftShotId.localeCompare(rightShotId);
}
