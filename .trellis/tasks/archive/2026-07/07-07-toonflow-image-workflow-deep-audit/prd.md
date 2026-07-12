# Toonflow image workflow deep audit

## Goal

Use the newly installed Trellis workflow to verify MYStudio's Toonflow-style image workflow and Daojie storyboard/image generation path with fresh, reproducible evidence.

The audit must not treat this project as a realistic-photo workflow. The target style for Daojie is `daojie_ink_guofeng`: ink-wash Chinese xianxia, gongbi linework, rice-paper texture, guofeng comic/drama composition, and explicit anti-photoreal / anti-3D constraints.

## Confirmed Facts

- Trellis CLI is globally installed at `/opt/homebrew/bin/trellis`, version `0.6.5`.
- Project Trellis initialization exists under `.trellis/`, `.codex/`, `.agents/skills/trellis-*`, and `AGENTS.md`.
- Active Trellis workflow template is `channel-driven-subagent-dispatch`.
- Developer identity has been corrected to `xinzhuzi`; hidden Trellis files no longer contain the old auto-detected developer token.
- Daojie-specific visual manuals exist under `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/`.
- `docs/融合/Toonflow_MYStudio_分镜差异审计.md` states current MYStudio is only partially equivalent to Toonflow: node/workflow/writeback mechanisms are close, but original Toonflow storyboard table, asset order, reference image source, and golden image comparison are not fully migrated.

## Requirements

- R1. Trellis setup must be verified from current disk state, including CLI version, project files, workflow list, and developer identity.
- R2. The image workflow detail opened from derived assets and storyboard images must expose a Toonflow-style graph with reference node(s), generated node, prompt node, editable prompt text, source/context label, and a return button.
- R3. Daojie prompt/style verification must read the actual `daojie_ink_guofeng` manuals and confirm generated storyboard/image prompts contain ink-wash xianxia anchors, `@图N` reference tags, and anti-photoreal / anti-3D constraints.
- R4. Deep audit must include code-level review of the workflow model, image workflow canvas, smoke bridge, smoke runners, Daojie generation script, and regression tests.
- R5. Deep audit must include automated validation. At minimum: focused workflow tests, full `typecheck`, `lint`, `test`, packaged build, packaged smoke, installed app smoke, and real Daojie visible workflow runner if the installed app gate remains available.
- R6. A Trellis channel check worker must independently review the implementation/audit scope, and the main session must inspect raw channel output before final judgment.
- R7. Do not run git commands. Do not create a worktree. Do not delete project files. Do not claim full real media generation unless `npm run video:daojie:chapter001` is freshly rerun.

## Acceptance Criteria

- [ ] `python3 ./.trellis/scripts/get_developer.py` returns `xinzhuzi`, and direct search for the old auto-detected developer token under `.trellis`, `.codex`, `.agents`, and `AGENTS.md` returns no matches.
- [ ] `trellis workflow --list` shows `channel-driven-subagent-dispatch` as available after project initialization.
- [ ] Focused tests covering workflow image detail, prompt node, source label, return button, and Daojie prompt/style constraints pass.
- [ ] Full app gates pass from `apps/`: `npm run typecheck`, `npm run lint`, `npm test`.
- [ ] Packaged gate passes: `npm run build:mac` and `npm run smoke:desktop`.
- [ ] Installed app is overwritten at `/Applications/漫影工作室.app`, packaged and installed `app.asar` hashes match, and installed smoke passes.
- [ ] Real Daojie visible workflow runner passes if run: `npm run smoke:workflow:run:daojie`.
- [ ] Trellis check worker reports no blocking issues, or every verified issue is fixed and rechecked.
- [ ] Final report separates verified workflow/UI smoke, installed app smoke, real Daojie visible workflow runner, and full real media generation status.

## Notes

- User-level constraints override Trellis' default commit phase: no git commands and no worktree are allowed in this task.
- Trellis task artifacts are allowed under `.trellis/tasks/`; no unrelated root files should be created.
