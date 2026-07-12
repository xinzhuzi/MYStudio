# Design

## Problem

The previous six-section task changed the contract, but the user still sees the same regenerated director plan. The likely failure modes are:

- The installed app is calling a generation path that bypasses `auditDirectorPlanStructure`.
- The weak output is rejected internally but the old visible plan remains, making the UI look unchanged without a clear error.
- The repair pass is unavailable or ineffective, but no diagnostics explain why.
- Existing `agentWorkData` or `scriptPlans` still contain old/weak content and preview selection favors that content.

## Runtime Contract

Director-plan regeneration must follow one writeback boundary:

```text
run director-plan model
  -> audit first output
  -> if invalid, run one repair model call
  -> audit repaired output
  -> only then save raw agentWorkData and parsed ScriptPlan
  -> log audit/writeback diagnostics
```

Weak three-section output is allowed only as legacy readable data, never as a successful new regeneration result.

## Diagnostics

Add a small frontend diagnostic helper near the planning action. It should log:

- `directorPlan.audit.first`
- `directorPlan.audit.repair`
- `directorPlan.writeback.saved`
- `directorPlan.writeback.blocked`

The logs must include structured counts and issue codes, not full prompt text.

## Verification

Use tests for deterministic behavior and a controlled app/runtime audit for the installed behavior. Do not claim visual success only from unit tests.
