/**
 * main.ts chapter-projection 读簇(assembly 专批外迁,体逐字保留)——
 * Studio projection 编译 / editing 快照读取 / current slot 读取 / 按场分段入队,
 * 外加 video-use gate 薄包装。装配期单例(remotion 运行时/manifest 服务/渲染队列/
 * video-workflow 章服务)在 main.ts 装配完成后经 bindChapterProjectionRuntime 注入;
 * 全部消费点都是 IPC handler,只在 whenReady 之后触发,绑定必先于调用。
 */
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { resolveDataFilePath } from '../storage/storage-paths'
import { readStudioWorkflowStore } from '../storage/studio-workflow-store-io'
import { validateEditingProject } from '../../lib/studio/editing/validation'
import type { RemotionCurrentSlotV1 } from '../../types/remotion-workspace'
import { compileTimelineRenderPlan } from '../../lib/studio/editing/timeline-render-compiler'
import { mergeShotFxEditingEffects } from '../../lib/studio/remotion/shot-fx-decisions'
import { applyWorkflowConfigToRenderSettings, type WorkflowConfigProjectionInput } from '../../lib/studio/remotion/workflow-config-projection'
import { layoutChapterVisualClipTimings } from '@rendering/plugins/remotion/composition/build-composition-props'
import { planSceneSegmentFrameRanges, sanitizeSceneSegmentName } from '@/lib/studio/remotion/scene-segments'
import type {
  RemotionQueueEnqueueChapterScenesReply,
  RemotionQueueEnqueueChapterScenesReplySegment,
  RemotionQueueEnqueueChapterScenesRequest,
} from '@rendering/plugins/remotion/queue/remotion-queue-ipc'
import type { RemotionRenderQueue } from '@rendering/plugins/remotion/queue/remotion-render-queue'
import type { RemotionChapterManifestService } from '@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service'
import { createReadyRemotionChapterSceneJob } from '@rendering/plugins/remotion/renderer/remotion-chapter-renderer'
import type {
  RemotionChapterGateInputV1,
  RemotionChapterGateResult,
} from '@rendering/contracts/video-workflow'
import {
  readRemotionCurrentShotSlot,
  readRemotionCurrentShotSlotsFromWorkspace,
  resolveRemotionCurrentSlotOutputPath,
} from '../../lib/studio/remotion/remotion-current-slot'
import { resolveProjectFixedStudioEntryPoint } from '@rendering/plugins/remotion/studio'
import type { registerRemotionRuntimeIpcHandlers } from '../ipc/studio/remotion-runtime-ipc'
import type { createVideoWorkflowChapterService } from '@rendering/plugins/video-workflow/video-workflow-chapter-service'
import { getDataDir, pathsEquivalent, projectRootFor, resolveStudioSourcePath } from './main-paths'

type VideoWorkflowChapterService = ReturnType<typeof createVideoWorkflowChapterService>

export interface ChapterProjectionRuntime {
  remotionVersion: string | undefined
  remotionBundlePath: string
  remotionRuntime: ReturnType<typeof registerRemotionRuntimeIpcHandlers>
  remotionChapterManifestService: RemotionChapterManifestService
  remotionQueue: RemotionRenderQueue
  videoWorkflowChapterService: VideoWorkflowChapterService
}

let _runtime: ChapterProjectionRuntime | null = null

export function bindChapterProjectionRuntime(runtime: ChapterProjectionRuntime): void {
  _runtime = runtime
}

function requireRuntime(): ChapterProjectionRuntime {
  if (!_runtime) throw new Error('main-chapter-projection 运行时未装配:bindChapterProjectionRuntime 未被调用')
  return _runtime
}

export const evaluateVideoWorkflowChapterGate = async (input: RemotionChapterGateInputV1): Promise<RemotionChapterGateResult> => {
  const { videoWorkflowChapterService } = requireRuntime()
  // Remotion's inputSha256 identifies the final ChapterVideo job, while the
  // video-use artifact is keyed by the earlier StoryboardShot/TTS input. Read
  // the persisted artifact and pass that second fingerprint explicitly so a
  // valid post-review revision is not rejected merely because the two stages
  // hash different payloads.
  const artifacts = await videoWorkflowChapterService.readArtifacts(input)
  const videoUseInputSha256 = artifacts.success
    ? artifacts.value.videoUseArtifact?.evidence.inputSha256
    : undefined
  return videoWorkflowChapterService.evaluateGate({ ...input, videoUseInputSha256 })
}

export async function loadChapterStudioProjection(request: { projectId: string; chapterId: string; revision: number }) {
  const editingPath = resolveDataFilePath(getDataDir(), `_p/${request.projectId}/editing`)
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.promises.readFile(editingPath, 'utf8'))
  } catch {
    throw new Error('当前项目缺少可验证的 editing 持久化状态')
  }
  const state = isRecord(parsed) && isRecord(parsed.state) ? parsed.state : parsed
  if (!isRecord(state) || !isRecord(state.editingProjects) || !isRecord(state.currentEditingProjectIdByEpisode)) {
    throw new Error('editing 持久化状态结构无效')
  }
  const editingProjectId = state.currentEditingProjectIdByEpisode[request.chapterId]
  const rawProject = typeof editingProjectId === 'string' ? state.editingProjects[editingProjectId] : undefined
  const project = validateEditingProject(rawProject)
  if (!project.success || project.value.projectId !== request.projectId || project.value.episodeId !== request.chapterId || project.value.revision !== request.revision) {
    throw new Error('当前章节 editing revision 不存在或与 Studio identity 不一致')
  }
  const plan = compileTimelineRenderPlan(project.value, {
    jobId: `studio-${request.projectId}-${request.chapterId}-r${request.revision}`,
    createdAt: project.value.updatedAt,
  })
  if (!plan.success) throw new Error(`当前章节无法编译为 Studio projection: ${plan.issues[0]?.message ?? '未知错误'}`)
  // 2D 镜头语言/特效走 plan.effects 正门（video-use 编排 → Remotion 合成消费）：
  // 合并 shotFx 决策（AI 提示 > 关键词 > 镜序轮换），章节渲染身份哈希含
  // plan.effects → 运镜变化自动失效缓存。幂等：前缀识别旧 shotFx 条目并替换。
  // chapterGrade/subtitleSfxEnabled/atmosphereMode/subtitleFont（导演定调四字段）
  // 经 workflowConfig 注水——实现收敛在 applyWorkflowConfigToRenderSettings
  // （08-20 修复：subtitleFont 曾只有注释承诺无实现，设置页选择从不进 plan）。
  const shotFxStoryboards = (() => {
    try {
      const store = readStudioWorkflowStore(getDataDir(), request.projectId)
      const storyboards = (store?.state?.storyboards ?? []) as Array<{ id: string; episodeId: string; prompt?: string; line?: string; shotFx?: { motion?: unknown } }>
      plan.value.renderSettings = applyWorkflowConfigToRenderSettings(
        plan.value.renderSettings,
        store?.state?.workflowConfig as WorkflowConfigProjectionInput | undefined,
      )
      return storyboards.filter((storyboard) => storyboard.episodeId === request.chapterId)
    } catch { /* store 缺失 → 仅规则轮换运镜 */ }
    return []
  })()
  const shotFx = mergeShotFxEditingEffects(plan.value.effects, {
    planClips: plan.value.clips,
    storyboards: shotFxStoryboards,
    ...(plan.value.renderSettings.chapterGrade ? { chapterGrade: plan.value.renderSettings.chapterGrade } : {}),
    ...(plan.value.renderSettings.atmosphereMode ? { atmosphereMode: plan.value.renderSettings.atmosphereMode } : {}),
  })
  plan.value.effects = shotFx.effects
  const visualClips = plan.value.clips.filter((clip) => clip.trackKind === 'video' || clip.trackKind === 'image')
  if (visualClips.length === 0) throw new Error('当前章节缺少合法 current shot 输出')
  const remotionWorkspaceRoot = path.join(projectRootFor(request.projectId), 'remotion')
  // Applying an accepted video-use artifact may replace individual EDL clip
  // sources with byte-tracked derived MP4s. Resolve that gate before building
  // the Studio projection so preview and formal ChapterVideo share the same
  // source selection rules.
  const projectionGate = await evaluateVideoWorkflowChapterGate({
    projectId: request.projectId,
    chapterId: request.chapterId,
    revision: request.revision,
    inputSha256: '0'.repeat(64),
  })
  if (projectionGate.accepted && projectionGate.mode === 'flat-shot-mp4') {
    if (visualClips.length !== 1) throw new Error('flat-shot-mp4 Studio projection 必须只有一个视觉片段')
    const clip = visualClips[0]!
    if (clip.source.kind !== 'storyboardVideo') throw new Error(`flat-shot-mp4 Studio projection 视觉片段类型无效: ${clip.id}`)
    const sourcePath = clip.source.path?.trim()
    const gatePath = projectionGate.videoUseFlatShotMp4Path
    const gateSha256 = projectionGate.videoUseFlatShotMp4Sha256
    if (!sourcePath || !path.isAbsolute(sourcePath) || !gatePath || !gateSha256 || !pathsEquivalent(sourcePath, gatePath)) {
      throw new Error(`flat-shot-mp4 Studio source 与 video-use clean MP4 不一致: ${clip.id}`)
    }
    if (clip.source.evidence.sourceFingerprint !== projectionGate.videoUseArtifactSha256) {
      throw new Error(`flat-shot-mp4 Studio source 未绑定当前 video-use artifact: ${clip.id}`)
    }
    const stat = await fs.promises.stat(sourcePath).catch(() => undefined)
    if (!stat?.isFile() || stat.size <= 0) throw new Error(`flat-shot-mp4 clean MP4 不存在或为空: ${sourcePath}`)
    const sourceSha256 = crypto.createHash('sha256').update(await fs.promises.readFile(sourcePath)).digest('hex')
    if (sourceSha256 !== gateSha256) throw new Error(`flat-shot-mp4 clean MP4 SHA-256 已漂移: ${sourcePath}`)
    const currentShotSlots = await readRemotionCurrentShotSlotsFromWorkspace(remotionWorkspaceRoot, request.projectId, request.chapterId)
    const fps = plan.value.renderSettings.fps
    const durationInFrames = Math.max(1, Math.ceil((clip.durationUs * fps) / 1_000_000))
    const flatClipId = clip.id
    return {
      entryPoint: resolveProjectFixedStudioEntryPoint(
        path.join(app.getPath('userData'), 'remotion-studio'),
        request.projectId,
      ),
      sources: [{ clipId: flatClipId, absolutePath: sourcePath }],
      input: {
        schemaVersion: 1 as const,
        projectId: request.projectId,
        chapterId: request.chapterId,
        editingProjectId: project.value.id,
        editingRevision: request.revision,
        width: plan.value.renderSettings.width,
        height: plan.value.renderSettings.height,
        fps,
        durationInFrames,
        clips: [{
          shotId: flatClipId,
          src: '',
          durationInFrames,
          trimBeforeFrames: Math.max(0, Math.floor((clip.trimStartUs * fps) / 1_000_000)),
          crop: { x: 0, y: 0, width: plan.value.renderSettings.width, height: plan.value.renderSettings.height },
          transform: clip.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
          volume: clip.muted ? 0 : clip.volume,
          subtitle: '',
        }],
      },
      plan: plan.value,
      currentShotSlots,
    }
  }
  const currentShotSlots: RemotionCurrentSlotV1[] = []
  const sourcePathByShotId = new Map<string, string>()
  for (const clip of visualClips) {
    const storyboardId = clip.source.evidence.storyboardId
    const shotRevision = clip.source.evidence.outputVersion
    if (clip.source.kind !== 'storyboardVideo' || !storyboardId || typeof shotRevision !== 'number' || !Number.isInteger(shotRevision) || shotRevision <= 0) {
      throw new Error(`当前章节镜头不是 Remotion current StoryboardShot: ${clip.id}`)
    }
    const verifiedShotRevision = shotRevision
    if (!clip.source.evidence.remotionJobId || !clip.source.evidence.remotionEvidenceSha256 || !clip.source.evidence.remotionInputHash) {
      throw new Error(`当前章节镜头不是可验证的 Remotion current shot: ${clip.id}`)
    }
    const slotResult = await readRemotionCurrentShotSlot(remotionWorkspaceRoot, request.projectId, {
      kind: 'shot', chapterId: request.chapterId, shotId: storyboardId, shotRevision: verifiedShotRevision,
    })
    if (!slotResult.success) {
      throw new Error(`当前章节镜头 current slot 无效: ${clip.id}: ${slotResult.issues.map((issue) => issue.message).join('；')}`)
    }
    const slot = slotResult.value
    const slotOutputPath = resolveRemotionCurrentSlotOutputPath(remotionWorkspaceRoot, slot)
    const requestedSourcePath = clip.source.path?.trim()
    let projectedSourcePath = slotOutputPath
    if (requestedSourcePath && requestedSourcePath !== slot.outputPath) {
      const resolvedRequestedPath = requestedSourcePath.startsWith('project-file://')
        ? resolveStudioSourcePath(requestedSourcePath)
        : path.isAbsolute(requestedSourcePath) ? requestedSourcePath : undefined
      if (!resolvedRequestedPath) {
        throw new Error(`当前章节镜头 source.path 不是可解析的绝对路径或 project-file URL: ${clip.id}`)
      }
      if (!pathsEquivalent(resolvedRequestedPath, slotOutputPath)) {
        if (!projectionGate.accepted || projectionGate.mode !== 'editable-edl') {
          throw new Error(`当前章节镜头派生输入未通过 video-use gate: ${clip.id}`)
        }
        if (clip.source.evidence.sourceFingerprint !== projectionGate.videoUseArtifactSha256) {
          throw new Error(`当前章节镜头派生输入未绑定当前 video-use artifact: ${clip.id}`)
        }
        const derived = projectionGate.videoUseDerivedInputs?.find((entry) =>
          pathsEquivalent(entry.derivedPath, resolvedRequestedPath),
        )
        if (!derived) {
          throw new Error(`当前章节镜头缺少可追溯派生输入 evidence: ${clip.id}`)
        }
        const stat = await fs.promises.stat(resolvedRequestedPath)
        if (!stat.isFile() || stat.size <= 0) {
          throw new Error(`当前章节镜头派生输入不存在或为空: ${clip.id}`)
        }
        projectedSourcePath = resolvedRequestedPath
      }
    }
    const sourcePathBound = pathsEquivalent(projectedSourcePath, slotOutputPath)
      || (projectionGate.accepted
        && projectionGate.mode === 'editable-edl'
        && clip.source.evidence.sourceFingerprint === projectionGate.videoUseArtifactSha256
        && projectionGate.videoUseDerivedInputs?.some((entry) =>
          pathsEquivalent(entry.derivedPath, projectedSourcePath),
        ) === true)
    if (!sourcePathBound
      || clip.source.evidence.remotionJobId !== slot.job.jobId
      || clip.source.evidence.remotionEvidenceSha256 !== slot.evidence.sha256
      || clip.source.evidence.remotionInputHash !== slot.job.inputHash
      || slot.evidence.compositionId !== 'StoryboardShot'
      || slot.evidence.renderer.requested !== 'remotion'
      || slot.evidence.renderer.actual !== 'remotion') {
      throw new Error(`当前章节镜头与 Remotion current slot identity 不一致: ${clip.id}`)
    }
    if (currentShotSlots.some((candidate) => candidate.target.kind === 'shot' && candidate.target.shotId === storyboardId)) {
      throw new Error(`当前章节重复绑定 Remotion shot: ${storyboardId}`)
    }
    sourcePathByShotId.set(storyboardId, projectedSourcePath)
    currentShotSlots.push(slot)
  }
  const fps = plan.value.renderSettings.fps
  const clipFrames = (clip: (typeof visualClips)[number]) => Math.max(1, Math.ceil((clip.durationUs * fps) / 1_000_000))
  const transitionByFromClipId = new Map(
    (project.value.transitions ?? [])
      .filter((transition) => typeof transition.fromClipId === 'string')
      .map((transition) => [transition.fromClipId as string, transition]),
  )
  // Studio projection 只表达 cut / fade；EDL 的装饰性转场（crossfade/flash 等）
  // 按时长折叠为 fade 重叠，cut 与无转场保持硬切，时长钳制不得覆盖相邻镜。
  const studioTransitions: Array<{ type: 'cut'; durationInFrames: 0 } | { type: 'fade'; durationInFrames: number } | undefined> = visualClips.map((clip, index) => {
    if (index === visualClips.length - 1) return undefined
    const transition = transitionByFromClipId.get(clip.id)
    const requested = transition && transition.effectId !== 'cut' && Number.isFinite(transition.durationUs)
      ? Math.floor((transition.durationUs * fps) / 1_000_000)
      : 0
    const cap = Math.min(clipFrames(clip), clipFrames(visualClips[index + 1]!)) - 1
    const fadeFrames = Math.min(requested, Math.max(0, cap))
    return fadeFrames > 0 ? { type: 'fade' as const, durationInFrames: fadeFrames } : { type: 'cut' as const, durationInFrames: 0 }
  })
  const durationInFrames = studioTransitions.reduce(
    (total, transition, index) => total + clipFrames(visualClips[index]!) - (transition?.type === 'fade' ? transition.durationInFrames : 0),
    0,
  )
  const currentShotSlotById = new Map(
    currentShotSlots.map((slot) => [slot.target.kind === 'shot' ? slot.target.shotId : '', slot] as const),
  )
  return {
    entryPoint: resolveProjectFixedStudioEntryPoint(
      path.join(app.getPath('userData'), 'remotion-studio'),
      request.projectId,
    ),
    sources: visualClips.map((clip) => {
      const shotId = clip.source.evidence.storyboardId
      const slot = shotId ? currentShotSlotById.get(shotId) : undefined
      if (!shotId || !slot || slot.target.kind !== 'shot') {
        throw new Error(`当前章节镜头缺少合法 current slot: ${clip.id}`)
      }
      const absolutePath = sourcePathByShotId.get(shotId)
      if (!absolutePath) {
        throw new Error(`当前章节镜头缺少已解析的 Studio source path: ${shotId}`)
      }
      return {
        clipId: shotId,
        absolutePath,
      }
    }),
    input: {
      schemaVersion: 1 as const,
      projectId: request.projectId,
      chapterId: request.chapterId,
      editingProjectId: project.value.id,
      editingRevision: request.revision,
      width: plan.value.renderSettings.width,
      height: plan.value.renderSettings.height,
      fps,
      durationInFrames,
      clips: visualClips.map((clip, index) => ({
        shotId: clip.source.evidence.storyboardId!,
        src: '',
        durationInFrames: clipFrames(clip),
        trimBeforeFrames: Math.max(0, Math.floor((clip.trimStartUs * fps) / 1_000_000)),
        crop: { x: 0, y: 0, width: plan.value.renderSettings.width, height: plan.value.renderSettings.height },
        transform: clip.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        volume: clip.muted ? 0 : clip.volume,
        subtitle: plan.value.clips.find((candidate) => candidate.trackKind === 'text'
          && candidate.source.evidence.storyboardId === clip.source.evidence.storyboardId)?.source.text ?? '',
        ...(studioTransitions[index] ? { transitionAfter: studioTransitions[index] } : {}),
      })),
    },
    plan: plan.value,
    currentShotSlots,
  }
}

export async function readEditingProjectSnapshot(request: { projectId: string; chapterId: string }): Promise<import('../../types/editing').EditingProjectV1 | undefined> {
  try {
    const editingPath = resolveDataFilePath(getDataDir(), `_p/${request.projectId}/editing`)
    const parsed = JSON.parse(await fs.promises.readFile(editingPath, 'utf8')) as unknown
    const state = isRecord(parsed) && isRecord(parsed.state) ? parsed.state : parsed
    if (!isRecord(state) || !isRecord(state.editingProjects) || !isRecord(state.currentEditingProjectIdByEpisode)) return undefined
    const id = state.currentEditingProjectIdByEpisode[request.chapterId]
    const result = validateEditingProject(typeof id === 'string' ? state.editingProjects[id] : undefined)
    return result.success && result.value.projectId === request.projectId && result.value.episodeId === request.chapterId
      ? result.value
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Queue state schedules new work. Persisted current triples restore verified
 * outputs after restart without treating volatile queue state as render proof.
 */
export async function readRemotionCurrentShotSlots(scope: { projectId: string; chapterId: string }): Promise<RemotionCurrentSlotV1[]> {
  const workspaceRoot = path.join(projectRootFor(scope.projectId), 'remotion')
  return readRemotionCurrentShotSlotsFromWorkspace(workspaceRoot, scope.projectId, scope.chapterId)
}

/**
 * 按场分段导出入队服务（渲染域 IPC → 本函数）：复用章级 projection 编译器
 * 拿同一 plan/slots，场结构由渲染域从分镜表原文推导后随请求传入，这里只做
 * 「分镜→渲染计划片段」的结构校验与帧分区。产物落项目根
 * `exports/<chapterId>/scenes/`，不走 current slot、不触发章级 QC。
 */
export async function enqueueChapterSceneSegments(
  request: RemotionQueueEnqueueChapterScenesRequest,
): Promise<RemotionQueueEnqueueChapterScenesReply> {
  try {
    const { remotionVersion, remotionRuntime, remotionChapterManifestService, remotionBundlePath, remotionQueue } = requireRuntime()
    // function 声明可早于模块级守卫被调用，这里自行收窄（模块级已有同款 throw）。
    const resolvedRemotionVersion = remotionVersion
    if (typeof resolvedRemotionVersion !== "string") {
      return { accepted: false, message: "package.json 必须声明精确 Remotion 版本" }
    }
    const browser = await remotionRuntime.controller.probeStatus()
    if (browser.status.state !== 'ready') {
      return { accepted: false, message: `Remotion Headless Shell 未就绪: ${browser.status.message ?? browser.status.state}` }
    }
    const projection = await loadChapterStudioProjection({
      projectId: request.projectId,
      chapterId: request.chapterId,
      revision: request.editingRevision,
    })
    const plan = projection.plan
    const currentShotSlots = [...projection.currentShotSlots]
    const layout = layoutChapterVisualClipTimings(plan)
    const framePlan = planSceneSegmentFrameRanges({
      clips: layout.clips,
      durationInFrames: layout.durationInFrames,
      scenes: request.segments.map((segment) => ({
        sceneNo: segment.sceneNo,
        sceneName: segment.sceneName,
        storyboardIds: segment.storyboardIds,
      })),
    })
    if (!framePlan.success) {
      return { accepted: false, message: `按场分段校验失败：${framePlan.issues.join('；')}` }
    }
    const chapterManifest = await remotionChapterManifestService.read(request.projectId, request.chapterId)
    if (!chapterManifest) return { accepted: false, message: '当前章节缺少 RemotionChapterManifestV2' }
    const manifest = JSON.parse(await fs.promises.readFile(path.join(remotionBundlePath, 'manifest.json'), 'utf8')) as {
      contentHash?: unknown;
      templateVersion?: unknown;
    }
    if (typeof manifest.contentHash !== 'string' || typeof manifest.templateVersion !== 'string') {
      return { accepted: false, message: 'Remotion bundle manifest 缺少 template/content hash' }
    }
    const projectRoot = projectRootFor(request.projectId)
    const layerWorkspaceRoot = path.join(projectRoot, 'remotion')
    const replySegments: RemotionQueueEnqueueChapterScenesReplySegment[] = []
    for (let index = 0; index < framePlan.segments.length; index += 1) {
      const segment = framePlan.segments[index]!
      const sceneRequest = request.segments.find((candidate) => candidate.sceneNo === segment.sceneNo)
      if (!sceneRequest) return { accepted: false, message: `场 ${segment.sceneNo} 缺少请求参数` }
      const outputRelativePath = `exports/${request.chapterId}/scenes/Sc${String(segment.sceneNo).padStart(2, '0')}_${sanitizeSceneSegmentName(segment.sceneName)}.mp4`
      const job = await createReadyRemotionChapterSceneJob({
        plan,
        currentShotSlots,
        chapterManifest,
        bundleContentHash: manifest.contentHash,
        templateVersion: manifest.templateVersion,
        remotionVersion: resolvedRemotionVersion,
        layerWorkspaceRoot,
        sceneSegment: {
          sceneNo: segment.sceneNo,
          sceneName: sceneRequest.sceneName,
          storyboardIds: sceneRequest.storyboardIds,
          frameRange: [segment.startFrame, segment.endFrame],
          outputRelativePath,
        },
      })
      const result = await remotionQueue.enqueueChapterScene({
        kind: 'chapter-scene',
        job,
        dependencyJobIds: currentShotSlots.map((slot) => slot.job.jobId),
        plan,
        currentShotSlots,
        sceneSegment: {
          sceneNo: segment.sceneNo,
          sceneName: sceneRequest.sceneName,
          storyboardIds: sceneRequest.storyboardIds,
          frameRange: [segment.startFrame, segment.endFrame],
          outputRelativePath,
        },
      })
      if (!result.accepted) {
        if (result.reason === 'duplicate-active' || result.reason === 'already-succeeded') {
          replySegments.push({
            sceneNo: segment.sceneNo,
            jobId: result.job.jobId,
            outputRelativePath,
            outputAbsolutePath: path.join(projectRoot, outputRelativePath),
            frameRange: [segment.startFrame, segment.endFrame],
          })
          continue
        }
        return { accepted: false, message: 'message' in result ? result.message : `场 ${segment.sceneNo} 入队被拒绝: ${result.reason}` }
      }
      replySegments.push({
        sceneNo: segment.sceneNo,
        jobId: result.job.jobId,
        outputRelativePath,
        outputAbsolutePath: path.join(projectRoot, outputRelativePath),
        frameRange: [segment.startFrame, segment.endFrame],
      })
    }
    return { accepted: true, segments: replySegments }
  } catch (error) {
    return { accepted: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
