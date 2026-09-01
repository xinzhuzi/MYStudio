/**
 * main.ts hosted Remotion Studio 会话簇(assembly 专批外迁,体逐字保留)——
 * 会话状态/关闭/编辑回写/IPC 注册。nativeStudioQueueBridge 由 main.ts 装配后
 * 经 bindHostedStudioRuntime 注入(消费点均在 IPC 调用时,晚于绑定)。
 */
import { BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import {
  buildMinimalRemotionStudioStartOptions,
  generateChapterStudioProjection,
  RemotionStudioService,
  type RemotionStudioChapterRenderContext,
} from '@rendering/plugins/remotion/studio'
import { RemotionStudioRenderQueueBridge } from '@rendering/plugins/remotion/studio'
import { registerRemotionStudioIpcHandlers, broadcastRemotionStudioEditingUpdated } from '../ipc/studio/remotion-studio-ipc'
import { watchChapterStudioProjection } from '@rendering/plugins/remotion/studio'
import { MediaBridgeServer } from '@rendering/plugins/remotion/media-bridge/media-bridge-server'
import { buildMediaUrlMap } from '@rendering/plugins/remotion/media-bridge/media-bridge-source-map'
import { withFileStorageMutationLock } from '../ipc/files/file-storage-ipc'
import { resolveDataFilePath } from '../storage/storage-paths'
import { validateEditingProject } from '../../lib/studio/editing/validation'
import { getDataDir } from './main-paths'
import { isRecord, loadChapterStudioProjection, readEditingProjectSnapshot } from './main-chapter-projection'

let _bridge: RemotionStudioRenderQueueBridge | null = null

export function bindHostedStudioRuntime(bridge: RemotionStudioRenderQueueBridge): void {
  _bridge = bridge
}

function requireBridge(): RemotionStudioRenderQueueBridge {
  if (!_bridge) throw new Error('main-hosted-studio 运行时未装配:bindHostedStudioRuntime 未被调用')
  return _bridge
}

let hostedStudioChapterContext: RemotionStudioChapterRenderContext | null = null

export function getHostedStudioChapterContext(): RemotionStudioChapterRenderContext | undefined {
  return hostedStudioChapterContext ?? undefined
}

export async function disposeHostedStudio(): Promise<void> {
  if (hostedStudioIdentity) await closeHostedStudioSession(hostedStudioIdentity.projectId)
  else await hostedStudioMedia.close()
}

export const hostedStudio = new RemotionStudioService()
const hostedStudioMedia = new MediaBridgeServer()
let hostedStudioMediaSession: ReturnType<MediaBridgeServer['createSession']> | null = null
let hostedStudioIdentity: { projectId: string; chapterId: string; revision: number } | null = null
let hostedStudioProjectionWatcher: { close: () => void } | null = null
async function closeHostedStudioSession(projectId: string): Promise<void> {
  if (hostedStudioIdentity && hostedStudioIdentity.projectId !== projectId) {
    throw new Error(`当前 Studio 会话属于项目 ${hostedStudioIdentity.projectId}，拒绝关闭 ${projectId}`)
  }
  hostedStudioProjectionWatcher?.close()
  hostedStudioProjectionWatcher = null
  hostedStudioChapterContext = null
  await hostedStudio.close()
  if (hostedStudioMediaSession) await hostedStudioMedia.revokeSession(hostedStudioMediaSession)
  else await hostedStudioMedia.close()
  hostedStudioMediaSession = null
  hostedStudioIdentity = null
}

export async function persistStudioEditingRevision(project: import('../../types/editing').EditingProjectV1): Promise<void> {
  const editingPath = resolveDataFilePath(getDataDir(), `_p/${project.projectId}/editing`)
  await withFileStorageMutationLock(editingPath, async () => {
    const raw = JSON.parse(await fs.promises.readFile(editingPath, 'utf8')) as unknown
    const state = isRecord(raw) && isRecord(raw.state) ? raw.state : raw
    if (!isRecord(state) || !isRecord(state.editingProjects) || !isRecord(state.currentEditingProjectIdByEpisode)) {
      throw new Error('Studio 回写时 editing 持久化状态结构无效')
    }
    const current = state.editingProjects[project.id]
    const validated = validateEditingProject(current)
    if (!validated.success || validated.value.revision !== project.revision - 1) {
      throw new Error('Studio 回写目标已被更新或基线 revision 不连续，拒绝覆盖更新版本')
    }
    if (validated.value.projectId !== project.projectId || validated.value.episodeId !== project.episodeId) {
      throw new Error('Studio 回写目标项目/章节不一致')
    }
    if (state.currentEditingProjectIdByEpisode[project.episodeId] !== project.id) {
      throw new Error('Studio 回写目标不是当前章节工程，拒绝覆盖')
    }
    state.editingProjects[project.id] = project
    state.currentEditingProjectIdByEpisode[project.episodeId] = project.id
    const temporaryPath = `${editingPath}.${process.pid}.tmp`
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
    await fs.promises.rename(temporaryPath, editingPath)
    broadcastRemotionStudioEditingUpdated(BrowserWindow.getAllWindows(), {
      projectId: project.projectId,
      chapterId: project.episodeId,
      revision: project.revision,
    }, (error) => {
      console.error('[remotion-studio] editing revision notification failed', error)
    })
  })
}
export const hostedStudioIpc = registerRemotionStudioIpcHandlers({
  ensureSession: async (request) => {
    hostedStudio.assertProjectCanEnsure(request.projectId)
    const nativeStudioQueueBridge = requireBridge()
    const projection = await loadChapterStudioProjection(request)
    const sameIdentity = hostedStudioIdentity?.projectId === request.projectId
      && hostedStudioIdentity?.chapterId === request.chapterId
      && hostedStudioIdentity?.revision === request.revision
    if (!sameIdentity) {
      hostedStudioProjectionWatcher?.close()
      hostedStudioProjectionWatcher = null
      await hostedStudioMedia.listen()
      const nextMediaSession = hostedStudioMedia.createSession()
      try {
        const urls = buildMediaUrlMap(hostedStudioMedia, nextMediaSession, projection.sources)
        const generated = generateChapterStudioProjection({
          ...projection.input,
          clips: projection.input.clips.map((clip) => ({ ...clip, src: urls[clip.shotId] ?? "" })),
        })
        await fs.promises.mkdir(path.dirname(projection.entryPoint), { recursive: true })
        await fs.promises.writeFile(projection.entryPoint, generated.source, 'utf8')
        const session = await hostedStudio.ensureSession(request, buildMinimalRemotionStudioStartOptions({
          appsRoot: process.env.APP_ROOT ?? path.join(__dirname, '../..'),
          entryPoint: projection.entryPoint,
          renderQueue: nativeStudioQueueBridge,
        }))
        const previousMediaSession = hostedStudioMediaSession
        hostedStudioMediaSession = nextMediaSession
        hostedStudioIdentity = request
        hostedStudioChapterContext = {
          projectId: request.projectId,
          chapterId: request.chapterId,
          revision: request.revision,
          plan: projection.plan,
          currentShotSlots: projection.currentShotSlots,
        }
        const expectedIdentity = {
          projectId: request.projectId,
          chapterId: request.chapterId,
          editingProjectId: projection.input.editingProjectId,
          editingRevision: request.revision,
          clips: projection.input.clips.map((clip) => ({ shotId: clip.shotId, src: urls[clip.shotId] ?? '' })),
        }
        hostedStudioProjectionWatcher = watchChapterStudioProjection({
          sourcePath: projection.entryPoint,
          expectedIdentity,
          getCurrentProject: async () => readEditingProjectSnapshot(request),
          onWriteback: async (result) => {
            await persistStudioEditingRevision(result.project)
            hostedStudioProjectionWatcher?.close()
            hostedStudioProjectionWatcher = null
          },
        })
        if (previousMediaSession) await hostedStudioMedia.revokeSession(previousMediaSession)
        return session
      } catch (error) {
        await hostedStudioMedia.revokeSession(nextMediaSession).catch(() => undefined)
        throw error
      }
    }
    return hostedStudio.ensureSession(request, buildMinimalRemotionStudioStartOptions({
      appsRoot: process.env.APP_ROOT ?? path.join(__dirname, '../..'),
      entryPoint: projection.entryPoint,
      renderQueue: nativeStudioQueueBridge,
    }))
  },
  closeSession: closeHostedStudioSession,
})
