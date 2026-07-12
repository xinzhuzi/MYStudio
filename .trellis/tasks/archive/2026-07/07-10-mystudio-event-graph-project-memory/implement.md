# MYStudio event graph and project memory implementation plan

## Steps

1. Add event memory types to `apps/frontend/types/studio.ts`.
2. Add `apps/frontend/lib/studio/event-graph.ts` with:
   - event graph construction from chapters;
   - scoped retrieval;
   - cleanup filtering;
   - markdown formatting.
3. Add store state/actions:
   - `eventGraph`
   - `projectMemoryRecords`
   - `rebuildProjectMemoryFromChapters`
   - `retrieveProjectMemory`
   - `purgeProjectMemory`
4. Inject retrieved memory into script-stage messages and director-plan messages.
5. Add unit tests for graph construction, scoped retrieval, cleanup, and prompt injection.
6. Run focused tests and typecheck.

## Validation

Run from `apps/`:

```bash
npm test -- frontend/lib/studio/event-graph.test.ts frontend/lib/studio/script-planning.test.ts frontend/stores/studio-store.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx
npm run typecheck
```

## Boundaries

- Do not add a database/vector dependency in this task.
- Do not read unrelated project stores during retrieval.
- Do not run git commands.
