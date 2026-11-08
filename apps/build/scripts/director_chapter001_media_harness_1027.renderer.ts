/** Task-only boot probe. No module aliases, fake stores or generated frame fixtures. */
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { aiManager } from '@/lib/ai/ai-manager';
import { persistWithStatus } from '@/lib/storage/persistence-status';
import { useProjectStore } from '@/stores/project/project-store';
import { useStudioStore } from '@/stores/studio/studio-store';
import { useAPIConfigStore } from '@/stores/ai/api-config-store';
import { runImageWorkflowNodeGeneration } from '@/components/panels/studio/image-workflow/run-image-workflow-node-generation';
import { useStoryboardBatchGeneration } from '@/components/panels/studio/image-workflow/use-storyboard-batch-generation';
import type { StudioWorkflowState } from '@/stores/studio/studio-store';

// Export the real entry points for inspection. Boot never invokes generation/start.
export { runImageWorkflowNodeGeneration, useStoryboardBatchGeneration };

function requireProbe(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function hydrated(store: { hasHydrated(): boolean; onFinishHydration(callback: () => void): () => void }) {
  if (store.hasHydrated()) return;
  await new Promise<void>((resolve, reject) => {
    const unsubscribe = store.onFinishHydration(() => { clearTimeout(timer); unsubscribe(); resolve(); });
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Actual store hydration timed out')); }, 5000);
  });
}

/** Native Chromium memory session is established and checked by main BEFORE this bundle evaluates. */
export async function bootVerification() {
  requireProbe(!window.fileStorage && !window.projectFiles && !window.studioAssets, 'Unexpected production persistence/reference bridge');
  await Promise.all([
    hydrated(useProjectStore.persist), hydrated(useStudioStore.persist), hydrated(useAPIConfigStore.persist),
  ]);
  const studio = useStudioStore.getState();
  requireProbe(typeof aiManager.generateImage === 'function' && typeof runImageWorkflowNodeGeneration === 'function', 'Real image entry points unavailable');
  requireProbe(typeof studio.addMaterial === 'function' && typeof studio.setStoryboardKeyframes === 'function', 'Real material/frame actions unavailable');
  requireProbe(studio.storyboards.length === 0 && studio.materials.length === 0, 'Fresh session unexpectedly hydrated media');
  // Exercise the real project action and its persist adapter against native memory storage.
  useProjectStore.getState().setActiveProject(null);
  requireProbe(useProjectStore.getState().activeProjectId === null, 'Real project action failed');
  await persistWithStatus('mystudio-project-store', async () => undefined);
  const persistedProject = JSON.parse(localStorage.getItem('mystudio-project-store') ?? 'null') as { state?: { activeProjectId?: string | null } } | null;
  requireProbe(persistedProject?.state?.activeProjectId === null, 'Native memory persistence round trip failed');
  // Mount the actual production hook; do not start its queue/retry/lifecycle path.
  let batchState: unknown;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Actual batch hook mount timed out')), 5000);
    function Probe() {
      const batch = useStoryboardBatchGeneration({ storyboards: [], projectName: 'chapter001 isolated boot' });
      useEffect(() => { batchState = batch.state; clearTimeout(timer); resolve(); }, [batch.state]);
      return null;
    }
    root.render(createElement(Probe));
  });
  root.unmount();
  requireProbe(studio.storyboards.length === 0 && studio.materials.length === 0, 'Boot fabricated media');
  return {
    mode: 'offline-boot', actualSingletonsHydrated: true, actualProjectActionMemoryRoundTrip: true,
    actualImageCoreImported: true, actualAiManagerImported: true, actualBatchHookMounted: true,
    batchState, generatedImages: 0, finalFramesWritten: 0, mediaSaved: 0,
    generationImplemented: false, realProjectWrites: 0,
  };
}

/** Hydrate a hash-bound bridge result only after native memory isolation and real store hydration. */
export async function loadBridgeResult(result: { envelope: { state: StudioWorkflowState; version: number }; diff: { otherChaptersUnchanged: boolean; generatedImages: number; projectWrites: number }; reviews: Record<string, string> }) {
  requireProbe(result.diff.otherChaptersUnchanged === true && result.diff.generatedImages === 0 && result.diff.projectWrites === 0, 'Expected unmodified text-only applyChapter001InMemory result');
  requireProbe(['script', 'planning', 'storyboard'].every(stage => typeof result.reviews[stage] === 'string' && result.reviews[stage].length > 0), 'Bridge review reports missing');
  const state = result.envelope.state;
  requireProbe(state.activeChapterId === 'chapter-001' && state.workflowConfig.directorManualId === 'Daojie_xianxia', 'Bridge chapter/manual mismatch');
  const chapter = state.novelChapters.find(item => item.id === 'chapter-001');
  requireProbe(chapter?.sourceText && chapter.sourceId && Number.isInteger(chapter.revision), 'Bridge source identity missing');
  const current = useStudioStore.getState();
  for (const [key, value] of Object.entries(state)) {
    requireProbe(Object.hasOwn(current, key) && typeof current[key as keyof typeof current] !== 'function' && typeof value !== 'function', `Unexpected bridge state key: ${key}`);
  }
  useStudioStore.setState(structuredClone(state));
  // Export through the actual singleton; publication must independently validate this envelope.
  const stored = JSON.parse(JSON.stringify(useStudioStore.getState())) as StudioWorkflowState;
  requireProbe(stored.activeChapterId === state.activeChapterId && stored.storyboards.length === state.storyboards.length, 'Bridge singleton hydration mismatch');
  return { envelope: { state: stored, version: result.envelope.version }, projectWrites: 0, generatedImages: 0, rootInputAcceptanceNotEstablishedByBoot: true };
}
