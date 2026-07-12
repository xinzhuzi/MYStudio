# MYStudio asset storyboard audio video taskization

## Goal

Move image, derived asset, storyboard image, TTS, model video, and FFmpeg workbench generation into the run kernel with item-level progress and evidence.

## Requirements

- Convert image workflow generation, derived asset image generation, TTS, model video generation, and FFmpeg composition into run-ledger-backed tasks.
- Support batch progress, item-level failure, continue, retry, cancel, and writeback evidence.
- Wire advanced options such as visual continuity, resume generation, and content moderation to real execution paths or mark them disabled.
- Keep existing project media references and `project-file://` isolation.
- Preserve current FFmpeg/local TTS strengths while adding provider-video task tracking.

## Acceptance Criteria

- [x] Storyboard image generation records per-shot task status and generated output evidence.
- [x] TTS/audio generation records per-line or per-shot status and writeback refs.
- [x] Video candidate generation records provider/FFmpeg status, selected candidate, and final export evidence.
- [x] Failed items can be retried without redoing successful items.
- [x] Advanced settings are either executed or hidden/disabled with tests preventing config-only drift.
- [x] Relevant workflow readiness, parity report, store, and smoke tests pass.

## Notes

- Complex task. Add `design.md` and `implement.md` before starting.
