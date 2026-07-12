# Chapter001 Daojie Toonflow Image Consistency

## Goal

Improve the real Daojie chapter-001 image generation chain so storyboard prompts use Toonflow-style reference image binding while preserving Daojie's ink-guofeng style. The output must keep exactly 43 storyboards, keep Daojie content in the user's project disk path, and make prompt consistency auditable through the automation report.

## Requirements

- Scope is limited to Daojie chapter-001 generation, Daojie ink-guofeng skill text, and validation/reporting. Do not change the global image workflow data model by default.
- Preserve Daojie style: xuan-paper pale gongbi, cyan-green landscape, muted blue-gray clothing, restrained old-gold details, fine linework. Do not copy Toonflow's cel-shaded anime style.
- Import Toonflow mechanisms only: `@图N` reference labels, direct `@图N` replacement in the visual prompt body, `【画面】/【光影】/【风格】` sections, and explicit continuity rules.
- Existing generated/prompt workflow nodes continue to store the final prompt; no new persistent `StoryboardItem` or `ImageWorkflowGraph` fields are required unless implementation proves they are necessary.
- If a storyboard visual description includes a known visible role but the resolved reference image set has no matching role asset, validation must fail with the storyboard index instead of letting the model infer from raw text names.
- Derived character assets must keep the existing four-view/reference-sheet behavior and must not be converted into storyboard frames.
- Do not package or install the desktop app in this task.

## Acceptance Criteria

- [x] A new task directory contains `prd.md`, `design.md`, and `implement.md` for this work.
- [x] Daojie ink-guofeng skill text states that storyboard prompts must bind referenced roles/scenes/props with `@图N` in the prompt body, while character derivative assets remain four-view reference sheets.
- [x] `Library/build_daojie_chapter001_workflow.py` produces final storyboard image prompts with `@图N` labels, `【画面】`, `【光影】`, `【风格锁】`, `【参考图规则】`, and `【反向约束】`.
- [x] For referenced assets, the `【画面】` section uses `@图N` markers instead of raw asset names or aliases.
- [x] Known visible roles in each storyboard are resolved to role reference images; missing visible role references are reported and fail validation.
- [x] The generation report includes `storyboardPromptManifest` plus aggregate fields for reference binding, Daojie style lock, light section coverage, missing visible role references, and raw asset name leaks.
- [x] `apps/build/automate-daojie-chapter001-video.mjs` rejects reports where storyboard prompts are not fully bound, do not have Daojie style locks, lack light sections, miss visible role references, or leak referenced raw asset names in `【画面】`.
- [x] Focused tests cover reference replacement, missing visible role detection, report fields, and wrapper validation strings.
- [x] Validation passes: `python3 -m py_compile Library/build_daojie_chapter001_workflow.py`, `cd apps && npm test -- frontend/config/build-scripts.test.ts`, `cd apps && npm run typecheck`, `cd apps && npm run lint`.

## Notes

- Real image regeneration and MP4 verification remain opt-in after code validation. If run later, use `cd apps && npm run video:daojie:chapter001` and inspect repeated-character image samples before claiming visual consistency.
