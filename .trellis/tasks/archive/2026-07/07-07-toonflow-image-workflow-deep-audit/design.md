# Technical Design

## Scope

This task audits the current MYStudio Toonflow-style image workflow and Daojie storyboard/image generation path. It does not redesign the full media generation pipeline.

Primary source areas:

- `docs/融合/Toonflow_MYStudio_分镜差异审计.md`
- `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/`
- `apps/frontend/lib/studio/image-workflow.ts`
- `apps/frontend/components/panels/studio/ImageWorkflowCanvas.tsx`
- `apps/frontend/components/panels/studio/WorkflowNodePreviews.tsx`
- `apps/frontend/lib/studio/workflow-smoke-bridge.ts`
- `apps/build/smoke-desktop.mjs`
- `apps/build/run-visible-workflow-smoke.mjs`
- `Library/build_daojie_chapter001_workflow.py`
- Focused tests under `apps/frontend/**`

## Expected Workflow Contract

Image workflow detail must preserve the Toonflow mental model:

1. Reference image node(s) represent source assets or frame references.
2. Prompt node exposes the editable generation prompt.
3. Generated node represents the generated output image and writeback target.
4. The graph keeps source context visible: derived asset, storyboard, parent asset, or project stage.
5. A return action takes the user back to the entry surface.

## Daojie Style Contract

Daojie image/storyboard prompts must use the project's `daojie_ink_guofeng` skill/manual:

- positive anchors: 水墨国风, 修仙古韵, 工笔线描, 写意晕染, 宣纸质感, 水墨国风电影质感
- reference continuity: `@图N` labels and explicit reference-image preservation
- exclusions: 写实摄影, 3D写实渲染, photorealistic, 3D render, CGI, cel shading, high saturation neon

## Verification Layers

1. Static review: inspect data flow and tests against the PRD requirements.
2. Focused test layer: run the workflow/model/prompt regression tests.
3. Full app layer: run `typecheck`, `lint`, and full `test`.
4. Packaged layer: build mac package and run packaged smoke.
5. Installed layer: overwrite `/Applications/漫影工作室.app`, compare `app.asar` hashes, run installed smoke.
6. Real Daojie workflow layer: run the visible real Daojie workflow runner if available.
7. Trellis review layer: dispatch a `check` worker and inspect raw output.

## Risk Controls

- No git commands.
- No worktree.
- No destructive cleanup.
- No full real media generation claim unless `npm run video:daojie:chapter001` is freshly run.
- If an audit finds a bug, apply the smallest scoped fix and rerun the relevant gates.
