# Implement

## Steps

1. Confirm existing layout source and source tests.
2. Replace scattered LR coordinates with deterministic width/gutter-derived positions.
3. Slightly strengthen workflow edge rendering while keeping theme tokens.
4. Update source-level tests to lock the new layout contract.
5. Wire the existing refresh icon to reset the current graph to the standard layout and fit the canvas.
6. Run focused workflow UI tests.

## Validation

```bash
cd apps
npm test -- frontend/components/panels/studio/workflow-tabs.test.ts frontend/components/panels/studio/workflow-node-previews.test.tsx
```

If the focused tests expose broader type or lint issues from this edit, run the corresponding command before final reporting.

## Evidence

- `npm test -- frontend/components/panels/studio/workflow-tabs.test.ts frontend/components/panels/studio/workflow-node-previews.test.tsx` passed: 2 files, 33 tests.
- `npm run typecheck` passed.
- `npm run lint` passed.
