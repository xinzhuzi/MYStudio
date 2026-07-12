# Implementation Plan

## Phase 1: Model Fix

- Remove the `slice(0, 24)` cap from storyboard tile construction.
- Remove the `slice(0, 12)` and fallback `slice(1, 13)` caps from storyboard table preview row parsing.
- Keep ordering deterministic by storyboard `index` and table row order.

## Phase 2: Preview Contract Tests

- Add a model test that builds 43 storyboards and expects 43 storyboard tiles.
- Add a table parsing/model test that builds a 43-row storyboard table and expects 43 table rows.
- Add a preview render test that renders 43 storyboard tiles and confirms the last tile is present and clickable.

## Phase 3: Real Project Evidence

- Re-run a read-only store probe against the real Daojie project and record the count in the final report.
- Run the real visible Daojie workflow smoke after focused and full tests pass.

## Phase 4: Outer Action Cleanup

- Remove the legacy `generate-storyboard-images` production-node action type and handler.
- Keep storyboard image generation and writeback inside the scoped image workflow detail.
- Add regression coverage proving a legacy outer action id cannot call image generation or write back storyboard media.

## Validation Commands

```bash
cd apps
npm test -- frontend/components/panels/studio/workflow-node-model.test.ts frontend/components/panels/studio/workflow-node-previews.test.tsx frontend/lib/studio/workflow-parity-report.test.ts frontend/lib/studio/workflow-smoke-bridge.test.ts
npm run typecheck
npm run lint
npm test
npm run smoke:workflow:run:daojie
npm run build:mac:install
```

## Rollback Point

If the UI becomes too heavy with 43 items, do not restore silent truncation. Keep all records in the model and add an explicit paginated or expandable full view with a visible total and no data loss.

## Completion Evidence

Verified on 2026-07-10:

- `npm test -- frontend/components/panels/studio/workflow-node-model.test.ts frontend/components/panels/studio/workflow-node-previews.test.tsx`: passed, 33 tests.
- `npm test -- frontend/components/panels/studio/workflow-stage-actions.test.tsx frontend/components/panels/studio/workflow-node-model.test.ts frontend/components/panels/studio/workflow-node-previews.test.tsx`: passed, 65 tests.
- `npm test -- frontend/config/build-scripts.test.ts frontend/components/panels/studio/workflow-node-model.test.ts frontend/components/panels/studio/workflow-node-previews.test.tsx frontend/components/panels/studio/workflow-stage-actions.test.tsx frontend/lib/studio/workflow-parity-report.test.ts frontend/lib/studio/workflow-smoke-bridge.test.ts`: passed, 112 tests.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 608 tests.
- Real Daojie store probe: `chapter-001` storyboards 43, with media 43, with workflow 43.
- `npm run build:mac:install`: passed; installed `/Applications/漫影工作室.app`; installed smoke passed.
- Packaged and installed `app.asar` hash match: `0a2ac69de51f27801ce6b7a86e269d63a5f2bb53f77ff0f6338db2708e4c6d70`.
- `npm run smoke:workflow:run:daojie`: passed against `source=real-daojie-chapter001-clone`; report `apps/output/automation/visible-workflow-daojie-report.json`.
- Daojie visible smoke evidence: `storyboardWorkflowEntryCount=43`, `hasStoryboard43WorkflowEntry=true`, `storyboards=43`, `storyboardsWithMediaPath=43`, `storyboardsWithWorkflow=43`, `derivedImageWorkflowsReady=3/3`, `videoCandidates=5`, `frontmostApp=漫影工作室`.
- Source guard: production source no longer contains `handleGenerateStoryboardImages`, `action.id === "generate-storyboard-images"`, `createStoryboardImageWorkflowGraph`, or `applyImageWorkflowResultToStoryboard` in the outer production-node action hook.
