/**
 * main.ts native Studio 队列桥簇(assembly 专批外迁,体逐字保留)——
 * video-use 章运行构造(buildManagedVideoUseChapterRun)+ RemotionStudioRenderQueueBridge。
 * remotion 装配单例与 videoUseAdapter 在 main.ts 装配后经 bindNativeBridgeRuntime 注入
 * (消费点均在 IPC 调用时,晚于绑定)。
 */
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createReadyRemotionChapterJob } from '@rendering/plugins/remotion/studio'
import { RemotionStudioRenderQueueBridge } from '@rendering/plugins/remotion/studio'
import type { registerRemotionRuntimeIpcHandlers } from '../ipc/studio/remotion-runtime-ipc'
import type { RemotionRenderQueue } from '@rendering/plugins/remotion/queue/remotion-render-queue'
import type { RemotionChapterManifestService } from '@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service'
import type { createVideoUseAdapter } from '@rendering/plugins/video-use/video-use-adapter'
import type { VideoWorkflowChapterRunRequestV1 } from '../rendering/contracts/video-workflow-ipc'
import type { VideoUseChapterRunV1 } from '@rendering/contracts/video-workflow'
import { readStudioWorkflowStore } from '../storage/studio-workflow-store-io'
import { parseProjectFileUrl, resolveProjectScopedFilePath } from '../storage/storage-paths'
import { getDataDir, projectRootFor, resolveStudioSourcePath } from './main-paths'
import { getHostedStudioChapterContext } from './main-hosted-studio'
import { evaluateVideoWorkflowChapterGate } from './main-chapter-projection'

export interface NativeBridgeRuntime {
  remotionVersion: string
  remotionBundlePath: string
  remotionRuntime: ReturnType<typeof registerRemotionRuntimeIpcHandlers>
  remotionChapterManifestService: RemotionChapterManifestService
  remotionQueue: RemotionRenderQueue
  videoUseAdapter: ReturnType<typeof createVideoUseAdapter>
}

let _nativeBridgeRuntime: NativeBridgeRuntime | null = null

export function bindNativeBridgeRuntime(runtime: NativeBridgeRuntime): void {
  _nativeBridgeRuntime = runtime
}

function requireNativeBridgeRuntime(): NativeBridgeRuntime {
  if (!_nativeBridgeRuntime) throw new Error('main-native-bridge 运行时未装配:bindNativeBridgeRuntime 未被调用')
  return _nativeBridgeRuntime
}

export const buildManagedVideoUseChapterRun = (request: VideoWorkflowChapterRunRequestV1): VideoUseChapterRunV1 => {
  const { videoUseAdapter } = requireNativeBridgeRuntime()
  const paths = videoUseAdapter.paths
  const now = Date.now()
  const packageLockSha256 = fs.existsSync(paths.videoUseLockPath)
    ? crypto.createHash('sha256').update(fs.readFileSync(paths.videoUseLockPath)).digest('hex')
    : '0'.repeat(64)
  // overlay 装饰槽内容感知定位：从项目 store 补每镜生成图路径（缺失回退公式定位）
  const imagePathByShotId = (() => {
    const map = new Map<string, string>()
    try {
      const store = readStudioWorkflowStore(getDataDir(), request.projectId)
      const storyboards = (store?.state?.storyboards ?? []) as Array<{ id: string; episodeId: string; mediaRef?: { path?: string } }>
      for (const storyboard of storyboards) {
        if (storyboard.episodeId !== request.chapterId || !storyboard.mediaRef?.path) continue
        const parsed = parseProjectFileUrl(storyboard.mediaRef.path)
        if (!parsed || parsed.projectId !== request.projectId) continue
        try {
          map.set(storyboard.id, resolveProjectScopedFilePath(getDataDir(), parsed.projectId, parsed.relativePath))
        } catch { /* 单镜媒体缺失不阻塞 */ }
      }
    } catch { /* store 缺失 → 公式定位 */ }
    return map
  })()
  return {
    schemaVersion: 1,
    projectId: request.projectId,
    chapterId: request.chapterId,
    revision: request.revision,
    mode: request.mode,
    derivedInputPolicy: request.derivedInputPolicy,
    storyboardSourcePolicy: request.storyboardSourcePolicy ?? 'current-ready',
    stage: 'preparing',
    timeUnit: 'seconds',
    shots: request.shots.map((shot) => ({
      ...shot,
      videoPath: resolveStudioSourcePath(shot.videoPath),
      audioPath: resolveStudioSourcePath(shot.audioPath),
      ...(imagePathByShotId.get(shot.shotId) ? { imagePath: imagePathByShotId.get(shot.shotId)! } : {}),
    })),
    ...(request.boundaryIntents ? { boundaryIntents: request.boundaryIntents } : {}),
    sourceSha256: request.sourceSha256,
    audioSha256: request.audioSha256,
    textSha256: request.textSha256,
    featureFlags: request.featureFlags,
    runtime: {
      profileId: 'video-use-managed-python-v1',
      pythonExecutable: paths.pythonExecutable,
      ffmpegExecutable: paths.ffmpegExecutable,
      ffprobeExecutable: paths.ffprobeExecutable,
      packageLockSha256,
      markerPath: paths.videoUseMarkerPath,
    },
    createdAt: now,
    updatedAt: now,
  }
}

export const nativeStudioQueueBridge = new RemotionStudioRenderQueueBridge({
  getContext: () => getHostedStudioChapterContext(),
  enqueueChapter: async ({ context }) => {
    const { remotionVersion, remotionBundlePath, remotionRuntime, remotionChapterManifestService, remotionQueue } = requireNativeBridgeRuntime()
    console.error('[chapter-video] step1: probeStatus...')
    const browser = await remotionRuntime.controller.probeStatus()
    if (browser.status.state !== 'ready') {
      return { accepted: false, message: `Remotion Headless Shell 未就绪: ${browser.status.message ?? browser.status.state}` }
    }
    console.error('[chapter-video] step2: bundle manifest...')
    const manifest = JSON.parse(await fs.promises.readFile(path.join(remotionBundlePath, 'manifest.json'), 'utf8')) as {
      contentHash?: unknown;
      templateVersion?: unknown;
    }
    if (typeof manifest.contentHash !== 'string' || typeof manifest.templateVersion !== 'string') {
      return { accepted: false, message: 'Remotion bundle manifest 缺少 template/content hash' }
    }
    console.error('[chapter-video] step3: chapter manifest...')
    const chapterManifest = await remotionChapterManifestService.read(context.projectId, context.chapterId)
    if (!chapterManifest) return { accepted: false, message: '当前章节缺少 RemotionChapterManifestV2' }
    console.error('[chapter-video] step4: createReadyRemotionChapterJob...')
    const job = await createReadyRemotionChapterJob({
      plan: context.plan,
      currentShotSlots: context.currentShotSlots,
      chapterManifest,
      bundleContentHash: manifest.contentHash,
      templateVersion: manifest.templateVersion,
      remotionVersion,
      // 分层发现根与 RemotionChapterRenderer.render 同款（08-19 multilayer Child1），
      // 保证 expectedJobId 不因层资产进身份哈希而失配。
      layerWorkspaceRoot: path.join(projectRootFor(context.projectId), 'remotion'),
    })
    console.error('[chapter-video] step5: evaluateVideoWorkflowChapterGate...')
    const gate = await evaluateVideoWorkflowChapterGate({
      projectId: context.projectId,
      chapterId: context.chapterId,
      revision: context.revision,
      inputSha256: job.inputHash,
    })
    if (!gate.accepted) {
      return { accepted: false, message: `视频工作流章节 gate blocked: ${gate.code} ${gate.message}` }
    }
    console.error('[chapter-video] step6: remotionQueue.enqueueChapter...')
    const result = await remotionQueue.enqueueChapter({
      kind: 'chapter',
      job,
      dependencyJobIds: context.currentShotSlots.map((slot) => slot.job.jobId),
      plan: context.plan,
      currentShotSlots: [...context.currentShotSlots],
    })
    if (!result.accepted) {
      const message = 'message' in result ? result.message : `ChapterVideo 队列拒绝: ${result.reason}`
      console.error('[chapter-video] enqueueChapter 拒绝:', message, 'deps:', context.currentShotSlots.length)
      return { accepted: false, message }
    }
    return { accepted: true, job: result.job }
  },
  getJob: (jobId) => requireNativeBridgeRuntime().remotionQueue.getJob(jobId),
  cancelJob: (jobId) => requireNativeBridgeRuntime().remotionQueue.cancel(jobId),
})
