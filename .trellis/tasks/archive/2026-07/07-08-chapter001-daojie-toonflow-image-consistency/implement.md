# Implement

## Steps

1. Start this Trellis task after artifacts are written.
2. Update Daojie ink-guofeng skill text with the `@图N` storyboard binding rule and keep derivative four-view guidance intact.
3. Add prompt binding/audit helpers to `Library/build_daojie_chapter001_workflow.py`.
4. Use the helpers in storyboard frame generation and report creation.
5. Add wrapper validation in `apps/build/automate-daojie-chapter001-video.mjs` for the new report fields.
6. Extend `apps/frontend/config/build-scripts.test.ts` with focused prompt-binding and report-validation assertions.
7. Run validation commands and inspect any failing prompt samples before widening the change.

## Validation Commands

```bash
python3 -m py_compile Library/build_daojie_chapter001_workflow.py
cd apps && npm test -- frontend/config/build-scripts.test.ts
cd apps && npm run typecheck
cd apps && npm run lint
```

Real generation is not part of the default code validation pass. If explicitly allowed later:

```bash
cd apps && npm run video:daojie:chapter001
cd apps && npm run smoke:workflow:run:daojie
```

## Validation Results

- `python3 -m py_compile Library/build_daojie_chapter001_workflow.py` passed.
- `cd apps && npm test -- frontend/config/build-scripts.test.ts` passed: 38 tests.
- `cd apps && npm run typecheck` passed.
- `cd apps && npm run lint` passed.
- Additional prompt audit probe passed: 43/43 storyboard prompts have reference bindings, Daojie style locks, light sections, zero missing visible role references, and zero raw asset name leaks.
- Additional UI-focused tests passed: `frontend/components/panels/studio/image-workflow-canvas.test.tsx` and `frontend/components/panels/studio/workflow-tabs.test.ts`, 17 tests.

2026-07-10 fresh validation:

- `cd apps && npm test -- frontend/config/build-scripts.test.ts` passed: 39 tests.
- `cd apps && npm run typecheck` passed.
- `cd apps && npm run lint` passed.
- `cd apps && npm test` passed: 108 files, 626 tests.
- `cd apps && npm run video:daojie:chapter001` passed with project image reuse after the external image provider returned `fetch failed` / `502 Upstream service temporarily unavailable` during fresh shot 019 image regeneration. The successful report still verifies Toonflow-style prompt binding/report fields and 43 usable storyboard images in the project workflow.
- Video report: `apps/output/automation/daojie-chapter001-video-report.json`, `ok=true`, `storyboardImageGenerationMode=real-ai-reference-image-workflow`, `storyboards=43`, `generatedFrameImages=43`, `framesWithRealAssetImages=43`, `missingImageAssets=[]`, `ttsMocked=false`.
- `cd apps && npm run smoke:workflow:run:daojie` passed against the real Daojie chapter-001 project clone with `storyboards=43`, `storyboardImageWorkflowsReady=43`, `derivedImageWorkflowsReady=3`, and `videoCandidates=5`.

Boundary: full fresh external image-provider regeneration for shots 019-043 was not completed on 2026-07-10 because the configured upstream returned fetch/502 errors. The accepted closure here is workflow/image-consistency validation using existing project storyboard images plus fresh real TTS/video/writeback.

## Rollback Notes

All changes are additive or narrowing validation changes. If validation is too strict for an existing storyboard, adjust the alias/visible-role resolver, not the Daojie style lock or the Toonflow `@图N` binding requirement.
