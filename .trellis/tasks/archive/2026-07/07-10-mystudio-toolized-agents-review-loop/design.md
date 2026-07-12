# MYStudio toolized agents and review loop design

## Scope

This child task connects the existing director-plan stage to a typed tool boundary and records the remaining production agent deployment gaps explicitly. It does not copy Toonflow's runtime schema. It absorbs the mechanism: model output must pass supervision before writeback, and supported agents must have concrete tool call sites.

## Current flow

`useProductionPlanningActions.handleDirectorPlan` already:

1. starts a `StudioAgentRun`;
2. asks `productionAgent:directorPlanAgent` for model text;
3. audits the text with `auditDirectorPlanStructure`;
4. optionally asks the model for a repair;
5. parses and writes `directorPlan` work data plus a `ScriptPlan`;
6. marks the run success or failure.

The missing boundary is that step 5 still writes directly to Zustand/store callbacks. The writeback should move behind a typed tool function that owns supervision and rejects failed output.

## Target flow

```text
model response
  -> director plan first audit
  -> optional repair model response
  -> typed tool reviewDirectorPlan
  -> typed tool writeDirectorPlan
  -> store writeback only when approved
  -> run ledger success/failure evidence
```

## Contracts

- `production-agent-tools.ts` owns the tool registry.
- `writeDirectorPlan` accepts only explicit callbacks:
  - `saveAgentWorkData`
  - `saveScriptPlan`
- `writeDirectorPlan` must return `approved=false` without calling either callback when supervision fails.
- Deployment keys must be either `connected` with a call site or `unsupported` with a reason.

## Non-goals

- No arbitrary model-to-store writes.
- No SQLite/Toonflow schema import.
- No media taskization in this child task; image/audio/video taskization belongs to `07-10-mystudio-media-taskization`.
