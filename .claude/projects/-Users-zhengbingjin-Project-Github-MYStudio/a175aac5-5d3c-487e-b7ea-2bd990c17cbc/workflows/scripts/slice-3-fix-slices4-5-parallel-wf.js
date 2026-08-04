export const meta = {
  name: 'slice-3-fix-slices4-5-parallel',
  description: 'Fix Phase 1 compilation errors, then launch UI and Dialog development in parallel',
  phases: [
    { title: 'Fix Inventory Service Errors', detail: 'Resolve all TS errors' },
    { title: 'Verify Compilation', detail: 'npm run typecheck' },
    { title: 'Slice 4 - UI Components', detail: 'Parallel: ArtifactCenter, Tree, Table, DetailPanel' },
    { title: 'Slice 5 - Delete Dialog', detail: 'Parallel: Deletion plan generation + dialog UI' },
  ],
};

// PHASE 1: Fix all TypeScript errors in inventory service
phase('Fix Inventory Service Errors');

await agent(`Fix ALL TypeScript errors in these files:

1. apps/frontend/electron/artifacts/artifact-inventory-service.ts
   
   Key issues to fix:
   a) Lines 45,51 - Wrong type imports (ScriptStoreState, StudioStoreState don't exist)
      Replace with actual used types from studio-store.ts
   
   b) Line 51 - Function name mismatch
      Change projectStoryboardItems() → projectStoryboards()
   
   c) Line 54 - Function name mismatch  
      Change projectSceneVoiceLines() → projectTTSVoiceLines()
   
   d) Lines 169, 321, 578 - 'backup' not assignable to ArtifactStage
      Check if backup is valid stage; remove or use 'media-library' instead
   
   e) Lines 172, 324, 582 - 'unknown' not assignable to ArtifactKind
      Use a valid ArtifactKind union value like 'media-file'
   
   f) Lines 201, 207, 209 - MixedBackupArtifact missing kind property
      Add kind?: ArtifactKind to the interface OR remove references
   
   g) Lines 371, 376, 389 - RemotionRenderJobV1 missing id, chapterId properties
      Check Remotion type definitions and use correct property names

2. apps/frontend/electron/ipc/files/artifact-management-ipc.ts
   
   Key issues to fix:
   a) Lines 22,23,24 - Invalid import paths
      ../../../services/... → ../../artifacts/...
      Remove error-utils import if doesn't exist
   
   b) Line 81 - Error type is 'unknown'
      Use proper type guard: error instanceof Error ? error.message : String(error)
   
Run typecheck after fixes and ensure NO errors remain.
`, {
  label: 'fix-all-ts-errors',
  effort: 'high',
});

log('✅ Phase 1 errors fixed');

// PHASE 2: Verify compilation passes
phase('Verify Compilation');

const typecheckResult = await agent(`cd /Users/zhengbingjin/Project/Github/MYStudio/apps && npm run typecheck 2>&1 | tee /tmp/slice3-verify.log && cat /tmp/slice3-verify.log`, {
  label: 'verify-compilation',
  effort: 'medium',
});

if (!typecheckResult || typecheckResult.includes('error TS')) {
  throw new Error('Typecheck still failing:\n' + typecheckResult);
}

log('✅ All type errors resolved');

// PHASE 3A: Slice 4 - UI Components Development (PARALLEL WITH SLICE 5)
phase('Slice 4 - UI Components');

await agent(`Develop FULL artifact center UI components for Slice 4:

FILES TO CREATE:

1. apps/frontend/components/panels/media/ArtifactCenter.tsx (NEW)
   - Tab switching: 工作流产物 (default) vs 媒体库 (existing)
   - Layout: Left navigation tree + Center table + Right detail panel
   - State: Subscribe to artifact-store using Zustand context

2. apps/frontend/components/panels/media/ArtifactTree.tsx (NEW)
   - Display: Project → Chapter → Stage hierarchy with counts
   - Interactions: Click chapter to filter artifacts table
   - Visual: Radix primitives collapsible tree with Lucide icons

3. apps/frontend/components/panels/media/ArtifactTable.tsx (NEW)
   - Dense display: Sortable columns (name, stage, size, update time)
   - Selection: Single/multi-select via checkbox or Shift-click range
   - Filtering: Filter by stage, state (active/blocked/orphaned)

4. apps/frontend/components/panels/media/ArtifactDetailPanel.tsx (NEW)
   - Full metadata: ID, projectId, chapterId, stage, kind, state
   - Physical refs: List all file paths with preview support
   - Dependencies: Upstream IDs + Downstream IDs display
   - Metadata editor: Inline edit for name, tags, notes (with validation)

CRITICAL REQUIREMENTS:
- All components MUST accept props (pure functions)
- Do NOT call IPC directly inside components
- Use hooks for side effects: useArtifactScan(), useMetadataUpdate()
- Mock data support: Props can be injected for testing without real IPC
- Follow existing media-panel styles (dark theme, Radix UI primitives)

Testing note: All component tests must pass later with fixture data.
`, {
  label: 'develop-ui-components',
  effort: 'high',
});

log('✅ Phase 3A Complete: UI components created');

// PHASE 3B: Slice 5 - Delete Dialog Development (PARALLEL WITH SLICE 4)
phase('Slice 5 - Delete Dialog');

await agent(`Develop deletion planning and dialog for Slice 5:

FILES TO MODIFY/CREATE:

1. apps/frontend/lib/artifacts/artifact-dependency-graph.ts (EXTEND EXISTING)
   
   ADD NEW FUNCTION: buildDeletionPlan()
   
   Purpose: Compute immutable deletion plan for a chapter or batch of artifacts
   
   Inputs:
   - allArtifacts: ArtifactRecord[] (from inventory)
   - selectedArtifactIds: string[] (user selection OR whole chapter)
   - chapterId: string (optional, if scope is chapter-wide)
   
   Returns: DeletionPlan object with 4 groups (delete/migrate/retain/blocker)
   
   Plan generation logic:
   - Group artifacts into 4 categories with count and byte totals
   - Generate deterministic fingerprint over normalized data
   - Identify backup impact: which backup files will be deleted/rewritten
   - Set confirmationRequired value (chapter title/ID user must match)

2. apps/frontend/components/panels/media/ArtifactDeleteDialog.tsx (NEW)
   
   Layout: Non-nested full-width sections
   
   Sections:
   a. Warning banner: "删除后无法恢复"
   b. Delete group: Items to be deleted (by stage/kind)
   c. Migrate group: Protected assets being copied to stable location
   d. Retain group: Items preserved (shared references with explanation)
   e. Blocker group: Items blocking deletion with reasons
   f. Backup impact section: Which backups affected
   
   Confirmation controls:
   - Chapter scope: Input field requiring exact match of chapter title/ID
     Disabled until input matches exactly
   - Artifact scope: Count-based confirmation for item selection
   
   Cancel behavior:
   - Close dialog → zero IPC calls made
   - Keyboard: Escape closes (cancel), Enter only enabled when confirmed

3. apps/frontend/electron/ipc/files/artifact-management-ipc.ts (EXTEND EXISTING)
   
   ADD NEW HANDLER: artifact-plan-deletion
   
   Payload: PlanRequest (projectId, chapterId, scope, artifactIds)
   Returns: PlanResult (typed success/error response)
   
   IMPORTANT: Register handler but DO NOT enable execute handlers yet
   Only read-only scan and plan generation available now

All component tests must cover:
- Empty/loading/error states
- Same-chapter selection enforcement
- Cancel-zero-write guarantee
`, {
  label: 'develop-delete-dialog',
  effort: 'high',
});

log('✅ Phase 3B Complete: Delete dialog created');

return {
  phase: 'Phases 1+2 Complete',
  files_created: [
    'apps/frontend/components/panels/media/ArtifactCenter.tsx',
    'apps/frontend/components/panels/media/ArtifactTree.tsx',
    'apps/frontend/components/panels/media/ArtifactTable.tsx',
    'apps/frontend/components/panels/media/ArtifactDetailPanel.tsx',
    'apps/frontend/components/panels/media/ArtifactDeleteDialog.tsx',
  ],
  files_modified: [
    'apps/frontend/lib/artifacts/artifact-dependency-graph.ts',
    'apps/frontend/electron/ipc/files/artifact-management-ipc.ts',
  ],
  next_phase: 'Ready for integration test suite + Slice 6-9 implementation',
  parallel_execution_success: true,
};
