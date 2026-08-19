import crypto from "node:crypto";
import fs from "node:fs";
import { readRenderHwSettings } from "../render-hw-mode";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TimelineRenderPlan } from "@/types/editing";
import type {
  RemotionChapterManifestV2,
  RemotionCurrentSlotV1,
  RemotionEvidenceV1,
  RemotionMediaProbeStreamV1,
  RemotionRenderJobV1,
  RemotionRenderJobIdentityV1,
  RemotionRenderJobTarget,
} from "@/types/remotion-workspace";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import {
  buildRemotionCurrentSlot,
  remotionCurrentSlotPaths,
  validateCurrentSlot,
} from "@/lib/studio/remotion/remotion-current-slot";
import {
  validateRemotionEvidenceIdentity,
  validateRemotionRenderJobIdentity,
} from "@/lib/studio/remotion/remotion-render-validation";
import { validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import { customFontFamilyForId, isCustomSubtitleFontId } from "@/lib/studio/remotion/subtitle-fonts";
import {
  buildChapterVideoCompositionProps,
  mapEditedVoiceIntervals,
  validateSubtitleAuthorityForTimeline,
  type ChapterVideoCompositionResult,
} from "../composition/build-composition-props";
import { CHAPTER_VIDEO_COMPOSITION_ID } from "../composition/composition-id";
import { MediaBridgeServer } from "../media-bridge/media-bridge-server";
import { buildMediaUrlMap, type MediaBridgeClipSource } from "../media-bridge/media-bridge-source-map";
import {
  RemotionRenderUtilitySupervisor,
  type RemotionRenderBrowserProbe,
  type RemotionRenderUtilityOptions,
} from "./remotion-render-utility";
import { publishCurrentSlot } from "./remotion-shot-renderer";
import { quarantineRemotionPartialOutput } from "./remotion-render-output";
import { assertBundleMatchesRuntime } from "../render/bundle-manifest";
import type { RemotionChapterManifestService } from "../manifest/remotion-chapter-manifest-service";
import {
  verifyRemotionAudioBindingSource,
  verifyRemotionProjectFileSource,
} from "../manifest/remotion-audio-source-verification";
import type {
  HyperFramesOverlayWindowV1,
  RemotionChapterGateAcceptedV1,
  RemotionChapterGateInputV1,
  RemotionChapterGateResult,
} from "@rendering/contracts/video-workflow";

const execFileAsync = promisify(execFile);

export interface RemotionChapterRendererOptions {
  /** 应用 userData 目录（render-hw.json 硬件加速开关读取；缺省回退 cwd 上级）。 */
  userDataDir?: string;
  workspaceRoot: string;
  workspaceRootForProject?: (projectId: string) => string;
  bundlePath: string;
  workerPath: string;
  cwd: string;
  binariesDirectory: string;
  remotionVersion: string;
  resolveSourcePath: (sourcePath: string) => string;
  projectRootForProject: (projectId: string) => string;
  chapterManifestService: Pick<RemotionChapterManifestService, "read">;
  probeBrowser: () => Promise<RemotionRenderBrowserProbe>;
  fork: RemotionRenderUtilityOptions["fork"];
  emitProgress: (progress: { jobId: string; stage: string; ratio: number; message?: string }) => void;
  probeMedia?: (filePath: string) => Promise<RemotionChapterProbe>;
  videoWorkflowGate?: (input: RemotionChapterGateInputV1) => Promise<RemotionChapterGateResult> | RemotionChapterGateResult;
  /** 自定义字幕字体文件解析（userData/SubtitleFonts）；custom:* 字体缺文件时 fail-closed。 */
  resolveCustomFontPath?: (fontId: string) => string | undefined;
  /** frontend/assets 目录（含 luts/ 与 sfx/ 子目录；dev=源码树，打包=resources）。
   * 缺省时不注册 grade LUT / sfx 资产（plan 含 grade 效果将 fail-closed）。 */
  assetsDir?: string;
  /** 分镜记录 shotFx.sfx 读取（字幕音效类别表；main 经 studio-workflow store 供给）。 */
  readSfxCategories?: (projectId: string, chapterId: string) => Record<string, string>;
}

export interface RemotionChapterRenderRequest {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  expectedJobId?: string;
}

export interface RemotionChapterProbe {
  duration: number;
  width: number;
  height: number;
  streams: RemotionMediaProbeStreamV1[];
  raw?: unknown;
}

export type RemotionChapterRenderResult =
  | { success: true; slot: RemotionCurrentSlotV1 }
  | { success: false; jobId: string; canceled: boolean; error: string };

export interface RemotionChapterRenderIdentity extends RemotionRenderJobIdentityV1 {
  jobId: string;
  target: Extract<RemotionRenderJobTarget, { kind: "chapter" }>;
}

export type ChapterVisualInputResolution = {
  sourcePath: string;
  expectedSha256: string;
  label: "shot_slot" | "derived_input";
};

/** Compare filesystem paths by canonical identity when available (macOS /var aliases /private/var). */
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
async function discoverChapterLayerAssets(
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

export async function createRemotionChapterRenderIdentity(input: {
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
}): Promise<RemotionChapterRenderIdentity> {
  const voiceIntervals = mapEditedVoiceIntervals(input);
  if (!voiceIntervals.success) {
    throw new Error(voiceIntervals.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
  }
  const layerAssets = input.layerWorkspaceRoot
    ? await discoverChapterLayerAssets(input.plan, input.layerWorkspaceRoot)
    : [];
  const renderSettingsHash = await sha256CanonicalJson(input.plan.renderSettings);
  const inputHash = await sha256CanonicalJson(jsonValueWithoutUndefined({
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
  }));
  const target = {
    kind: "chapter" as const,
    chapterId: input.plan.episodeId,
    editingProjectId: input.plan.editingProjectId,
    editingRevision: input.plan.editingRevision,
  };
  const identity = {
    projectId: input.plan.projectId,
    target,
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

/** Direct ChapterVideo renderer. It never invokes FFmpeg for generation. */
export class RemotionChapterRenderer {
  private readonly mediaBridge = new MediaBridgeServer();
  private readonly utility: RemotionRenderUtilitySupervisor;
  private disposed = false;

  constructor(private readonly options: RemotionChapterRendererOptions) {
    if (!path.isAbsolute(options.workspaceRoot)) throw new Error("chapter workspaceRoot 必须是绝对路径");
    this.utility = new RemotionRenderUtilitySupervisor({
      workerPath: options.workerPath,
      cwd: options.cwd,
      probeBrowser: options.probeBrowser,
      fork: options.fork,
      emitProgress: options.emitProgress,
    });
  }

  async render(input: RemotionChapterRenderRequest): Promise<RemotionChapterRenderResult> {
    const planValidation = validateTimelineRenderPlan(input.plan);
    if (!planValidation.success) {
      return { success: false, jobId: "chapter:pending", canceled: false, error: planValidation.issues.map((issue) => issue.message).join("；") };
    }
    if (this.disposed) return { success: false, jobId: "chapter:pending", canceled: false, error: "Remotion chapter renderer 已关闭" };
    const plan = planValidation.value;
    let chapterManifest: RemotionChapterManifestV2;
    try {
      const current = await this.options.chapterManifestService.read(plan.projectId, plan.episodeId);
      if (!current) throw new Error("chapter_manifest_missing");
      chapterManifest = current;
      const sourceValidation = mapEditedVoiceIntervals({
        plan,
        currentShotSlots: input.currentShotSlots,
        chapterManifest,
      });
      if (!sourceValidation.success) {
        throw new Error(sourceValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
      }
    } catch (error) {
      return {
        success: false,
        jobId: input.expectedJobId ?? "chapter:pending",
        canceled: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const bundle = readBundle(this.options.bundlePath, this.options.remotionVersion);
    // 分层发现根与 main step4 建 jobId 同款（projectRoot/remotion），保证
    // expectedJobId 不因层资产进哈希而失配。
    const layerWorkspaceRoot = this.options.workspaceRootForProject?.(plan.projectId) ?? this.options.workspaceRoot;
    const layerAssets = await discoverChapterLayerAssets(plan, layerWorkspaceRoot);
    const identity = await createRemotionChapterRenderIdentity({
      plan,
      currentShotSlots: input.currentShotSlots,
      chapterManifest,
      bundleContentHash: bundle.contentHash,
      layerWorkspaceRoot,
    });
    const { target, jobId } = identity;
    if (input.expectedJobId && input.expectedJobId !== jobId) {
      return {
        success: false,
        jobId: input.expectedJobId,
        canceled: false,
        error: "chapter manifest、voice intervals 或 shot evidence 已变化，render identity 失效",
      };
    }
    let videoWorkflowGateResult: RemotionChapterGateResult | undefined;
    if (this.options.videoWorkflowGate) {
      try {
        const gate = await this.options.videoWorkflowGate({
          projectId: identity.projectId,
          chapterId: identity.target.chapterId,
          revision: identity.target.editingRevision,
          inputSha256: identity.inputHash,
        });
        if (!gate.accepted) {
          return {
            success: false,
            jobId: input.expectedJobId ?? jobId,
            canceled: false,
            error: `视频工作流章节 gate blocked: ${gate.code} ${gate.message}`,
          };
        }
        videoWorkflowGateResult = gate;
      } catch (error) {
        return {
          success: false,
          jobId: input.expectedJobId ?? jobId,
          canceled: false,
          error: `视频工作流章节 gate 检查失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    const subtitleAuthorityValidation = validateSubtitleAuthorityForTimeline(
      plan,
      videoWorkflowGateResult?.accepted ? (videoWorkflowGateResult.hyperFramesWindows ?? []) : [],
    );
    if (!subtitleAuthorityValidation.success) {
      return {
        success: false,
        jobId: input.expectedJobId ?? jobId,
        canceled: false,
        error: subtitleAuthorityValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"),
      };
    }
    const workspaceRoot = layerWorkspaceRoot;
    const publicationId = crypto.randomUUID();
    const stagingDir = path.join(workspaceRoot, "staging", publicationId);
    const stagedOutputPath = path.join(stagingDir, "output.mp4");
    let session: ReturnType<MediaBridgeServer["createSession"]> | undefined;
    try {
      await fs.promises.mkdir(stagingDir, { recursive: true });
      await this.mediaBridge.listen();
      session = this.mediaBridge.createSession();
      const visualClips = plan.clips.filter((clip) => clip.trackKind === "video" || clip.trackKind === "image");
      const mediaSources: MediaBridgeClipSource[] = [];
      const currentShotSlotPaths: Record<string, string> = {};
      for (const slot of input.currentShotSlots) {
        if (slot.target.kind === "shot") {
          // slot.outputPath 相对 Remotion workspace；project-file:// 的解析根是
          // 项目根，URL 往返会丢 remotion 段，外部位置项目必然错位。直接用
          // workspaceRootForProject 拼绝对路径，与 editing clip 的绝对路径对齐。
          const workspaceRoot = this.options.workspaceRootForProject?.(plan.projectId) ?? this.options.workspaceRoot;
          currentShotSlotPaths[slot.target.shotId] = path.resolve(workspaceRoot, slot.outputPath);
        }
      }
      for (const clip of visualClips) {
        const storyboardId = clip.source.evidence.storyboardId;
        const slot = storyboardId
          ? input.currentShotSlots.find((candidate) => candidate.target.kind === "shot" && candidate.target.shotId === storyboardId)
          : undefined;
        const requestedSourcePath = clip.source.path?.trim();
        if (videoWorkflowGateResult?.accepted && videoWorkflowGateResult.mode === "flat-shot-mp4") {
          if (visualClips.length !== 1) throw new Error("flat-shot-mp4 EditingProject 必须只有一个视觉片段");
          if (!videoWorkflowGateResult.videoUseFlatShotMp4Path || !videoWorkflowGateResult.videoUseFlatShotMp4Sha256) {
            throw new Error("flat-shot-mp4 gate 缺少 clean MP4 路径或 SHA-256");
          }
          const sourcePath = this.options.resolveSourcePath(requestedSourcePath || videoWorkflowGateResult.videoUseFlatShotMp4Path);
          if (!pathsEquivalent(sourcePath, this.options.resolveSourcePath(videoWorkflowGateResult.videoUseFlatShotMp4Path))) {
            throw new Error("EditingProject flat source 与 video-use clean MP4 不一致");
          }
          const verified = await verifyRemotionProjectFileSource(
            sourcePath,
            workspaceRoot,
            videoWorkflowGateResult.videoUseFlatShotMp4Sha256,
            "flat_shot",
          );
          await assertReadableFile(verified.filePath, clip.id);
          mediaSources.push({ clipId: clip.id, absolutePath: verified.filePath });
          continue;
        }
        if (!slot || slot.target.kind !== "shot") throw new Error(`缺少当前 shot slot: ${storyboardId ?? clip.id}`);
        // 同上：slot 路径相对 Remotion workspace，直接拼绝对路径，避免
        // project-file:// 按项目根解析丢掉 remotion 段。
        const slotWorkspaceRoot = this.options.workspaceRootForProject?.(plan.projectId) ?? this.options.workspaceRoot;
        const currentSlotPath = path.resolve(slotWorkspaceRoot, slot.outputPath);
        const sourcePath = requestedSourcePath ? this.options.resolveSourcePath(requestedSourcePath) : currentSlotPath;
        const resolution = resolveEditableChapterVisualInput({
          requestedSourcePath: sourcePath,
          currentSlotPath,
          currentSlotSha256: slot.evidence.sha256,
          sourceFingerprint: clip.source.evidence.sourceFingerprint,
          gate: videoWorkflowGateResult?.accepted ? videoWorkflowGateResult : undefined,
        });
        const verified = await verifyRemotionProjectFileSource(
          resolution.sourcePath,
          workspaceRoot,
          resolution.expectedSha256,
          resolution.label,
        );
        await assertReadableFile(verified.filePath, clip.id);
        mediaSources.push({ clipId: clip.id, absolutePath: verified.filePath });
      }
      for (const binding of chapterManifest.sharedAudioBindings) {
        const mediaId = chapterAudioMediaId(binding.bindingId);
        const { filePath: sourcePath } = await verifyRemotionAudioBindingSource(
          binding,
          this.options.projectRootForProject(plan.projectId),
        );
        await assertReadableFile(sourcePath, binding.bindingId);
        mediaSources.push({ clipId: mediaId, absolutePath: sourcePath });
      }
      let hyperFramesOverlay: { src: string; windows: readonly HyperFramesOverlayWindowV1[] } | undefined;
      if (videoWorkflowGateResult?.accepted && videoWorkflowGateResult.hyperFramesOutputPath) {
        if (videoWorkflowGateResult.hyperFramesAlphaFormat === "png-sequence") {
          throw new Error("ChapterVideo 暂不支持 PNG sequence overlay；请改用 ProRes 4444 MOV 或 WebM alpha");
        }
        await assertReadableFile(videoWorkflowGateResult.hyperFramesOutputPath, "hyperframes-overlay");
        const actualSha256 = await hashFile(videoWorkflowGateResult.hyperFramesOutputPath);
        if (videoWorkflowGateResult.hyperFramesOutputSha256
          && actualSha256 !== videoWorkflowGateResult.hyperFramesOutputSha256) {
          throw new Error("HyperFrames overlay 输出 SHA-256 已漂移");
        }
        mediaSources.push({
          clipId: "hyperframes-overlay",
          absolutePath: videoWorkflowGateResult.hyperFramesOutputPath,
        });
        hyperFramesOverlay = {
          src: "",
          windows: videoWorkflowGateResult.hyperFramesWindows ?? [],
        };
      }
      // 自定义字幕字体：注册进 media bridge 会话，渲染端 delayRequest 挂载后烧录。
      let customFontFaces: Array<{ family: string; url: string }> | undefined;
      let customFontMediaId: string | undefined;
      const subtitleFontId = plan.renderSettings.subtitleFont;
      if (isCustomSubtitleFontId(subtitleFontId)) {
        const fontPath = this.options.resolveCustomFontPath?.(subtitleFontId);
        if (!fontPath) {
          throw new Error(`自定义字幕字体文件缺失（${subtitleFontId}）；请在设置中重新导入或换用内置字体`);
        }
        customFontMediaId = `custom-font-${subtitleFontId}`;
        mediaSources.push({ clipId: customFontMediaId, absolutePath: fontPath });
      }
      // 分层资产注册（08-19 multilayer Child1）：身份计算时发现的层产物进
      // bridge；layerUrlByClipId → 投影层转 layerStack → N 层渲染。
      for (const asset of layerAssets) {
        mediaSources.push({ clipId: `${asset.clipId}-layer-bg`, absolutePath: asset.backgroundPath });
        mediaSources.push({ clipId: `${asset.clipId}-layer-subj`, absolutePath: asset.subjectPath });
      }
      // 成片调色 LUT + 字幕音效资产（08-19 章节色调/字幕音效）：注册进会话，
      // lutUrlById 供 grade 效果 fail-closed 解析；sfxUrlById 供字幕驱动派生。
      let lutUrlById: Record<string, string> | undefined;
      let sfxUrlById: Record<string, string> | undefined;
      const assetsDir = this.options.assetsDir;
      if (assetsDir) {
        const lutsDir = path.join(assetsDir, "luts");
        if (fs.existsSync(lutsDir)) {
          const lutFiles = fs.readdirSync(lutsDir).filter((file) => file.endsWith(".png"));
          for (const file of lutFiles) mediaSources.push({ clipId: `lut-${file}`, absolutePath: path.join(lutsDir, file) });
        }
        const sfxDir = path.join(assetsDir, "sfx");
        if (fs.existsSync(sfxDir)) {
          const sfxFiles = fs.readdirSync(sfxDir).filter((file) => file.endsWith(".ogg"));
          for (const file of sfxFiles) mediaSources.push({ clipId: `sfx-${file}`, absolutePath: path.join(sfxDir, file) });
        }
      }
      const mediaUrlByClipId = buildMediaUrlMap(this.mediaBridge, session, mediaSources);
      if (assetsDir) {
        const lutsDir = path.join(assetsDir, "luts");
        if (fs.existsSync(lutsDir)) {
          lutUrlById = {};
          for (const file of fs.readdirSync(lutsDir).filter((entry) => entry.endsWith(".png"))) {
            // lut-<id>.png → <id>（与 standalone 渲染脚本同款键约定）
            lutUrlById[file.slice(0, -4)] = mediaUrlByClipId[`lut-${file}`];
          }
        }
        const sfxDir = path.join(assetsDir, "sfx");
        if (fs.existsSync(sfxDir)) {
          sfxUrlById = {};
          for (const file of fs.readdirSync(sfxDir).filter((entry) => entry.endsWith(".ogg"))) {
            // sfx-<name>.ogg → <name>
            sfxUrlById[file.slice(0, -4)] = mediaUrlByClipId[`sfx-${file}`];
          }
        }
      }
      if (customFontMediaId) {
        customFontFaces = [{ family: customFontFamilyForId(subtitleFontId!), url: mediaUrlByClipId[customFontMediaId]! }];
      }
      const mediaUrlByBindingId = Object.fromEntries(
        chapterManifest.sharedAudioBindings.map((binding) => [
          binding.bindingId,
          mediaUrlByClipId[chapterAudioMediaId(binding.bindingId)],
        ]),
      );
      const layerUrlByClipId: Record<string, { backgroundSrc: string; subjectSrc: string; parallax?: number }> = {};
      for (const asset of layerAssets) {
        const backgroundSrc = mediaUrlByClipId[`${asset.clipId}-layer-bg`];
        const subjectSrc = mediaUrlByClipId[`${asset.clipId}-layer-subj`];
        if (backgroundSrc && subjectSrc) {
          layerUrlByClipId[asset.clipId] = { backgroundSrc, subjectSrc, parallax: 0.5 };
        }
      }
      const projected: ChapterVideoCompositionResult = buildChapterVideoCompositionProps({
        plan,
        currentShotSlots: input.currentShotSlots,
        chapterManifest,
        currentShotSlotPaths,
        mediaUrlByClipId,
        mediaUrlByBindingId,
        ...(Object.keys(layerUrlByClipId).length > 0 ? { layerUrlByClipId } : {}),
        ...(lutUrlById ? { lutUrlById } : {}),
        ...(sfxUrlById ? { sfxUrlById } : {}),
        ...(sfxUrlById && plan.renderSettings.subtitleSfxEnabled === true
          ? { sfxCategoryByStoryboardId: this.options.readSfxCategories?.(plan.projectId, plan.episodeId) ?? {} }
          : {}),
        ...(customFontFaces?.length ? { customFontFaces } : {}),
        ...(videoWorkflowGateResult?.accepted ? { videoWorkflowGate: videoWorkflowGateResult } : {}),
        ...(hyperFramesOverlay
          ? { hyperFramesOverlay: { ...hyperFramesOverlay, src: mediaUrlByClipId["hyperframes-overlay"] ?? "" } }
          : {}),
      });
      if (!projected.success) throw new Error(projected.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
      // 2D 镜头语言/特效已前置到 plan.effects 正门（managed run 在编译后合并
      // mergeShotFxEditingEffects，build-composition-props 消费 panZoom/fx 效果），
      // 渲染器不再做渲染时直注；运镜变化经章节身份哈希（含 plan.effects）失效缓存。
      const render = await this.utility.render({
        target: "chapter",
        jobId,
        compositionProps: projected.value,
        compositionId: CHAPTER_VIDEO_COMPOSITION_ID,
        bundlePath: this.options.bundlePath,
        outputPath: stagedOutputPath,
        remotionVersion: this.options.remotionVersion,
        binariesDirectory: this.options.binariesDirectory,
        // D3 硬件加速渲染（render-hw-mode；严禁进 plan/renderSettings——M2 缓存陷阱）。
        hardwareRendering: readRenderHwSettings(this.options.userDataDir ?? path.join(this.options.cwd, "..")).hardwareAcceleration,
      });
      if (!render.success) {
        const quarantineError = await quarantineRemotionPartialOutput(stagedOutputPath);
        return {
          ...render,
          error: [render.error, quarantineError].filter(Boolean).join("; "),
        };
      }
      const probe = await (this.options.probeMedia ?? probeMedia)(stagedOutputPath);
      const stat = await fs.promises.stat(stagedOutputPath);
      const sha256 = await hashFile(stagedOutputPath);
      const startedAt = Date.now();
      const completedAt = Date.now();
      const currentPaths = remotionCurrentSlotPaths(target);
      const job: RemotionRenderJobV1 = {
        schemaVersion: 1,
        ...identity,
        templateVersion: bundle.templateVersion,
        remotionVersion: bundle.remotionVersion,
        status: "succeeded",
        attempt: 1,
        progress: 1,
        createdAt: startedAt,
        startedAt,
        completedAt,
        outputPath: currentPaths.outputPath,
        evidencePath: currentPaths.evidencePath,
      };
      const evidence: RemotionEvidenceV1 = {
        schemaVersion: 1,
        ...identity,
        jobId,
        templateVersion: bundle.templateVersion,
        remotionVersion: bundle.remotionVersion,
        attempt: 1,
        compositionId: CHAPTER_VIDEO_COMPOSITION_ID,
        renderer: { requested: "remotion", actual: "remotion" },
        outputPath: currentPaths.outputPath,
        sizeBytes: stat.size,
        mtimeMs: Math.floor(stat.mtimeMs),
        sha256,
        width: probe.width,
        height: probe.height,
        durationUs: Math.round(probe.duration * 1_000_000),
        streams: probe.streams,
        inputManifestPath: `chapters/${plan.episodeId}.json`,
        renderPlanPath: `jobs/chapter/${plan.episodeId}/current-render-plan.json`,
        snapshotPath: `jobs/chapter/${plan.episodeId}/current-editing-project.json`,
        startedAt,
        completedAt,
      };
      const jobResult = await validateRemotionRenderJobIdentity(job);
      if (!jobResult.success) throw new Error(jobResult.issues.map((issue) => issue.message).join("；"));
      const evidenceResult = await validateRemotionEvidenceIdentity(evidence);
      if (!evidenceResult.success) throw new Error(evidenceResult.issues.map((issue) => issue.message).join("；"));
      const slot = buildRemotionCurrentSlot(plan.projectId, target, job, evidence, completedAt);
      const slotResult = validateCurrentSlot(slot);
      if (!slotResult.success) throw new Error(slotResult.issues.map((issue) => issue.message).join("；"));
      await fs.promises.mkdir(path.join(workspaceRoot, "jobs", "chapter", plan.episodeId), { recursive: true });
      await fs.promises.writeFile(path.join(workspaceRoot, evidence.renderPlanPath!), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
      await fs.promises.writeFile(path.join(workspaceRoot, evidence.snapshotPath!), `${JSON.stringify(plan.editingProjectSnapshot, null, 2)}\n`, "utf8");
      await publishCurrentSlot(workspaceRoot, stagingDir, stagedOutputPath, slot);
      return { success: true, slot };
    } catch (error) {
      const quarantineError = await quarantineRemotionPartialOutput(stagedOutputPath);
      return {
        success: false,
        jobId,
        canceled: false,
        error: [error instanceof Error ? error.message : String(error), quarantineError].filter(Boolean).join("; "),
      };
    } finally {
      if (session) await this.mediaBridge.revokeSession(session).catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.utility.dispose();
    await this.mediaBridge.close();
  }

  cancel(jobId: string): { success: boolean; jobId: string; canceled: boolean; error?: string } {
    return this.utility.cancel(jobId);
  }
}

async function assertReadableFile(filePath: string, clipId: string): Promise<void> {
  if (!path.isAbsolute(filePath)) throw new Error(`chapter 素材不是绝对路径: ${clipId}`);
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`chapter 素材不可读或为空: ${clipId}`);
  await fs.promises.access(filePath, fs.constants.R_OK);
}

function chapterAudioMediaId(bindingId: string): string {
  return `chapter-audio:${bindingId}`;
}

function compareShotSlots(left: RemotionCurrentSlotV1, right: RemotionCurrentSlotV1): number {
  const leftShotId = left.target.kind === "shot" ? left.target.shotId : "";
  const rightShotId = right.target.kind === "shot" ? right.target.shotId : "";
  return leftShotId.localeCompare(rightShotId);
}

function jsonValueWithoutUndefined(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function readBundle(bundlePath: string, remotionVersion: string) {
  return assertBundleMatchesRuntime(
    JSON.parse(fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as unknown,
    remotionVersion,
  );
}

async function probeMedia(filePath: string): Promise<RemotionChapterProbe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,duration,width,height,channels,sample_rate",
    "-of", "json", filePath,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const raw = JSON.parse(stdout || "{}") as {
    format?: { duration?: string | number };
    streams?: Array<{ codec_type?: string; codec_name?: string; duration?: string | number; width?: number; height?: number; channels?: number; sample_rate?: string | number }>;
  };
  const video = raw.streams?.find((stream) => stream.codec_type === "video");
  const audio = raw.streams?.find((stream) => stream.codec_type === "audio");
  if (!video || video.codec_name !== "h264" || !audio || audio.codec_name !== "aac") throw new Error("ChapterVideo MP4 必须包含 h264 视频流和 aac 音频流");
  return {
    raw,
    duration: Number(video.duration ?? raw.format?.duration ?? 0),
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    streams: [
      { kind: "video", codec: "h264", width: Number(video.width ?? 0), height: Number(video.height ?? 0) },
      { kind: "audio", codec: "aac", channels: Number(audio.channels ?? 0), sampleRate: Number(audio.sample_rate ?? 0) },
    ],
  };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

