# MYStudio toolized agents and review loop implementation plan

## Steps

1. Fix the new typed tool unit test by embedding a local valid six-section director-plan fixture.
2. Route director-plan writeback in `useProductionPlanningActions.ts` through `createProductionAgentToolRegistry().writeDirectorPlan`.
3. Preserve existing audit, repair, logging, run ledger, and toast behavior.
4. Add blocked writeback handling when the typed tool rejects the final text.
5. Run focused unit tests and typecheck.
6. Update PRD acceptance checkboxes and task status only after fresh verification passes.

## Files

- `apps/frontend/lib/studio/production-agent-tools.ts`
- `apps/frontend/lib/studio/production-agent-tools.test.ts`
- `apps/frontend/components/panels/studio/useProductionPlanningActions.ts`
- `.trellis/tasks/07-10-mystudio-toolized-agents-review-loop/prd.md`
- `.trellis/tasks/07-10-mystudio-toolized-agents-review-loop/task.json`

## Validation

Run from `apps/`:

```bash
npm test -- frontend/lib/studio/production-agent-tools.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx
npm run typecheck
npm test -- frontend/lib/studio/production-agent-tools.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx frontend/lib/studio/workflow-parity-report.test.ts
```

## Boundaries

- Do not run git commands.
- Do not change media generation behavior here.
- Do not claim packaged smoke or real media generation has passed unless those commands are rerun in this session.
