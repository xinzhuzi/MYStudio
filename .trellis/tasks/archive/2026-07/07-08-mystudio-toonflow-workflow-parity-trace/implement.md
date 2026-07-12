# Implementation Plan

## Checklist

1. Planning and trace artifacts.
   - [x] Finish `prd.md`, `design.md`, and `implement.md`.
   - [x] Add `docs/融合/MYStudio_Toonflow_工作流全链路追溯矩阵.md`.
   - [x] Add the 2026-07-10 current-state review and six-target execution plan to the trace matrix.
   - [x] Start the Trellis task after artifacts exist.

2. Type and projection contract.
   - [x] Add optional `StoryboardSourceEvidence` and `StoryboardOrderedReference` types.
   - [x] Add optional fields to `StoryboardItem`.
   - [x] Preserve those fields in `buildStudioFlowData()`.
   - [x] Add regression assertions in `studio-flow-data.test.ts`.

3. Workflow parity report.
   - [x] Create `apps/frontend/lib/studio/workflow-parity-report.ts`.
   - [x] Keep it pure and typed; no storage writes and no provider calls.
   - [x] Cover nodes, storyboards, references, skills, images, audio, video, and evidence boundary.
   - [x] Add `workflow-parity-report.test.ts`.

4. Validation.
   - [x] Run focused tests:
     `cd apps && npm test -- frontend/lib/studio/studio-flow-data.test.ts frontend/lib/studio/workflow-parity-report.test.ts frontend/components/panels/studio/workflow-node-model.test.ts`
   - [x] Run `cd apps && npm run typecheck`.
   - [x] Run `cd apps && npm run lint`.

## Remaining Target Plan

1. Current-state convergence.
   - [x] Reuse this parent task instead of creating a duplicate parity-trace task.
   - [x] Update the trace matrix with current source evidence and explicit status labels.
   - [ ] Update `docs/融合/README.md` to state that the trace matrix is the current gap-control entry.
   - [ ] Review active Trellis child/completed task status before any archive/session action.

2. Workflow run kernel.
   - [ ] Persist `StudioAgentRun` in project-scoped Studio state.
   - [ ] Add stage status machine: queued, running, success, failed, cancelled, stale.
   - [ ] Add retry, cancel, resume, checkpoint, input fingerprint, and output refs.
   - [ ] Change `buildWorkflowParityReport()` to prefer run-ledger evidence over output-exists inference.

3. Toolized Agent and supervision loop.
   - [ ] Add a typed workflow tool registry.
   - [ ] Route `productionAgent:decisionAgent` through tools instead of direct arbitrary writes.
   - [ ] Connect `productionAgent:supervisionAgent` as a review gate.
   - [ ] Record plan, execution, review, repair, and approval evidence per stage.

4. Event graph and project memory.
   - [ ] Add project-level event nodes and chapter links.
   - [ ] Add ScriptAgent/ProductionAgent event lookup tools.
   - [ ] Add project-scoped short-term memory, summaries, and optional semantic retrieval.
   - [ ] Add cleanup/disable controls and query limits.

5. Asset/storyboard/audio/video taskization.
   - [ ] Move image, derived asset, TTS, and model video operations into the run kernel.
   - [ ] Support per-item progress and failure retry.
   - [ ] Wire `enableVisualContinuity`, `enableResumeGeneration`, and `enableContentModeration` into production execution.
   - [ ] Add video prompt check, polling, candidate writeback, and final export evidence.

6. Toonflow fixture and golden validation.
   - [ ] Build a read-only Toonflow DB/OSS fixture importer.
   - [ ] Map `o_storyboard`, `o_assets2Storyboard`, `o_assets.imageId`, and `o_image.filePath`.
   - [ ] Add 43-frame structure and golden image difference report.
   - [ ] Validate in layers: unit, typecheck, lint, full test, packaged smoke, visible smoke, real Daojie runner, and only then real media generation when explicitly authorized.

## Risk Points

- Do not add mandatory fields to old project data.
- Do not make the report depend on Toonflow DB files; those are evidence inputs for the ledger only.
- Do not touch Electron packaging unless UI/runtime behavior is changed.
- Do not let seeded smoke evidence be reported as real media generation.

## Rollback Points

Revert only files touched by this task if needed:

- `.trellis/tasks/07-08-mystudio-toonflow-workflow-parity-trace/*`
- `docs/融合/MYStudio_Toonflow_工作流全链路追溯矩阵.md`
- `apps/frontend/types/studio.ts`
- `apps/frontend/lib/studio/studio-flow-data.ts`
- `apps/frontend/lib/studio/studio-flow-data.test.ts`
- `apps/frontend/lib/studio/workflow-parity-report.ts`
- `apps/frontend/lib/studio/workflow-parity-report.test.ts`

No git reset, checkout, clean, stash, commit, branch, or worktree command is allowed.

## Validation Evidence

2026-07-08 current-disk validation:

- `python3 ./.trellis/scripts/task.py validate 07-08-mystudio-toonflow-workflow-parity-trace` passed.
- `node --check apps/build/run-visible-workflow-smoke.mjs` passed.
- `cd apps && npm test -- frontend/config/build-scripts.test.ts frontend/lib/studio/studio-flow-data.test.ts frontend/lib/studio/workflow-parity-report.test.ts frontend/lib/studio/workflow-smoke-bridge.test.ts frontend/components/panels/studio/workflow-node-model.test.ts frontend/components/panels/studio/workflow-node-previews.test.tsx` passed: 6 files, 75 tests.
- `cd apps && npm run typecheck` passed.
- `cd apps && npm run lint` passed.
- `cd apps && npm test` passed: 104 files, 592 tests.
- `cd apps && npm run smoke:desktop` passed. Report: `apps/output/automation/desktop-smoke-report.json`; `workflowParityNoErrors=true`, `workflowParityHasOrderedReferences=true`, `workflowParityHasSourceEvidence=true`. The remaining `evidence.seededOnly` warning is expected for seeded desktop smoke and is not used as real workflow proof.
- `cd apps && npm run smoke:workflow:run` passed. Report: `apps/output/automation/visible-workflow-smoke-report.json`; `ok=true`, `source=isolated-smoke-project`, `progress=100`, `failedStages=[]`, `runtimeProblems=[]`.
- First `cd apps && npm run smoke:workflow:run:daojie` exposed a real project-data gap: `storyboard-flow-chapter-001-003` had reference nodes but no generated node or edges, so `storyboardImageWorkflowsReady=42/43`.
- Repaired the real project data only under the user project path by adding the missing generated node and edges for `storyboard-flow-chapter-001-003`. Backup: `/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0/studio-workflow-store.json.bak-20260708-storyboard-003-workflow`.
- Disk rescan after repair: `storyboardImageWorkflows=43`, `storyboardImageWorkflowsReady=43`, `bad=[]`.
- Second `cd apps && npm run smoke:workflow:run:daojie` passed. Report: `apps/output/automation/visible-workflow-daojie-report.json`; `ok=true`, `source=real-daojie-chapter001-clone`, `progress=100`, `failedStages=[]`, `runtimeProblems=[]`, `storyboards=43`, `storyboardsWithMediaPath=43`, `storyboardsWithWorkflow=43`, `storyboardImageWorkflowsReady=43`, `derivedImageWorkflowsReady=3/3`, `videoCandidates=5`.

Not run in this task:

- `cd apps && npm run video:daojie:chapter001`; this is the complete real media generation chain and was intentionally not run without a new explicit request.
- `cd apps && npm run build:mac:install`; no install was requested in this turn.
- Any git/worktree command; project instructions forbid it without explicit user request.

2026-07-10 planning update:

- Updated `docs/融合/MYStudio_Toonflow_工作流全链路追溯矩阵.md` with a current-state review and six-target plan.
- Updated this task's `prd.md`, `design.md`, and `implement.md` to make the next execution target the workflow run kernel.
- No code, package build, smoke, real media generation, git, or worktree action was run in this planning update.

## 2026-07-10 Continuation Plan

The original parity-report layer is implemented, but the broader Toonflow-to-MYStudio migration is not complete. The six targets above can be materialized as the following Trellis child task names under this parent:

1. `07-10-mystudio-toonflow-current-audit-docs`
   - Scope: refresh the parity matrix from current disk evidence and align Trellis status.
   - Exit: current matrix separates implemented, partial, config-only, missing, and do-not-copy items.

2. `07-10-mystudio-workflow-run-kernel-stale`
   - Scope: persist `StudioAgentRun`-style run records, retry/cancel/resume, fingerprints, output versions, and stale propagation.
   - Exit: parity report reads real run/writeback evidence instead of output-existence inference.

3. `07-10-mystudio-toolized-agents-review-loop`
   - Scope: connect decision, execution, and supervision agents through typed MYStudio tools and review/fix/approval gates.
   - Exit: at least one production stage runs plan -> execute -> review -> repair-or-approve with tests.

4. `07-10-mystudio-event-graph-project-memory`
   - Scope: upgrade chapter event summaries into a project-scoped event graph and controlled memory/retrieval layer.
   - Exit: script and production stages can retrieve scoped context with tested cleanup/privacy controls.

5. `07-10-mystudio-media-taskization`
   - Scope: taskize storyboard images, derived assets, TTS, provider video, and FFmpeg workbench generation.
   - Exit: item-level progress, failure, continue, retry, cancel, and writeback evidence are visible in stores/reports.

6. `07-10-mystudio-toonflow-fixture-final-verification`
   - Scope: add read-only Toonflow fixture mapping, golden structure/image comparison, and layered verification.
   - Exit: final reports distinguish unit/typecheck/smoke/visible/real-media layers and never claim unrun layers.

Execution order should stay conservative: current audit docs -> run kernel/stale propagation -> toolized agent review loop -> event graph/memory -> media taskization -> fixture/final verification. The run kernel is the main blocker for reliable retries, stale downstream marking, and truthful parity reports.
