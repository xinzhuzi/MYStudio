export const meta = {
  name: 'fix-slice2-implementation-bugs',
  description: '修复 Slice 2 的剩余实现 Bug (51→62 tests)',
  phases: [
    { title: 'Projection IDs', detail: 'buildArtifactId uniqueness' },
    { title: 'Metadata Clamp', detail: 'notes max length validation' },
    { title: 'Dependency Graph', detail: 'validateDeletionPlan + orphan detection' },
  ],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    bugsFixed: { type: 'array', items: { type: 'string' } },
    testCountAfterFix: { type: 'number', description: 'Expected passing tests after fix' },
    done: { type: 'boolean' },
  },
  required: ['file', 'bugsFixed', 'testCountAfterFix', 'done'],
}

// ── Phase 1: Fix artifact-projection.ts buildArtifactId ──
log('▶ Phase 1: Fix buildArtifactId duplicate ID generation')

const projFixPrompt = `You are a TypeScript bug fixer. Fix apps/frontend/lib/artifacts/artifact-projection.ts.

Current failures:
- buildArtifactId generates duplicate IDs for cross-stage uniqueness
- Tests at lines 11, 16, 21 fail

The buildArtifactId function should be:
export function buildArtifactId(stage: ArtifactStage, kind: ArtifactKind, id: string): string {
  return \`\${stage}:\${kind}:\${id}\`;
}

Task:
1. Add this simple unique ID builder function
2. Ensure all projection functions call it correctly
3. Verify cross-stage uniqueness (same underlying ID but different stages should produce different artifact IDs)

Report with FIX_SCHEMA.`

const projResult = await agent(projFixPrompt, {
  label: 'fix:projection-ids',
  phase: 'Projection IDs',
  schema: FIX_SCHEMA,
})

log(`Projection IDs fixed: ${projResult.done ? '✓' : '✗'} - Expected: ${projResult.testCountAfterFix} tests`)

// ── Phase 2: Fix artifact-metadata.ts clamp notes ──
log('▶ Phase 2: Fix metadata notes clamp logic')

const metadataFixPrompt = `You are a TypeScript bug fixer. Fix apps/frontend/lib/artifacts/artifact-metadata.ts.

Current failure:
- Line 67: validates notes exceeding max length fails
- Issue: validateMetadataOverlay rejects notes > MAX_NOTES_LENGTH (2000)
- The clampNotes helper returns undefined when input is already within bounds

Task:
1. Check the clampNotes logic at line 68
2. Ensure it properly handles null/undefined inputs
3. Make sure validateMetadataOverlay throws proper error when notes exceed limit
4. Return value should be 'string | undefined' not 'string | null'

Report with FIX_SCHEMA.`

const metadataResult = await agent(metadataFixPrompt, {
  label: 'fix:metadata-clamp',
  phase: 'Metadata Clamp',
  schema: FIX_SCHEMA,
})

log(`Metadata clamp fixed: ${metadataResult.done ? '✓' : '✗'} - Expected: ${metadataResult.testCountAfterFix} tests`)

// ── Phase 3: Fix dependency-graph.ts implementation bugs ──
log('▶ Phase 3: Fix dependency graph implementation bugs')

const graphFixPrompt = `You are a TypeScript bug fixer. Fix apps/frontend/lib/artifacts/artifact-dependency-graph.ts.

Current failures (7 tests failing):
1. Lines 274, 44: Cannot read properties of undefined (reading 'map') in validateDeletionPlan
   - Problem: allArtifacts parameter is undefined in some test calls
   - Need to handle undefined/null gracefully or ensure tests pass correct args

2. detectOrphanedReferences test (line 168): expects orphans.some(o => o.orphans === child.id)
   - Problem: orphans field is string[] not string
   - Fix: change comparison to o.orphans.includes(child.id)

3. computeDeletionOrder topological sort (line 127): children not deleted before parents
   - Problem: order array might be empty or wrong direction
   - Need to verify topological sort produces children-first ordering

4. Upstream/downstream cascade tests failing
   - Problem: deleteExclusiveDownstream policy not cascading correctly
   - Need to trace downstream dependencies recursively

Task:
1. Add null/undefined guards to validateDeletionPlan:
   if (!allArtifacts || !Array.isArray(allArtifacts)) return { ... };

2. Fix detectOrphanedReferences to use .includes() for array comparison

3. Verify computeDeletionOrder topological sort direction:
   - Children should come BEFORE parents in deletion order
   - Check reverse order if needed

4. Trace deletePolicy='delete-exclusive-downstream' to find all dependent artifacts

Report with FIX_SCHEMA and list which specific implementations were changed.`

const graphResult = await agent(graphFixPrompt, {
  label: 'fix:graph-bugs',
  phase: 'Dependency Graph',
  schema: FIX_SCHEMA,
})

log(`Graph bugs fixed: ${graphResult.done ? '✓' : '✗'} - Expected: ${graphResult.testCountAfterFix} tests`)

// ── Final verification ──
log('\n=== Running Tests After Fixes ===')

await agent(`Run npm test -- frontend/lib/artifacts/*.test.ts and report final count`, {
  label: 'verify:final-tests',
  phase: 'Verify',
  schema: {
    type: 'object',
    properties: {
      testFilesPassed: { type: 'number' },
      testFilesFailed: { type: 'number' },
      testsPassed: { type: 'number' },
      testsFailed: { type: 'number' },
      allGreen: { type: 'boolean' },
      summary: { type: 'string' },
    },
    required: ['testFilesPassed', 'testFilesFailed', 'testsPassed', 'testsFailed', 'allGreen', 'summary'],
  },
})

return {
  phase1_projection: projResult,
  phase2_metadata: metadataResult,
  phase3_graph: graphResult,
}
