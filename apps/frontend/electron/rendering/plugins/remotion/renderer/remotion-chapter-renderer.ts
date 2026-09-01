import crypto from "node:crypto";
import fs from "node:fs";
import { readRenderHwSettings } from "../render-hw-mode";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathsEquivalent, resolveEditableChapterVisualInput, discoverChapterLayerAssets, createRemotionChapterRenderIdentity, createRemotionChapterSceneRenderIdentity, assertReadableFile, hashFile } from "./remotion-chapter-renderer-identity";
export { pathsEquivalent, resolveEditableChapterVisualInput, createRemotionChapterRenderIdentity, createRemotionChapterSceneRenderIdentity, createReadyRemotionChapterJob, createReadyRemotionChapterSceneJob } from "./remotion-chapter-renderer-identity";
import type { RemotionChapterManifestV2, RemotionEvidenceV1, RemotionRenderJobTarget, RemotionRenderJobV1 } from "@/types/remotion-workspace";
import { buildRemotionCurrentSlot, remotionCurrentSlotPaths, validateCurrentSlot } from "@/lib/studio/remotion/remotion-current-slot";
import { validateRemotionEvidenceIdentity, validateRemotionRenderJobIdentity } from "@/lib/studio/remotion/remotion-render-validation";
import { validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import { customFontFamilyForId, isCustomSubtitleFontId } from "@/lib/studio/remotion/subtitle-fonts";
import { ChapterVideoCompositionResult, buildChapterVideoCompositionProps, mapEditedVoiceIntervals, validateSubtitleAuthorityForTimeline } from "../composition/build-composition-props";
import { CHAPTER_VIDEO_COMPOSITION_ID } from "../composition/composition-id";
import { MediaBridgeServer } from "../media-bridge/media-bridge-server";
import { MediaBridgeClipSource, buildMediaUrlMap } from "../media-bridge/media-bridge-source-map";
import { RemotionRenderUtilitySupervisor } from "./remotion-render-utility";
import { publishCurrentSlot } from "./remotion-shot-renderer";
import { quarantineRemotionPartialOutput } from "./remotion-render-output";
import { assertBundleMatchesRuntime } from "../render/bundle-manifest";
import { verifyRemotionAudioBindingSource, verifyRemotionProjectFileSource } from "../manifest/remotion-audio-source-verification";
import type { HyperFramesOverlayWindowV1, RemotionChapterGateResult } from "@rendering/contracts/video-workflow";
import { RemotionChapterProbe, RemotionChapterRenderRequest, RemotionChapterRenderResult, RemotionChapterRendererOptions, RemotionChapterSceneRenderRequest, RemotionChapterSceneRenderResult, RemotionChapterSceneSegmentSpec } from "./remotion-chapter-renderer-types";


const execFileAsync = promisify(execFile);
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
    const result = await this.renderWithOptionalScene(input);
    if (result.success && !("slot" in result)) throw new Error("chapter render 返回了场景分段结果");
    return result;
  }

  async renderScene(input: RemotionChapterSceneRenderRequest): Promise<RemotionChapterSceneRenderResult> {
    const result = await this.renderWithOptionalScene(input);
    if (result.success && "slot" in result) throw new Error("chapter scene render 返回了整章结果");
    return result;
  }

  private async renderWithOptionalScene(
    input: RemotionChapterRenderRequest & { sceneSegment?: RemotionChapterSceneSegmentSpec },
  ): Promise<RemotionChapterRenderResult | RemotionChapterSceneRenderResult> {
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
    const identity = input.sceneSegment
      ? await createRemotionChapterSceneRenderIdentity({
          plan,
          currentShotSlots: input.currentShotSlots,
          chapterManifest,
          bundleContentHash: bundle.contentHash,
          layerWorkspaceRoot,
          sceneSegment: input.sceneSegment,
        })
      : await createRemotionChapterRenderIdentity({
          plan,
          currentShotSlots: input.currentShotSlots,
          chapterManifest,
          bundleContentHash: bundle.contentHash,
          layerWorkspaceRoot,
        });
    const { jobId } = identity;
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
    if (input.sceneSegment && videoWorkflowGateResult?.accepted && videoWorkflowGateResult.mode === "flat-shot-mp4") {
      return {
        success: false,
        jobId: input.expectedJobId ?? jobId,
        canceled: false,
        error: "flat-shot-mp4 章节只有一个视觉片段，无场可分",
      };
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
        // 按场分段：同一 bundle/props，仅裁渲染帧窗口（闭区间）。
        ...(input.sceneSegment ? { frameRange: input.sceneSegment.frameRange } : {}),
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
      if (input.sceneSegment) {
        // 场景分段产物：落 workspace 相对路径 + evidence 旁车文件，不发布
        // current slot、不写 renderPlan/snapshot（那是整章 current-slot 语义）。
        const finalRelative = input.sceneSegment.outputRelativePath;
        const finalAbsolute = path.join(this.options.projectRootForProject(plan.projectId), finalRelative);
        const sceneJob: RemotionRenderJobV1 = {
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
          outputPath: finalRelative,
          evidencePath: `${finalRelative}.evidence.json`,
        };
        const sceneEvidence: RemotionEvidenceV1 = {
          schemaVersion: 1,
          ...identity,
          jobId,
          templateVersion: bundle.templateVersion,
          remotionVersion: bundle.remotionVersion,
          attempt: 1,
          compositionId: CHAPTER_VIDEO_COMPOSITION_ID,
          renderer: { requested: "remotion", actual: "remotion" },
          outputPath: finalRelative,
          sizeBytes: stat.size,
          mtimeMs: Math.floor(stat.mtimeMs),
          sha256,
          width: probe.width,
          height: probe.height,
          durationUs: Math.round(probe.duration * 1_000_000),
          streams: probe.streams,
          inputManifestPath: `chapters/${plan.episodeId}.json`,
          startedAt,
          completedAt,
        };
        const sceneJobResult = await validateRemotionRenderJobIdentity(sceneJob);
        if (!sceneJobResult.success) throw new Error(sceneJobResult.issues.map((issue) => issue.message).join("；"));
        const sceneEvidenceResult = await validateRemotionEvidenceIdentity(sceneEvidence);
        if (!sceneEvidenceResult.success) throw new Error(sceneEvidenceResult.issues.map((issue) => issue.message).join("；"));
        await fs.promises.mkdir(path.dirname(finalAbsolute), { recursive: true });
        await fs.promises.rename(stagedOutputPath, finalAbsolute);
        await fs.promises.writeFile(`${finalAbsolute}.evidence.json`, `${JSON.stringify(sceneEvidence, null, 2)}\n`, "utf8");
        return { success: true, job: sceneJob, evidence: sceneEvidence };
      }
      const target = identity.target as Extract<RemotionRenderJobTarget, { kind: "chapter" }>;
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


function chapterAudioMediaId(bindingId: string): string {
  return `chapter-audio:${bindingId}`;
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



export type { ChapterVisualInputResolution, RemotionChapterProbe, RemotionChapterRenderIdentity, RemotionChapterRenderRequest, RemotionChapterRenderResult, RemotionChapterRendererOptions, RemotionChapterSceneRenderIdentity, RemotionChapterSceneRenderRequest, RemotionChapterSceneRenderResult, RemotionChapterSceneSegmentSpec } from "./remotion-chapter-renderer-types";
