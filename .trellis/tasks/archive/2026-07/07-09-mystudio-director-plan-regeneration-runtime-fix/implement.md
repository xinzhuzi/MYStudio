# Implementation Plan

1. Inspect current logs, project data, and installed-source path.
   - Find director-plan related diagnostics if present.
   - Inspect the current real Daojie `agentWorkData` and `scriptPlans`.
   - Trace regenerate action from UI button to model call and writeback.

2. Confirm the runtime gap.
   - Verify whether `handleDirectorPlan` audits before saving.
   - Verify whether repair is actually invoked in the failing path.
   - Verify preview selection after a blocked/failed generation.

3. Patch the smallest runtime surface.
   - Add or fix audit-before-writeback.
   - Add diagnostics for first audit, repair audit, saved, and blocked.
   - Preserve valid existing plan when new output remains weak.

4. Add tests.
   - Weak three-section output must not save.
   - Weak first output plus valid repair saves repaired output.
   - Source/runtime contains diagnostics and audit guard.

5. Validate.
   - `cd apps && npm test -- frontend/lib/studio/director-plan.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx`
   - `cd apps && npm run typecheck`
   - `cd apps && npm run lint`
   - Controlled regeneration audit in app/runtime or test harness.
   - `cd apps && npm run build:mac:install` if Electron/front-end bundle changes.

## Rollback Points

- `.trellis/tasks/07-09-mystudio-director-plan-regeneration-runtime-fix/*`
- `apps/frontend/components/panels/studio/useProductionPlanningActions.ts`
- `apps/frontend/lib/studio/director-plan.ts`
- Tests added or adjusted for this fix.

## Execution Results - 2026-07-09

- Real installed-app diagnostics showed one successful director-plan model call at `2026-07-09T07:28:22.108Z`, followed by two later `fetch failed` calls. The old logs had no `directorPlan.audit.*` or `directorPlan.writeback.*` diagnostics, so runtime writeback could not be audited from logs.
- Real project data still contains latest weak director-plan work item `work-1783582102126-nzqg28` with headings `分场汇总表 / 逐场注意事项 / 场间过渡`, `0/6` required six-section headings, and one parsed `scriptPlan` with `visualStyleLen=0`.
- Installed app bundle before rebuild did not contain `directorPlan.writeback.saved`, `directorPlan.writeback.blocked`, `legacy_three_block_format`, or `formatDirectorPlanAuditError`.
- Fixes applied:
  - `auditDirectorPlanStructure` now reports explicit `legacy_three_block_format` evidence.
  - Regeneration writeback logs `directorPlan.audit.first`, optional `directorPlan.audit.repair`, `directorPlan.writeback.saved`, and `directorPlan.writeback.blocked`.
  - Node-editor save now audits director-plan drafts before saving, closing the manual edit bypass.
- Validation passed:
  - `cd apps && npm test -- frontend/lib/studio/director-plan.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx frontend/components/panels/studio/useWorkflowNodeEditor.test.tsx`
  - `cd apps && npm run typecheck`
  - `cd apps && npm run lint`
  - `cd apps && npm test`
  - `cd apps && npm run build:mac:install`
  - Installed app hash matched packaged hash: `ca2e2d5b4927b50fe47de13657758f4f76caa45d86d149007e1007a95326f759`.
  - Installed `app.asar` contains the new audit/writeback strings.
  - Installed smoke passed with `ok=true`, workflow progress `100`, routes `工作流/资产/TTS/设置` all ok, image workflow detail ready, and DOM screenshot fallback `whiteRatio=0`.
  - Isolated visible workflow smoke passed with progress `100` and `frontmostApp=漫影工作室`.
- Real Daojie visible smoke did not run because the real project data failed preflight: `derivedAssetPlan=0` while `imageWorkflows=3`. This is consistent with the weak saved director-plan data and was not silently patched in this task.
