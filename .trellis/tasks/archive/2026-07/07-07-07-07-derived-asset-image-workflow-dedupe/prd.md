# Derived asset image workflow dedupe and generation logic

## Goal

Fix duplicate derived-asset image workflow nodes and align character derived asset image generation with Toonflow-style three-view output.

## Requirements

- R1. Opening image workflow detail from one derived asset must show only that derived asset's workflow, with a return button back to the originating workflow surface.
- R2. The detail graph must not duplicate the same parent reference image when one URL is stored as `file:///...` and another as a bare absolute local path.
- R3. The generated-result node must not repeat the full prompt editor when a dedicated `图片生成` prompt node already exists. The prompt remains editable from the prompt node.
- R4. Character derived asset image generation must request a Toonflow-style character reference sheet / three-view output, not a generic single full-body illustration. Scene and prop derived assets must keep their existing single-image behavior.
- R5. The generated image / smoke evidence must be inspected after the fix. Do not claim real model generation unless a real generation command is freshly run and the output image is opened or otherwise visually verified.
- R6. Keep the change scoped to the derived-asset image workflow and prompt construction. Do not package Daojie content into MYStudio; Daojie remains project data on disk.
- R7. After implementation, rebuild, overwrite install `/Applications/漫影工作室.app`, and test the installed app with fresh command output.

## Acceptance Criteria

- [x] A regression test proves equivalent local reference paths (`file:///Users/...` and `/Users/...`) produce one `父资产参考图` node after graph repair.
- [x] A UI regression test proves the generated node does not show the duplicate full prompt editor when a prompt node is linked.
- [x] A generation-prompt regression test proves character derived assets include three-view/reference-sheet language and scene/prop assets do not inherit that character-only contract.
- [x] Focused tests for image workflow and derived asset workflow pass.
- [x] Full `npm run typecheck`, `npm run lint`, and `npm test` pass from `apps/`.
- [x] `npm run build:mac`, packaged smoke, overwrite install, installed smoke, and real Daojie visible workflow runner are rerun after the change.
- [x] Final report states exactly what image evidence was inspected and separates smoke images from real model generation output.

Completion note: `npm run video:daojie:chapter001` was rerun with `MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES=1` and `MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES_AFTER=2026-07-07T00:30:00+08:00`; this refreshed project writeback and derived asset outputs while reusing existing 43 storyboard images. The inspected character derived output is the local fallback/reference-sheet preview, not a newly generated real-model character sheet.

## Notes

- Parent task: `07-07-toonflow-image-workflow-deep-audit`.
- No git commands, no worktree, no destructive cleanup.
