# Director plan regeneration runtime fix

## Goal

Fix MYStudio director-plan regeneration still producing or preserving old weak three-section output; verify logs, runtime validation, writeback, and installed app behavior.

## Requirements

- Reproduce why installed MYStudio still regenerates a weak/director-plan result after the six-section contract work.
- Check current installed-app diagnostics and current project data instead of relying on prior completion claims.
- Enforce the director-plan six-section audit at the actual runtime writeback boundary used by the regenerate action.
- Add clear runtime diagnostics for director-plan generation attempts: first audit result, repair attempt, final writeback/skipped writeback.
- Do not overwrite a previously valid plan with weak three-block output.
- Keep legacy parsing compatible for old saved projects, but block weak output from new regeneration.
- Do not package Daojie content into the app bundle; only update code/manual/runtime behavior.
- Do not run git or worktree commands.

## Acceptance Criteria

- [ ] Fresh log/data inspection explains why the user still sees the old result.
- [ ] Regenerate director plan cannot save a weak three-section output.
- [ ] If a provider returns weak output, the app attempts one repair with concrete audit issues.
- [ ] If repair still fails, the app shows/logs failure and preserves the previous plan.
- [ ] Runtime diagnostics include director-plan audit/writeback evidence.
- [ ] Focused tests cover weak output rejection, repair, and successful six-section writeback.
- [ ] `cd apps && npm test -- frontend/lib/studio/director-plan.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx`
- [ ] `cd apps && npm run typecheck`
- [ ] `cd apps && npm run lint`
- [ ] A real or controlled app-level regeneration audit is run by the main session and inspected.
- [ ] If Electron-facing code changes, rebuild/install with `cd apps && npm run build:mac:install`.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
