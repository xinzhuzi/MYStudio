# MYStudio Toonflow fixture and final parity verification implementation plan

## Steps

1. Add `toonflow-fixture-parity.ts` pure adapter.
2. Extend `workflow-parity-report.ts` with optional Toonflow fixture input and issue codes.
3. Add unit tests for pass, prompt mismatch, reference order mismatch, missing image path, and deferred golden image status.
4. Run focused tests and typecheck.

## Validation

Run from `apps/`:

```bash
npm test -- frontend/lib/studio/toonflow-fixture-parity.test.ts frontend/lib/studio/workflow-parity-report.test.ts
npm run typecheck
```

## Boundaries

- Do not read live Toonflow SQLite in unit tests.
- Do not claim real media generation unless `npm run video:daojie:chapter001` is freshly executed.
- Do not run git commands.
