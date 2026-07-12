# Implementation And Audit Plan

## Steps

1. Verify Trellis installation and identity:
   - `trellis --version`
   - `python3 ./.trellis/scripts/get_developer.py`
   - Directly search `.trellis`, `.codex`, `.agents`, and `AGENTS.md` for the old auto-detected developer token; it must return no matches.
   - `trellis workflow --list`

2. Load relevant context before touching code:
   - `.trellis/spec/frontend/index.md`
   - `.trellis/spec/backend/index.md`
   - `.trellis/spec/guides/index.md`
   - `docs/融合/Toonflow_MYStudio_分镜差异审计.md`
   - `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/README.md`
   - `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/prefix.md`
   - `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/art_prompt/art_storyboard_video.md`
   - `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/driector_skills/director_storyboard.md`

3. Inspect code and tests for:
   - image workflow graph node construction and repair
   - reference/generated/prompt node rendering
   - editable prompt field behavior
   - source label and return button behavior
   - derived asset and storyboard entry points
   - Daojie prompt builder and style lock
   - smoke assertions for real Daojie derived/storyboard image workflow detail

4. Run focused tests:
   - `npm test -- frontend/components/panels/studio/workflow-node-model.test.ts frontend/components/panels/studio/workflow-node-previews.test.tsx frontend/components/panels/studio/workflow-tabs.test.ts frontend/lib/studio/workflow-smoke-bridge.test.ts frontend/config/build-scripts.test.ts`

5. Run full validation from `apps/`:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run build:mac`
   - `npm run smoke:desktop`

6. Install and validate packaged app:
   - `ditto "/Users/zhengbingjin/Project/Github/MYStudio/apps/release/build/mac-arm64/mac-arm64/漫影工作室.app" "/Applications/漫影工作室.app"`
   - compare packaged and installed `app.asar` hashes with `shasum -a 256`
   - run installed smoke with `MYSTUDIO_SMOKE_APP_BIN="/Applications/漫影工作室.app/Contents/MacOS/漫影工作室" npm run smoke:desktop`

7. Run real Daojie visible workflow validation if the installed app gate passes:
   - `npm run smoke:workflow:run:daojie`

8. Dispatch Trellis check worker:
   - create an ephemeral check channel for this task
   - spawn `check`
   - send a brief that includes no-git/no-worktree constraints and expected evidence
   - wait for `done`
   - inspect `trellis channel messages --raw`

9. Finalize:
   - fix any verified issue with minimal edits
   - rerun affected gates
   - report exact command results and evidence paths

## Stop Conditions

- A command fails with an app regression.
- Trellis worker reports a verified blocking issue.
- Installed app hash mismatch persists after reinstall.
- Real Daojie visible runner cannot access the real project data.

## Explicit Non-Goals

- Do not run `npm run video:daojie:chapter001` unless the user separately asks for full real media generation.
- Do not migrate Toonflow DB storyboard data in this task.
- Do not claim golden image parity unless Toonflow original images are compared directly.

## Validation Results

2026-07-10 fresh validation:

- `cd apps && npm test -- frontend/config/build-scripts.test.ts` passed: 39 tests.
- `node --check apps/build/automate-daojie-chapter001-video.mjs` passed.
- `cd apps && npm run typecheck` passed.
- `cd apps && npm run lint` passed.
- `cd apps && npm test` passed: 108 files, 626 tests.
- `cd apps && npm run build:mac` passed. Build artifacts: `apps/release/build/mac-arm64`.
- `cd apps && npm run smoke:desktop` passed against the packaged app, report `apps/output/automation/desktop-smoke-report.json`, `ok=true`, `workflowE2E=ok`, `assetVoiceFlow=ok`, `scriptAssetGenerationVoiceFlow=ok`, `pythonSettings=ok`.
- `cd apps && npm run smoke:installed` passed after overwriting `/Applications/漫影工作室.app`; packaged and installed `app.asar` hash matched: `ab121acb72f43f75587cd0be82918123ac1e28762a2b3ee3b1bd22e176e70ad8`.
- `cd apps && npm run smoke:workflow:run:daojie` passed, report `apps/output/automation/visible-workflow-daojie-report.json`, `ok=true`, `source=real-daojie-chapter001-clone`, `progress=100`, `completed=true`, `storyboards=43`, `storyboardImageWorkflowsReady=43`, `derivedImageWorkflowsReady=3`, `videoCandidates=5`.
- The full real media command was also run after explicit continuation: `cd apps && npm run video:daojie:chapter001` passed with real local TTS and final MP4 evidence. It reused existing project storyboard images because the external image provider returned fetch/502 during fresh image regeneration.

Boundary: this completes MYStudio workflow/UI smoke, installed app smoke, real Daojie visible runner, and real TTS/video/writeback verification. It does not prove golden image parity against original Toonflow images, and it does not prove the external image provider was healthy for a full 43-shot fresh image regeneration on 2026-07-10.
