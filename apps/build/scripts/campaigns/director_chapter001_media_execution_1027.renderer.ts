/** Real singleton/graph/AI/frame path in an empty, native nonpersistent session. */
import { aiManager } from '@/lib/ai/ai-manager';
import { useProjectStore } from '@/stores/project/project-store';
import { useStudioStore } from '@/stores/studio/studio-store';
import { useAPIConfigStore } from '@/stores/ai/api-config-store';
import { warmExtendedManualStyleTokens } from '@/lib/studio/visual-manual-style-tokens';
import { createOpenImageWorkflowGraph } from '@/components/panels/studio/image-workflow/image-workflow-graph-utils';
import { buildStoryboardItemOpenContext } from '@/components/panels/studio/storyboard-open-context';
import { runStoryboardSingleShotOnce } from '@/components/panels/studio/image-workflow/use-storyboard-batch-generation';
import type { ImageWorkflowOpenContext } from '@/types/studio';
import type { FrozenChapter001Bridge1027, RendererMedia1027, MediaFrame1027 } from './director_chapter001_media_publication_1027.test';

type Binding = { storyboardId: string; storyboardSha256: string; assetReferences: NonNullable<ImageWorkflowOpenContext['assetReferences']> };
type Input = { frozen: FrozenChapter001Bridge1027; frozenSha256: string; projectId: string; sourceSha256: string; manifestSha256: string; binding: Binding; maxPosts: number; maxSaves: number };
function demand(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
async function hydrate(store: { hasHydrated(): boolean; onFinishHydration(callback: () => void): () => void }) {
  if (store.hasHydrated()) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Real hydration timeout')); }, 5000);
    const off = store.onFinishHydration(() => { clearTimeout(timer); off(); resolve(); });
  });
}
export async function bootVerification() {
  demand(!window.fileStorage && typeof aiManager.generateImage === 'function', 'Unexpected persistence bridge/core');
  await Promise.all([hydrate(useProjectStore.persist), hydrate(useStudioStore.persist), hydrate(useAPIConfigStore.persist)]);
  const project = useProjectStore.getState(), studio = useStudioStore.getState();
  const seeded = project.projects[0];
  // project-store.ts seeds this exact identity even in a new, empty partition.
  demand(project.activeProjectId === 'default-project' && project.projects.length === 1
    && project.activeProject === seeded && seeded.id === 'default-project' && seeded.name === '漫影工作室项目'
    && Object.keys(seeded).sort().join(',') === 'createdAt,id,name,updatedAt'
    && Number.isFinite(seeded.createdAt) && Number.isFinite(seeded.updatedAt)
    && studio.activeChapterId === null && studio.seriesBible === null && studio.sourceBible === ''
    && [studio.materials, studio.novelChapters, studio.agentWorkData, studio.entityExtractions,
      studio.scriptPlans, studio.episodeOutlines, studio.storyboards, studio.continuityAssetVersions,
      studio.productionTracks, studio.videoCandidates, studio.sceneSegments, studio.imageWorkflows,
      studio.agentRuns, studio.mediaTasks, studio.eventGraph, studio.projectMemoryRecords].every(rows => rows.length === 0),
  'Native session was not empty');
  return { actualSingletonsHydrated: true, actualAiManagerImported: true, actualSingleShotEntryImported: typeof runStoryboardSingleShotOnce === 'function', projectWrites: 0, generationExecuted: false };
}
export async function generate(input: Input, readback: () => Promise<MediaFrame1027[]>) : Promise<RendererMedia1027> {
  await bootVerification();
  const before = input.frozen.bridge.envelope;
  demand(before.state.activeChapterId === 'chapter-001' && before.state.workflowConfig.directorManualId === 'Daojie_xianxia', 'Wrong source scope');
  const board = before.state.storyboards.find(item => item.id === input.binding.storyboardId);
  demand(board?.episodeId === 'chapter-001' && await hash(JSON.stringify(board)) === input.binding.storyboardSha256, 'Frozen shot binding mismatch');
  demand(board.keyframes && board.keyframes.length >= 1 && board.keyframes.length <= 3 && board.keyframes.length === input.maxPosts && input.maxSaves === input.maxPosts && board.keyframes.every(frame => frame.mediaRef.kind === 'image'), 'Pilot permit must equal original planned slot count');
  const plannedIds = board.keyframes.map(frame => frame.frameId);
  demand(input.binding.assetReferences.length > 0, 'Root-reviewed exact references required');
  useStudioStore.setState(structuredClone(before.state));
  useProjectStore.setState({ activeProjectId: input.projectId });
  await warmExtendedManualStyleTokens();
  // Production graph factory creates every graph/node identity; no hand-built frame records.
  const graph = createOpenImageWorkflowGraph({ ...buildStoryboardItemOpenContext({ ...board, mediaRef: board.stale ? undefined : board.mediaRef }), assetReferences: input.binding.assetReferences }, '道劫');
  useStudioStore.getState().upsertImageWorkflow(graph);
  await runStoryboardSingleShotOnce(useStudioStore.getState().storyboards.find(item => item.id === board.id)!, '道劫');
  const frames = await readback();
  const current = useStudioStore.getState();
  const written = current.storyboards.find(item => item.id === board.id);
  demand(written?.keyframes?.length === plannedIds.length && frames.length === plannedIds.length, 'Actual selected-shot frame count mismatch');
  const actualFrames = written.keyframes.map((slot, index) => {
    const saved = frames[index];
    demand(slot.frameId === plannedIds[index] && slot.origin?.kind === 'generated' && slot.mediaRef.path && saved.path === slot.mediaRef.path, 'Actual finalize/readback mismatch');
    demand(slot.mediaRef.imageWorkflowId && slot.mediaRef.imageWorkflowNodeId, 'Production frame identity missing');
    return { ...saved, storyboardId: written.id, frameId: slot.frameId, workflowId: slot.mediaRef.imageWorkflowId, nodeId: slot.mediaRef.imageWorkflowNodeId };
  });
  demand(written.visualReview?.reviewer !== 'human', 'Renderer cannot supply human approval');
  // Export only original state domains, read from the actual singleton after finalize.
  const state = Object.fromEntries(Object.keys(before.state).map(key => [key, current[key as keyof typeof current]]));
  return { schema: 'chapter001-renderer-media-v1', projectId: input.projectId, chapterId: 'chapter-001', frozenSha256: input.frozenSha256, snapshotSha256: input.frozen.snapshotSha256, jobSha256: input.frozen.jobSha256, sourceSha256: input.sourceSha256, manifestSha256: input.manifestSha256, baselineSha256: input.frozen.baselineSha256, producer: 'runImageWorkflowNodeGeneration/projectFiles.saveImage', envelope: { state: JSON.parse(JSON.stringify(state)), version: before.version }, frames: actualFrames };
}
