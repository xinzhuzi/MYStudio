# Design

## Boundary

This task changes only the real Daojie chapter-001 media generation path:

- `Library/build_daojie_chapter001_workflow.py`
- `apps/build/automate-daojie-chapter001-video.mjs`

No shared image workflow UI, asset library schema, package build configuration, or other chapters are in scope.

## Approach

The 43-shot structure is already driven by `EPISODE_STORYBOARD_SPECS["chapter-001"].shots`. The implementation will expand only the existing spoken text fields inside those 43 tuples. It will not change tuple count, scene names, descriptions, speakers, sound notes, asset arrays, or durations unless a validation failure proves a duration must be adjusted.

The validation wrapper already checks real image workflow mode, real assets, voice references, TTS mode, final streams, and MP4 evidence. It needs stricter chapter-specific acceptance for:

- exact storyboard count: 43
- exact source segment count: 43
- minimum spoken/script text: 400 effective Chinese characters
- maximum spoken text: 500 effective Chinese characters

## Runtime Behavior

The generator continues to write project-scoped data into the existing chapter-001 project path under the user's Application Support directory. It continues to use the configured real storyboard image provider and qwen-mlx local TTS path by default. It rejects mock, fallback, and silent-preview TTS for final acceptance.

No subtitle burn-in is added. Text length refers to spoken narration/dialogue counted by the existing `normalize_dialogue_text()` logic.
