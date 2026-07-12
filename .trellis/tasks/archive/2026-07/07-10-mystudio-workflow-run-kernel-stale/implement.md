# Implementation Plan

## Checklist

1. Extend types.
   - [x] Expand `StudioAgentRun` status and evidence fields.
   - [x] Add optional stale/version/run metadata to storyboard, tracks, and candidates.

2. Add store run actions.
   - [x] Persist `agentRuns`.
   - [x] Add `startAgentRun`, `finishAgentRun`, `failAgentRun`, `cancelAgentRun`, and `retryAgentRun`.
   - [x] Migrate old store state with `agentRuns: []`.

3. Add stale propagation.
   - [x] Mark storyboard media stale when storyboard source fields change or rows are replaced.
   - [x] Mark tracks and linked video candidates stale when rebuilt track fingerprint changes.
   - [x] Clear stale metadata when fresh media/candidates are written.

4. Connect first production call sites.
   - [x] Director plan creates run records and writeback evidence.
   - [x] Storyboard table creates run records and writeback evidence.

5. Update parity report.
   - [x] Accept `agentRuns`.
   - [x] Require successful run/writeback evidence when outputs exist.
   - [x] Add issues for output-without-run evidence.

6. Tests.
   - [x] `studio-store.test.ts` covers run lifecycle and stale propagation.
   - [x] `workflow-parity-report.test.ts` covers run evidence requirements.
   - [x] Run focused tests.

## Validation Commands

- `cd apps && npm test -- frontend/stores/studio-store.test.ts frontend/lib/studio/workflow-parity-report.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx`
- `cd apps && npm run typecheck`

## Boundaries

- No git/worktree commands.
- No task archive or session record without explicit user approval.
- No real media generation unless explicitly requested.

## Validation Evidence

2026-07-10:

- `cd apps && npm test -- frontend/stores/studio-store.test.ts frontend/lib/studio/workflow-parity-report.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx frontend/lib/studio/workflow-smoke-bridge.test.ts` passed: 4 files, 47 tests.
- `cd apps && npm run typecheck` passed.
- No git/worktree command was run.
