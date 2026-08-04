export const meta = {
  name: 'slice-3-phase1-core-infrastructure',
  description: 'Create artifact-inventory-service and register IPC contracts (isolated from Slices 4-5)',
  phases: [
    { title: 'Inventory Service', detail: 'Build read-only scanner for _p/{projectId}/' },
    { title: 'IPC Registration', detail: 'Register scan handlers in preload.ts' },
    { title: 'Store Creation', detail: 'Create artifact-store.ts with scan state' },
  ],
};

// Phase 1: Build the core inventory scanning logic
phase('Inventory Service');

await agent(`
Create NEW FILE: apps/frontend/electron/artifacts/artifact-inventory-service.ts

Core responsibilities:
1. Scan project root directory (_p/{projectId}/) using resolveProjectRootPath(dataRoot, projectId)
2. Read all persisted JSON files: studio-store.json, script.json, editing.json, etc.
3. Decode each file using backup decoder registry (findBackupDecoder -> decode)
4. For each decoded record, map to ArtifactRecord via projector functions
5. Calculate physical file fingerprints (path, bytes, mtime, SHA-256)
6. Detect running jobs as blockers (Remotion queue, TTS sidecar, etc.)
7. Return typed InventoryResult with artifacts, discrepancies, and blockers

Key implementation notes:
- Use withFileStorageMutationLocks for thread-safe JSON reads
- Do NOT delete or modify any files (read-only mode)
- If no decoder found for a format, mark as explicit 'unknown' artifact type (don't crash)
- For Remotion jobs: check REMOTION_TERMINAL_STATUSES (succeeded/failed/canceled)
- Legacy ownership detection: episode-1 mapping, numeric sceneId resolution

Return structure:
{
  success: true,
  data: {
    projectId,
    chapterId?: string,      // Optional filter
    artifacts: ArtifactRecord[], // Full inventory with stages/kinds
    discrepancies: Discrepancy[], // live-vs-disk mismatches
    blockers: RunningJob[]      // Active generation/TTS/Remotion tasks
  }
}

Do NOT import this into UI code yet - keep it isolated to electron layer.
`, {
  label: 'implement-inventory-service',
  effort: 'high',
});

log('✅ Phase 1.1 Complete: artifact-inventory-service.ts created');

// Phase 2: Register IPC handlers (only scan method, not plan/execute)
phase('IPC Registration');

await agent(`
Create NEW FILE: apps/frontend/electron/ipc/files/artifact-management-ipc.ts

This file ONLY handles inventory requests initially. Plan/execute handlers come later.

Required IPC handlers:
1. HANDLER: artifact-inventory-scan
   Payload: { projectId: string; chapterId?: string }
   Returns: InventoryResult (from artifact-inventory-service.scan())
   
2. HANDLER: artifact-get-project-artifacts (alias for convenience)
   Same as above but without filtering by chapter if needed

IMPORTANT: DO NOT add planDeletion or execute handlers yet! 
Those belong in Slice 5 when we're ready for deletion planning.

Implementation pattern:
const ipcMain = require('electron').ipcMain;

ipcMain.handle('artifact-inventory-scan', async (event, payload) => {
  const { getDataDir } = event.sender.frame.process.binding('node_internals');
  const result = await artifactInventoryService.scan(payload.projectId, payload.chapterId);
  return result; // Typed InventoryResult
});

Add comprehensive comments explaining:
- Why only scan is exposed now (deletion gated behind future slices)
- How UI should call this via preload bridge (window.electron.artifactInventory?.scan())
- Error handling patterns (typedExecuteError codes)
`, {
  label: 'register-scan-ipc-handlers',
  effort: 'medium',
});

log('✅ Phase 1.2 Complete: IPC handlers registered');

// Phase 3: Create renderer-side store for artifact management
phase('Store Creation');

await agent(`
Create NEW FILE: apps/frontend/stores/artifacts/artifact-store.ts

Use Zustand pattern (existing codebase standard):
1. State fields:
   - loading: boolean (is scan in progress?)
   - error: string | null (last error message)
   - artifacts: ArtifactRecord[] (cached inventory)
   - selectedChapterId: string | null (current chapter filter)
   - selectedArtifactIds: Set<string> (for multi-selection)
   - lastScanTime: number (timestamp of last successful scan)

2. Actions:
   - startScan(): void - sets loading=true
   - finishScan(artifacts: ArtifactRecord[]): void - updates cache
   - setError(err: string): void
   - setChapterFilter(chapterId?: string): void
   - toggleArtifactSelection(id: string): void
   - clearSelection(): void
   - reset(): void - clears all state

3. Selectors:
   - getFilteredArtifacts(): ArtifactRecord[] (by current chapter filter)
   - getSelectedArtifacts(): ArtifactRecord[] (selected subset)
   - hasActiveJobs(): boolean (check for RunningJob blockers)

CRITICAL DESIGN NOTES:
- Do NOT call IPC directly inside store actions
- Instead, expose useArtifactScan() hook that handles IPC calls
- Store only manages local state and caching logic
- Follow existing pattern from media-panel-store.ts
`, {
  label: 'create-artifact-store',
  effort: 'medium',
});

log('✅ Phase 3 Complete: artifact-store.ts created');

// Verify all Phase 1 files exist and compile
const filesCreated = [
  'apps/frontend/electron/artifacts/artifact-inventory-service.ts',
  'apps/frontend/electron/ipc/files/artifact-management-ipc.ts',
  'apps/frontend/stores/artifacts/artifact-store.ts',
];

await agent(`Verify all Phase 1 files compile correctly:

\${filesCreated.join('\n')}

Run: cd /Users/zhengbingjin/Project/Github/MYStudio/apps && npm run typecheck 2>&1 | tee /tmp/slice3-phase1.log && cat /tmp/slice3-phase1.log
`, {
  label: 'verify-compilation',
  effort: 'low',
});

return {
  phase: 'Phase 1 Complete',
  files_created: filesCreated,
  next_phase: 'Ready to launch Parallel Phase 2 (Slices 4 & 5)',
  recommendation: 'Unleash two subagents: one for Slice 4 UI components, one for Slice 5 delete dialog',
};
