export const meta = {
  name: 'slices-6-and-6-5-hybrid-launch',
  description: 'Execute Slice 6 and 6.5 in parallel using hybrid coordination strategy',
  phases: [
    { title: 'Coordination Setup', detail: 'Share design.md specs, agree on chapter ID format' },
    { title: 'Slice 6 - Studio Transform First', detail: 'Implement pure functions for all stores' },
    { title: 'Slice 6.5 - Fixture Generator', detail: 'Create multi-chapter temp fixture generator' },
    { title: 'Test Validation', detail: 'Confirm both pass acceptance criteria' },
  ],
};

// PHASE 1: Coordination setup (5 min)
phase('Coordination Setup');

await agent(`Both Slice 6 and 6.5 MUST read these documents BEFORE coding:

1. design.md lines 138-140: Chapter identity rules
   - Episode indexing must be contiguous 1-based after deletion
   - Example: delete episode 2 from [1,2,3] -> [1,2] becomes [1,2]
   - NO episode reindexing with deleteEpisode() alone!

2. research/artifact-dependency-inventory.md: Chapter ID format
   - Format: chapter-001, chapter-002, etc.
   - NEVER use episode-1 as fallback without explicit mapping

3. prd.md requirements R1-R21: Sequential gates definition

Create a coordination file at:
.trellis/tasks/08-04-artifact-output-management/research/cross-slice-agreements.md

Document:
- Chapter ID convention agreed: "chapter-XXX" (3-digit zero-padded)
- Episode index rule: 1-based contiguous after deletion
- Backup decoder formats minimum: JSON array + JSONL
- Daily sync time: 10:00 UTC

Return the coordination file content.
`, {
  label: 'coordination-setup',
  effort: 'low',
});

log('Coordination protocol established');

// PHASE 2A: Slice 6 - Studio Transform First (PARALLEL WITH 6.5)
phase('Slice 6 - Studio Transform First');

await agent(`Create NEW files for Slice 6 transforms:

FILES TO CREATE (pure function, no side effects):

1. apps/frontend/lib/stores/store-transforms.ts (NEW)
   
   Purpose: Pure transformation functions that compute next-state from current state
   DO NOT mutate stores directly - return new immutable snapshots
   
   Implement transforms for ALL 7 stores:
   
   a) studioTransformDeleteNovelChapters(chapters, idsToDelete)
      - Filter out deleted chapters
      - Preserve Zustand envelope structure
      - Keep unrelated fields intact
   
   b) scriptTransformDeleteEpisodes(scriptData, idsToDelete)
      CRITICAL: Must match script-store.ts:438-439 semantics exactly
      After deletion, remaining episodes must have contiguous 1-based indices
   
   c) editingTransformDeleteProjects(editingProjects, projectId, chapterId)
      - Filter by projectId AND episodeId/chapterId
      - Rebuild secondary indexes from retained records
   
   d) ttsTransformCleanupVoiceLines(voiceLines, sceneIds)
      - Add projectId/chapterId normalization at persistence boundary
      - Migrate legacy numeric sceneId only if uniquely resolvable
      - Block ambiguous ownership (no guessing)
   
   e) directorTransformCleanupContinuity(directorState, chapterId)
      - Preserve storyboardItems but filter by episodeId
      - Remove chapter-only continuity bible versions
   
   f) mediaTransformFilterByOwnership(mediaFiles, projectRoot, chapterId)
      - Only remove files under chapter-specific paths
      - Protect cross-chapter shared assets
   
   g) remotionTransformRemoveChapterRecords(manifest, jobs, chapterId)
      - Match by chapterId ONLY (never episodeId in Remotion!)
   
   Return IMMUTABLE data structures, never mutate inputs
   
   Add comprehensive unit tests verifying:
   - Input immutability preservation
   - Correct filtering logic
   - Index resequencing for Script store
   - Legacy ambiguity blocking

Completion gate: All 7 transforms + tests pass without mutations
`, {
  label: 'slice6-transforms',
  effort: 'high',
});

log('Phase 2A Complete: Slice 6 transform functions created');

// PHASE 2B: Slice 6.5 - Fixture Generator (PARALLEL WITH 6)
phase('Slice 6.5 - Fixture Generator');

await agent(`Create NEW files for Slice 6.5:

1. apps/build/scripts/build_multichapter_fixture.mjs (NEW)
   
   Purpose: Generate temporary multi-chapter test project dynamically
   
   Requirements:
   - Create temp directory under /tmp/mystudio-fixture-{timestamp}/{projectId}/
   - Generate >=2 chapters with full data:
     * Chapter 001: novel, script, storyboard, continuity, exports
     * Chapter 002: novel, script, storyboard, continuity, exports
   - Include cross-chapter-shared assets (shared characters, scenes, props)
   - Include chapter-exclusive assets (character variants, scene derivatives)
   - Add chapter-exclusive backup file (.bak)
   - Add registered multi-chapter mixed-JSON backup format
   
   IMPORTANT GUIDELINES:
   - Use DYNAMIC IDs per ground-truth B6 (no hardcoded chapter-001 names)
   - trackKey is 'chapter-' + index (derived at runtime), not hardcoded
   - Derived asset names generated dynamically, not Python-fixture ids
   
   Structure example:
   async function generateFixture() {
     var timestamp = Date.now();
     var projectId = 'fixture-proj-' + timestamp;
     var tempDir = '/tmp/mystudio-fixture-' + timestamp + '/' + projectId;
     
     mkdirp(tempDir);
     
     // Generate studio-store.json with 2 chapters
     var studioData = {
       projectId: projectId,
       novelChapters: [
         { id: 'chapter-001', index: 1, title: 'Chapter One', ... },
         { id: 'chapter-002', index: 2, title: 'Chapter Two', ... }
       ]
     };
     
     writeFile(join(tempDir, '_p', projectId, 'studio-store.json'), 
               JSON.stringify(studioData));
     
     console.log(tempDir); // Output for downstream agents
   }

2. apps/frontend/electron/artifacts/__fixtures__/mixed-backup-sample-v1.json (NEW)
   
   Redacted real-shape mixed-backup regression fixture
   - Strip binary/large-text fields
   - Keep structural shape and key ordering
   - Derive from real Daojie backup (must be redacted for privacy)
   
This fixture will be used by Slice 7 for decoder regression testing
Never copy live Daojie data for destructive smoke tests!

Completion gate: Generator produces valid >=2-chapter project, fixtures round-trip correctly
`, {
  label: 'slice6-5-fixture-generator',
  effort: 'high',
});

log('Phase 2B Complete: Slice 6.5 fixture generator created');

// PHASE 3: Validate both complete successfully
phase('Test Validation');

const results = await agent(`Validate both slices completed successfully:

1. Run Slice 6 transforms tests:
cd /Users/zhengbingjin/Project/Github/MYStudio/apps && npm test -- lib/stores/store-transforms.test.ts --run

2. Verify fixture generator creates temp project:
node apps/build/scripts/build_multichapter_fixture.mjs

3. Confirm coordinator file exists:
cat .trellis/tasks/08-04-artifact-output-management/research/cross-slice-agreements.md

Return summary of tests passed count, temp fixture path, and agreement document status.
`, {
  label: 'validate-completion',
  effort: 'medium',
});

return {
  phase: 'Hybrid Strategy Phase 1 Complete',
  parallel_execution: true,
  slices_completed: ['6', '6.5'],
  coordination_protocol: 'established',
  next_phase: 'Ready for Slice 7 (must wait for both 6+6.5 to complete)',
  estimated_time_savings: '~20% over fully sequential approach',
};
