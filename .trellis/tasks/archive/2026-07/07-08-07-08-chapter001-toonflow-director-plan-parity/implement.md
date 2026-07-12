# Implementation Plan

## Checklist

1. Add director-plan constants and builders in `Library/build_daojie_chapter001_workflow.py`.
   - Add five chapter-001 scene plan records.
   - Replace the short `build_script_plan()` body with a rich `①-⑥` markdown plan plus existing `⑦` derived asset section.
   - Add `build_structured_script_plan()` for rich `state["scriptPlans"]` writeback.
   - Add `audit_director_plan()` and use it in workflow step details and final report.

2. Update chapter-001 writeback in `Library/build_daojie_chapter001_workflow.py`.
   - Keep `agentWorkData["directorPlan"]` as the full raw `<scriptPlan>`.
   - Replace the current short structured `state["scriptPlans"].append(...)` with `build_structured_script_plan()`.
   - Add director-plan audit fields to the generated report JSON.

3. Update `apps/build/automate-daojie-chapter001-video.mjs`.
   - Add a `requireDirectorPlanIntegrity(generated)` gate.
   - Validate raw char counts, Chinese char counts, H2 sections, five scene sections, bullet count, required section booleans, and structured scene-intent completeness.
   - Include director-plan audit fields in the final report output.

4. Update frontend parser if needed.
   - Enhance `apps/frontend/lib/studio/director-plan.ts` so rich `①-⑥` plans with `### Sc ...` blocks populate `sceneIntents`.
   - Preserve existing compact Toonflow table behavior and existing light-term warnings.

5. Update focused tests.
   - `apps/frontend/lib/studio/director-plan.test.ts`: add a rich Toonflow-grade `①-⑥` parse test.
   - `apps/frontend/config/build-scripts.test.ts`: assert generator and wrapper contain director-plan audit and gate strings.
   - Existing flow/context tests should keep passing; add small assertions only if a regression is exposed.

6. Run validation.
   - `python3 -m py_compile Library/build_daojie_chapter001_workflow.py`
   - Focused Python probe for plan metrics.
   - `cd apps && npm test -- frontend/config/build-scripts.test.ts frontend/lib/studio/director-plan.test.ts frontend/lib/studio/studio-flow-data.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx`
   - `cd apps && npm run typecheck`
   - `cd apps && npm run lint`

## Risk Points

- The full `npm run video:daojie:chapter001` command is expensive because it can invoke real TTS, image generation, FFmpeg, and project writeback. Do not run it unless the user asks for real generation in this task.
- `director-plan.ts` strips lighting terms from structured fields. Do not rely on structured `visualStyle` preserving every raw visual word.
- `buildStudioFlowData()` prefers raw `agentWorkData["directorPlan"]`, so UI preview can look correct even if structured `scriptPlans` is weak. The new audit must check both.
- Existing tests assert exact strings inside build scripts. Update them narrowly for new audit strings only.

## Rollback Points

- Revert only this task's changed files if needed:
  - `.trellis/tasks/07-08-07-08-chapter001-toonflow-director-plan-parity/prd.md`
  - `.trellis/tasks/07-08-07-08-chapter001-toonflow-director-plan-parity/design.md`
  - `.trellis/tasks/07-08-07-08-chapter001-toonflow-director-plan-parity/implement.md`
  - `Library/build_daojie_chapter001_workflow.py`
  - `apps/build/automate-daojie-chapter001-video.mjs`
  - `apps/frontend/lib/studio/director-plan.ts`
  - focused test files touched by this task

No git reset, checkout, clean, stash, commit, or branch operation is allowed without explicit user permission.

## Validation Evidence

- `python3 -m py_compile Library/build_daojie_chapter001_workflow.py` passed.
- Director-plan probe passed: `6118` chars, `3975` Chinese chars, `6` H2 sections, `5` Sc scene sections, `128` bullet lines, `5/5` complete structured scene intents.
- `cd apps && npm test -- frontend/config/build-scripts.test.ts frontend/lib/studio/director-plan.test.ts frontend/lib/studio/studio-flow-data.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx` passed: `4` files, `80` tests.
- `cd apps && npm run typecheck` passed.
- `cd apps && npm run lint` passed.
- Full `npm run video:daojie:chapter001` was not run in this task because it triggers real TTS/image/video generation and was not requested for this finish pass.
- Packaging/install was not run in this task.
