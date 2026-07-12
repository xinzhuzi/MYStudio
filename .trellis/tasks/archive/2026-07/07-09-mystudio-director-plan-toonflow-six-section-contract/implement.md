# Implementation Plan

## Checklist

1. Update the generic director-plan skill.
   - Replace the old "only four things / three sections" output contract with the six-section contract.
   - Keep the XML wrapper and downstream-agent focus.
   - Require `### Sc` scene subsections and optional `⑦` derived-asset planning.

2. Add reusable audit helpers in `apps/frontend/lib/studio/director-plan.ts`.
   - Export required heading constants.
   - Export `auditDirectorPlanStructure(output)`.
   - Return pass/fail, metrics, and actionable issue strings.
   - Keep legacy parsing intact.

3. Harden `handleDirectorPlan`.
   - Audit the first model output.
   - If invalid, make one repair request using the audit issues.
   - Save only audited valid output.
   - Keep existing warning behavior for stripped lighting terms.

4. Add tests.
   - `director-plan.test.ts`: weak three-block output fails; rich six-section output passes; message prompt contains the contract.
   - `workflow-stage-actions.test.tsx`: source-level guard that invalid output is not saved and repair path exists, matching the current test style.

5. Validate.
   - `cd apps && npm test -- frontend/lib/studio/director-plan.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx`
   - `cd apps && npm run typecheck`
   - `cd apps && npm run lint`
   - `cd apps && npm run smoke:workflow:run`
   - `cd apps && npm run build:mac:install`

## Risk Points

- The current Toonflow runtime skill contradicts the user's visible six-section result; implementation must document and follow the real project data contract.
- Repair calls can double model cost for bad outputs; only one retry is allowed.
- Saving invalid raw text would recreate the user's exact bug, so validation must happen before both raw and structured writes.

## Rollback Points

- `.trellis/tasks/07-09-mystudio-director-plan-toonflow-six-section-contract/*`
- `apps/frontend/assets/studio-manuals/production_execution_director_plan.md`
- `apps/frontend/lib/studio/director-plan.ts`
- `apps/frontend/components/panels/studio/useProductionPlanningActions.ts`
- Focused tests touched for this task.

No git reset, checkout, stash, clean, commit, branch, or worktree command is allowed.
