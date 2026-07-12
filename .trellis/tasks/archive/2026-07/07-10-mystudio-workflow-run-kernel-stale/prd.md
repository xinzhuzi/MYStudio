# MYStudio workflow run kernel and stale propagation

## Goal

Implement StudioAgentRun persistence, run status ledger, retry/cancel/resume, input fingerprints, output versions, and stale propagation.

## Requirements

- Persist real workflow runs using the existing `StudioAgentRun` type or a compatible migration of it.
- Track `runId`, stage key, status, input fingerprint, output refs, error reason, retry count, started/finished timestamps, and checkpoint references.
- Add item-level retry, cancel, and resume semantics that can be used by script, director plan, storyboard table, storyboard image, TTS, and workbench tasks.
- Add input fingerprint and output version metadata so upstream changes mark downstream storyboards, assets, audio, video candidates, and final exports stale.
- Update parity reports to read real run/writeback evidence instead of inferring execution only from existing output.
- Preserve project-scoped storage under `_p/{projectId}` and keep old project data loadable.

## Acceptance Criteria

- [x] A persisted run ledger exists in the project workflow store or an explicitly scoped companion store.
- [x] Re-running director plan or storyboard table creates observable run records and writeback evidence.
- [x] Changing upstream script/director/storyboard data marks dependent media/video outputs stale without deleting user files.
- [x] Retry/cancel/resume behavior is covered by focused unit tests.
- [x] `workflow-parity-report` fails when a node has output but no real run/writeback evidence.
- [x] Typecheck and relevant studio store/report tests pass.

## 2026-07-10 Validation

- Added persisted `agentRuns` to the project-scoped `studio-workflow-store`.
- Extended `StudioAgentRun` with status, input fingerprint, output refs, retry, checkpoint, and finish evidence.
- Added optional stale/source fingerprint/output version metadata to storyboards, production tracks, and video candidates.
- Connected `productionAgent:directorPlanAgent` and `productionAgent:storyboardTableAgent` call sites to run start/success/failure records.
- Updated `workflow-parity-report` to require successful run evidence when outputs exist.
- Updated workflow smoke seed data to include run evidence so seeded smoke does not masquerade as real execution.
- Ran `cd apps && npm test -- frontend/stores/studio-store.test.ts frontend/lib/studio/workflow-parity-report.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx frontend/lib/studio/workflow-smoke-bridge.test.ts`: passed, 4 files, 47 tests.
- Ran `cd apps && npm run typecheck`: passed.
- Not run: lint, full test suite, packaged smoke, visible smoke, real Daojie runner, or real media generation.

## Notes

- Complex task. Add `design.md` and `implement.md` before starting.
