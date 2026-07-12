# MYStudio toolized agents and review loop

## Goal

Connect decision/supervision/execution agents through typed MYStudio tools and stage review/fix/approval loops.

## Requirements

- Replace config-only production agent entries with typed tool execution paths for the stages MYStudio actually supports.
- Start with bounded tools that call existing MYStudio services/stores; do not let model output write arbitrary storage.
- Add decision, execution, supervision, repair, and approval checkpoints per stage.
- Unify current director-plan audit/repair with storyboard, assets, image, audio, and video review gates.
- Keep Toonflow's agent orchestration as a mechanism reference, not a schema/runtime copy.

## Acceptance Criteria

- [x] At least one full stage runs through plan -> execute -> review -> repair-or-approve using typed tools.
- [x] Supervision failures block writeback or mark the run failed with actionable issues.
- [x] Agent deployment keys are mapped to actual call sites or explicitly marked unsupported.
- [x] Unit tests cover tool allowlists, writeback boundaries, and failed supervision behavior.
- [x] UI/smoke reports distinguish model response, tool writeback, and supervision approval.

## Notes

- Complex task. Add `design.md` and `implement.md` before starting.
